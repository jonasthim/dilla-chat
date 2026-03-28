# Telemetry Relay — Design Spec

## Goal

Add optional client-side error and breadcrumb telemetry that relays through the Dilla server to pluggable backends (Sentry first, others later). Clients send platform-agnostic events via the existing WebSocket connection. The server enriches and forwards them.

## Architecture

```
Client (browser)                    Dilla Server                     Adapters
┌─────────────────┐    WS event     ┌──────────────┐
│ TelemetryClient │───────────────→ │ WS handler   │──→ SentryAdapter ──→ Sentry
│                 │  telemetry:*    │              │
│ - window.onerror│  Dilla format   │ TelemetryRelay│──→ (future adapters)
│ - unhandled rej │                 │ - validates  │
│ - breadcrumbs   │                 │ - rate limits│
│ - opt-in check  │                 │ - enriches   │
└─────────────────┘                 │ - dispatches │
                                    └──────────────┘
```

## Client: TelemetryClient

**File:** `client/src/services/telemetryClient.ts`

### Automatic capture

- `window.onerror` — uncaught exceptions
- `window.onunhandledrejection` — unhandled promise rejections
- `console.error` — captured as breadcrumbs only (not forwarded as errors)

### Breadcrumb collection (rolling buffer, max 20)

- Navigation changes (route transitions)
- UI clicks (element tag + text content, no input values)
- WebSocket events (type only, no payload)
- HTTP requests (method + URL + status code, no body)

### Manual API

```typescript
telemetry.captureError(error, { component: 'ChannelView' });
telemetry.addBreadcrumb('ui.click', 'Set Up Team button');
```

### Opt-in

Uses the existing `useTelemetryStore.optedIn` boolean (persisted in localStorage). If opted out, errors are still caught locally (to prevent crashes) but never sent via WebSocket. Toggle lives in User Settings under the existing Telemetry section. No new UI needed.

### Privacy

No message content, user input values, or encryption keys are sent. Only: stack traces, component names, route paths, element tags. Breadcrumb data fields are sanitized to exclude input element values.

## Wire Format

Events are sent as standard WebSocket messages using the existing Dilla protocol.

### telemetry:error

```json
{
  "type": "telemetry:error",
  "payload": {
    "level": "error",
    "message": "Cannot read property 'split' of undefined",
    "stack": "getInitials@MemberList.tsx:84:30\nrenderMember@...",
    "tags": {
      "component": "MemberList",
      "route": "/app"
    },
    "breadcrumbs": [
      {
        "type": "navigation",
        "message": "/setup -> /app",
        "data": { "from": "/setup", "to": "/app" },
        "ts": 1711382400000
      },
      {
        "type": "ui.click",
        "message": "Kanals tab",
        "ts": 1711382401000
      }
    ],
    "context": {
      "browser": "Firefox 128",
      "os": "macOS 15.3",
      "url": "http://localhost:8888/app",
      "viewport": "1440x900"
    },
    "timestamp": 1711382402000
  }
}
```

### telemetry:breadcrumb

Standalone breadcrumb sent between errors (for server-side buffering):

```json
{
  "type": "telemetry:breadcrumb",
  "payload": {
    "type": "navigation",
    "message": "/app -> /app/settings",
    "data": { "from": "/app", "to": "/app/settings" },
    "ts": 1711382403000
  }
}
```

## Server: TelemetryRelay

**Module:** `server-rs/src/telemetry/`

### Files

- `mod.rs` — `TelemetryRelay` struct, coordinates adapters, rate limiting
- `adapter.rs` — `TelemetryAdapter` trait, `TelemetryEvent` and `Breadcrumb` structs
- `sentry.rs` — Sentry adapter: translates Dilla events to Sentry envelopes, POSTs to ingest

### TelemetryAdapter trait

```rust
#[async_trait]
pub trait TelemetryAdapter: Send + Sync {
    async fn forward(&self, event: TelemetryEvent) -> Result<(), String>;
}
```

### TelemetryRelay

- Holds an `Option<Box<dyn TelemetryAdapter>>` — None when no adapter configured
- Rate limiting: per-user, 10 errors/minute, 60 breadcrumbs/minute. Excess silently dropped.
- Enriches events with server-side context before forwarding:
  - `server_name` — from config
  - `user.id` — from WebSocket auth
  - `release` — server version string
  - `environment` — from `DILLA_ENVIRONMENT` or "production"

### WebSocket integration

Two new event constants in `ws/events.rs`:
- `telemetry:error`
- `telemetry:breadcrumb`

The WS hub receives these events and calls `TelemetryRelay::forward()`. No database writes, no broadcast to other clients. Fire-and-forget — errors in the relay do not affect the client.

### Sentry adapter

Parses the DSN to extract: key, org, project ID, ingest URL. Translates the Dilla `TelemetryEvent` into a Sentry envelope (JSON items within the envelope protocol). POSTs to `https://{host}/api/{project}/envelope/` with `sentry_key` auth header. Uses `reqwest` (already a dependency).

## Configuration

```
DILLA_TELEMETRY_ADAPTER=sentry    # "sentry" or "none" (default: "none")
DILLA_SENTRY_DSN=https://key@org.ingest.sentry.io/project
DILLA_ENVIRONMENT=production      # optional, defaults to "production"
```

When `DILLA_TELEMETRY_ADAPTER` is "none" or unset, the relay is not created. WS telemetry events are silently dropped. No HTTP requests to external services.

## Testing

### Client

- `telemetryClient.test.ts`:
  - Captures `window.onerror` and sends `telemetry:error` via WS mock
  - Respects opt-out: opted-out client never calls `ws.send` for telemetry
  - Breadcrumb buffer limited to 20 entries (oldest dropped)
  - Sanitizes input element values from breadcrumb data
  - `captureError` includes current breadcrumbs in the event

### Server

- `telemetry/mod.rs` tests:
  - Dispatches to adapter when configured
  - Drops events silently when no adapter
  - Rate limiter allows under limit, drops over limit
- `telemetry/sentry.rs` tests:
  - Parses DSN correctly (key, host, project ID)
  - Produces valid Sentry envelope format
  - Enriches with server context (user ID, release, environment)
- `ws/` integration test:
  - WS `telemetry:error` event reaches relay
  - Mock HTTP server receives Sentry envelope

No E2E test against real Sentry — external service. Mock the HTTP endpoint.

## Files to Create/Modify

| File | Action |
|------|--------|
| `client/src/services/telemetryClient.ts` | Create |
| `client/src/services/telemetryClient.test.ts` | Create |
| `server-rs/src/telemetry/mod.rs` | Create |
| `server-rs/src/telemetry/adapter.rs` | Create |
| `server-rs/src/telemetry/sentry.rs` | Create |
| `server-rs/src/ws/events.rs` | Modify (add 2 constants) |
| `server-rs/src/ws/hub.rs` or `ws/handlers/` | Modify (handle telemetry events) |
| `server-rs/src/config.rs` | Modify (add 3 env vars) |
| `server-rs/src/main.rs` | Modify (init TelemetryRelay, pass to hub) |

## Out of Scope

- Performance tracing (future)
- Client-side Sentry SDK (we build a thin shim instead)
- Source map upload to Sentry
- Session replay
- Additional adapters beyond Sentry (future, but trait is ready)
