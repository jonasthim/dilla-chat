# Telemetry Relay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional client-to-server error telemetry with breadcrumbs, relayed to Sentry via a pluggable adapter on the server.

**Architecture:** Client captures errors and breadcrumbs, sends them as WebSocket events (`telemetry:error`, `telemetry:breadcrumb`). Server receives, enriches with user/server context, rate-limits, and forwards to a configurable adapter (Sentry first). Client opt-in via existing telemetry store. Server opt-in via `DILLA_TELEMETRY_ADAPTER` env var.

**Tech Stack:** TypeScript (client), Rust/axum/tokio (server), reqwest (HTTP to Sentry), serde (JSON), async-trait

---

## Task 1: Server — adapter trait + event types

**Files:**
- Create: `server-rs/src/telemetry/adapter.rs`
- Create: `server-rs/src/telemetry/mod.rs`

- [ ] **Step 1: Create `adapter.rs` with types and trait**

```rust
// server-rs/src/telemetry/adapter.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Breadcrumb {
    #[serde(rename = "type")]
    pub crumb_type: String,
    pub message: String,
    #[serde(default)]
    pub data: serde_json::Value,
    pub ts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientContext {
    #[serde(default)]
    pub browser: String,
    #[serde(default)]
    pub os: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub viewport: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEvent {
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub stack: String,
    #[serde(default)]
    pub tags: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub breadcrumbs: Vec<Breadcrumb>,
    #[serde(default)]
    pub context: ClientContext,
    #[serde(default)]
    pub timestamp: u64,
    // Enriched by server:
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub server_name: String,
    #[serde(default)]
    pub release: String,
    #[serde(default)]
    pub environment: String,
}

#[async_trait::async_trait]
pub trait TelemetryAdapter: Send + Sync {
    async fn forward(&self, event: TelemetryEvent) -> Result<(), String>;
}
```

- [ ] **Step 2: Create `mod.rs` with TelemetryRelay**

```rust
// server-rs/src/telemetry/mod.rs
pub mod adapter;
pub mod sentry;

use adapter::{TelemetryAdapter, TelemetryEvent, Breadcrumb};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

pub use adapter::*;

struct RateLimiter {
    /// user_id -> (error_count, breadcrumb_count, window_start)
    buckets: Mutex<HashMap<String, (u32, u32, Instant)>>,
}

impl RateLimiter {
    fn new() -> Self {
        Self { buckets: Mutex::new(HashMap::new()) }
    }

    fn check(&self, user_id: &str, is_error: bool) -> bool {
        let mut buckets = self.buckets.lock().unwrap();
        let now = Instant::now();
        let entry = buckets.entry(user_id.to_string()).or_insert((0, 0, now));

        // Reset window every 60 seconds
        if now.duration_since(entry.2).as_secs() >= 60 {
            *entry = (0, 0, now);
        }

        if is_error {
            if entry.0 >= 10 { return false; }
            entry.0 += 1;
        } else {
            if entry.1 >= 60 { return false; }
            entry.1 += 1;
        }
        true
    }
}

pub struct TelemetryRelay {
    adapter: Option<Box<dyn TelemetryAdapter>>,
    rate_limiter: RateLimiter,
    server_name: String,
    release: String,
    environment: String,
}

impl TelemetryRelay {
    pub fn new(
        adapter: Option<Box<dyn TelemetryAdapter>>,
        server_name: String,
        release: String,
        environment: String,
    ) -> Self {
        Self {
            adapter,
            rate_limiter: RateLimiter::new(),
            server_name,
            release,
            environment,
        }
    }

    pub async fn forward_error(&self, user_id: &str, mut event: TelemetryEvent) {
        if self.adapter.is_none() { return; }
        if !self.rate_limiter.check(user_id, true) { return; }

        event.user_id = user_id.to_string();
        event.server_name = self.server_name.clone();
        event.release = self.release.clone();
        event.environment = self.environment.clone();

        if let Some(ref adapter) = self.adapter {
            if let Err(e) = adapter.forward(event).await {
                tracing::warn!("telemetry forward failed: {}", e);
            }
        }
    }

    pub fn forward_breadcrumb(&self, user_id: &str, _breadcrumb: Breadcrumb) {
        // Rate-limit breadcrumbs; server-side buffering is out of scope for v1
        if self.adapter.is_none() { return; }
        let _ = self.rate_limiter.check(user_id, false);
    }
}
```

- [ ] **Step 3: Run `cargo test`**

Run: `cd server-rs && cargo test`
Expected: All existing tests pass (module compiles but no new tests yet).

- [ ] **Step 4: Commit**

```
git add server-rs/src/telemetry/
git commit -m "feat: add telemetry adapter trait, event types, and relay with rate limiting"
```

---

## Task 2: Server — Sentry adapter

**Files:**
- Create: `server-rs/src/telemetry/sentry.rs`
- Test: inline `#[cfg(test)] mod tests`

- [ ] **Step 1: Write tests for DSN parsing**

In `sentry.rs`, add tests:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dsn_standard() {
        let dsn = "https://abc123@o456.ingest.sentry.io/789";
        let parsed = SentryConfig::from_dsn(dsn).unwrap();
        assert_eq!(parsed.key, "abc123");
        assert_eq!(parsed.host, "o456.ingest.sentry.io");
        assert_eq!(parsed.project_id, "789");
    }

    #[test]
    fn parse_dsn_invalid_returns_error() {
        assert!(SentryConfig::from_dsn("not-a-dsn").is_err());
    }

    #[tokio::test]
    async fn builds_valid_envelope_body() {
        let adapter = SentryAdapter::new(
            SentryConfig { key: "k".into(), host: "h".into(), project_id: "1".into() },
            reqwest::Client::new(),
        );
        let event = test_event();
        let envelope = adapter.build_envelope(&event);
        assert!(envelope.contains("\"event_id\""));
        assert!(envelope.contains("\"exception\""));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server-rs && cargo test telemetry`
Expected: FAIL — `SentryConfig`, `SentryAdapter` not defined.

- [ ] **Step 3: Implement `sentry.rs`**

```rust
// server-rs/src/telemetry/sentry.rs
use super::adapter::{TelemetryAdapter, TelemetryEvent};
use reqwest::Client;

pub struct SentryConfig {
    pub key: String,
    pub host: String,
    pub project_id: String,
}

impl SentryConfig {
    pub fn from_dsn(dsn: &str) -> Result<Self, String> {
        let url = url::Url::parse(dsn).map_err(|e| format!("invalid DSN: {}", e))?;
        let key = url.username().to_string();
        if key.is_empty() { return Err("DSN missing key".into()); }
        let host = url.host_str().ok_or("DSN missing host")?.to_string();
        let project_id = url.path().trim_start_matches('/').to_string();
        if project_id.is_empty() { return Err("DSN missing project ID".into()); }
        Ok(Self { key, host, project_id })
    }
}

pub struct SentryAdapter {
    config: SentryConfig,
    client: Client,
}

impl SentryAdapter {
    pub fn new(config: SentryConfig, client: Client) -> Self {
        Self { config, client }
    }

    pub fn build_envelope(&self, event: &TelemetryEvent) -> String {
        let event_id = uuid::Uuid::new_v4().to_string().replace('-', "");
        let header = serde_json::json!({ "event_id": event_id, "dsn": format!("https://{}@{}/{}", self.config.key, self.config.host, self.config.project_id) });
        let item_header = serde_json::json!({ "type": "event" });
        let item = serde_json::json!({
            "event_id": event_id,
            "level": event.level,
            "platform": "javascript",
            "timestamp": event.timestamp as f64 / 1000.0,
            "server_name": event.server_name,
            "release": event.release,
            "environment": event.environment,
            "user": { "id": event.user_id },
            "tags": event.tags,
            "exception": {
                "values": [{
                    "type": "Error",
                    "value": event.message,
                    "stacktrace": { "frames": parse_stack(&event.stack) }
                }]
            },
            "breadcrumbs": {
                "values": event.breadcrumbs.iter().map(|b| serde_json::json!({
                    "type": b.crumb_type,
                    "message": b.message,
                    "data": b.data,
                    "timestamp": b.ts as f64 / 1000.0,
                })).collect::<Vec<_>>()
            },
            "contexts": {
                "browser": { "name": event.context.browser },
                "os": { "name": event.context.os },
            }
        });
        let item_str = serde_json::to_string(&item).unwrap_or_default();
        format!("{}\n{}\n{}", header, item_header, item_str)
    }
}

fn parse_stack(stack: &str) -> Vec<serde_json::Value> {
    stack.lines().filter(|l| !l.is_empty()).map(|line| {
        serde_json::json!({ "filename": line.trim(), "in_app": true })
    }).collect()
}

#[async_trait::async_trait]
impl TelemetryAdapter for SentryAdapter {
    async fn forward(&self, event: TelemetryEvent) -> Result<(), String> {
        let url = format!("https://{}/api/{}/envelope/", self.config.host, self.config.project_id);
        let envelope = self.build_envelope(&event);
        self.client.post(&url)
            .header("Content-Type", "application/x-sentry-envelope")
            .header("X-Sentry-Auth", format!("Sentry sentry_key={}, sentry_version=7", self.config.key))
            .body(envelope)
            .send()
            .await
            .map_err(|e| format!("sentry HTTP error: {}", e))?;
        Ok(())
    }
}
```

- [ ] **Step 4: Add `url` crate to Cargo.toml if not present**

Check `Cargo.toml` for `url` dependency. If missing, add: `url = "2"`.

- [ ] **Step 5: Run tests**

Run: `cd server-rs && cargo test telemetry`
Expected: All Sentry tests pass.

- [ ] **Step 6: Commit**

```
git add server-rs/src/telemetry/sentry.rs server-rs/Cargo.toml
git commit -m "feat: add Sentry adapter with DSN parsing and envelope builder"
```

---

## Task 3: Server — config + WS integration

**Files:**
- Modify: `server-rs/src/config.rs`
- Modify: `server-rs/src/ws/events.rs`
- Modify: `server-rs/src/ws/client.rs`
- Modify: `server-rs/src/main.rs`

- [ ] **Step 1: Add config fields**

In `server-rs/src/config.rs`, add to the `Config` struct:
```rust
pub telemetry_adapter: String,
pub sentry_dsn: String,
pub environment: String,
```

In `Config::load()`, add:
```rust
telemetry_adapter: env_str("DILLA_TELEMETRY_ADAPTER", "none"),
sentry_dsn: env_str("DILLA_SENTRY_DSN", ""),
environment: env_str("DILLA_ENVIRONMENT", "production"),
```

- [ ] **Step 2: Add WS event constants**

In `server-rs/src/ws/events.rs`, add after the existing client→server constants:
```rust
pub const EVENT_TELEMETRY_ERROR: &str = "telemetry:error";
pub const EVENT_TELEMETRY_BREADCRUMB: &str = "telemetry:breadcrumb";
```

- [ ] **Step 3: Handle telemetry events in WS client handler**

In `server-rs/src/ws/client.rs`, add a match arm in the event dispatch (after the existing arms):
```rust
EVENT_TELEMETRY_ERROR => {
    if let Some(ref relay) = hub.telemetry_relay {
        if let Ok(te) = serde_json::from_value::<crate::telemetry::TelemetryEvent>(event.payload) {
            let relay = Arc::clone(relay);
            let uid = user_id.to_string();
            tokio::spawn(async move { relay.forward_error(&uid, te).await; });
        }
    }
}
EVENT_TELEMETRY_BREADCRUMB => {
    if let Some(ref relay) = hub.telemetry_relay {
        if let Ok(bc) = serde_json::from_value::<crate::telemetry::Breadcrumb>(event.payload) {
            relay.forward_breadcrumb(user_id, bc);
        }
    }
}
```

- [ ] **Step 4: Add `telemetry_relay` field to Hub**

In `server-rs/src/ws/hub.rs`, add to the `Hub` struct:
```rust
pub telemetry_relay: Option<Arc<crate::telemetry::TelemetryRelay>>,
```

Initialize as `None` in `Hub::new()`.

- [ ] **Step 5: Wire up in `main.rs`**

In `server-rs/src/main.rs`:
1. Add `mod telemetry;` at the top.
2. After creating the hub, initialize the relay:

```rust
let telemetry_relay = if cfg.telemetry_adapter == "sentry" && !cfg.sentry_dsn.is_empty() {
    match telemetry::sentry::SentryConfig::from_dsn(&cfg.sentry_dsn) {
        Ok(sentry_cfg) => {
            let adapter = telemetry::sentry::SentryAdapter::new(sentry_cfg, reqwest::Client::new());
            tracing::info!("Telemetry: Sentry adapter enabled");
            Some(Arc::new(telemetry::TelemetryRelay::new(
                Some(Box::new(adapter)),
                cfg.team_name.clone(),
                env!("CARGO_PKG_VERSION").to_string(),
                cfg.environment.clone(),
            )))
        }
        Err(e) => {
            tracing::error!("Invalid DILLA_SENTRY_DSN: {}", e);
            None
        }
    }
} else {
    tracing::info!("Telemetry: disabled (no adapter configured)");
    None
};
hub.telemetry_relay = telemetry_relay;
```

- [ ] **Step 6: Run `cargo test`**

Run: `cd server-rs && cargo test`
Expected: All tests pass (610+).

- [ ] **Step 7: Commit**

```
git add server-rs/src/config.rs server-rs/src/ws/events.rs server-rs/src/ws/client.rs server-rs/src/ws/hub.rs server-rs/src/main.rs
git commit -m "feat: wire telemetry relay into WS handler and server config"
```

---

## Task 4: Client — TelemetryClient

**Files:**
- Create: `client/src/services/telemetryClient.ts`
- Create: `client/src/services/telemetryClient.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// client/src/services/telemetryClient.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();
vi.mock('./websocket', () => ({
  ws: { send: mockSend, isConnected: () => true },
}));

vi.mock('../stores/telemetryStore', () => ({
  useTelemetryStore: { getState: () => ({ enabled: true }) },
}));

import { TelemetryClient } from './telemetryClient';

describe('TelemetryClient', () => {
  let client: TelemetryClient;

  beforeEach(() => {
    mockSend.mockClear();
    client = new TelemetryClient('test-team');
  });

  it('captures error and sends via WS', () => {
    client.captureError(new Error('test error'), { component: 'Test' });
    expect(mockSend).toHaveBeenCalledWith('test-team', expect.objectContaining({
      type: 'telemetry:error',
    }));
  });

  it('includes breadcrumbs in error event', () => {
    client.addBreadcrumb('ui.click', 'button clicked');
    client.captureError(new Error('crash'));
    const payload = mockSend.mock.calls[0][1].payload;
    expect(payload.breadcrumbs).toHaveLength(1);
    expect(payload.breadcrumbs[0].message).toBe('button clicked');
  });

  it('limits breadcrumb buffer to 20', () => {
    for (let i = 0; i < 25; i++) {
      client.addBreadcrumb('test', `crumb ${i}`);
    }
    client.captureError(new Error('test'));
    const payload = mockSend.mock.calls[0][1].payload;
    expect(payload.breadcrumbs).toHaveLength(20);
    expect(payload.breadcrumbs[0].message).toBe('crumb 5'); // oldest dropped
  });

  it('does not send when opted out', () => {
    vi.mocked(await import('../stores/telemetryStore')).useTelemetryStore.getState = () => ({ enabled: false });
    client.captureError(new Error('ignored'));
    expect(mockSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd client && npx vitest run telemetryClient`
Expected: FAIL — `TelemetryClient` not defined.

- [ ] **Step 3: Implement `telemetryClient.ts`**

```typescript
// client/src/services/telemetryClient.ts
import { ws } from './websocket';
import { useTelemetryStore } from '../stores/telemetryStore';

interface Breadcrumb {
  type: string;
  message: string;
  data?: Record<string, unknown>;
  ts: number;
}

interface TelemetryErrorPayload {
  level: string;
  message: string;
  stack: string;
  tags: Record<string, string>;
  breadcrumbs: Breadcrumb[];
  context: {
    browser: string;
    os: string;
    url: string;
    viewport: string;
  };
  timestamp: number;
}

const MAX_BREADCRUMBS = 20;

export class TelemetryClient {
  private breadcrumbs: Breadcrumb[] = [];
  private teamId: string;

  constructor(teamId: string) {
    this.teamId = teamId;
  }

  setTeamId(teamId: string): void {
    this.teamId = teamId;
  }

  addBreadcrumb(type: string, message: string, data?: Record<string, unknown>): void {
    this.breadcrumbs.push({ type, message, data, ts: Date.now() });
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) {
      this.breadcrumbs = this.breadcrumbs.slice(-MAX_BREADCRUMBS);
    }
  }

  captureError(error: Error | string, tags?: Record<string, string>): void {
    if (!useTelemetryStore.getState().enabled) return;
    if (!this.teamId || !ws.isConnected(this.teamId)) return;

    const err = typeof error === 'string' ? new Error(error) : error;
    const payload: TelemetryErrorPayload = {
      level: 'error',
      message: err.message,
      stack: err.stack ?? '',
      tags: tags ?? {},
      breadcrumbs: [...this.breadcrumbs],
      context: {
        browser: navigator.userAgent.split(' ').pop() ?? '',
        os: navigator.platform,
        url: window.location.href,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      },
      timestamp: Date.now(),
    };

    ws.send(this.teamId, { type: 'telemetry:error', payload });
  }

  /** Install global error handlers. Call once on app startup. */
  install(): void {
    window.addEventListener('error', (event) => {
      this.captureError(event.error ?? event.message, { source: 'window.onerror' });
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      this.captureError(reason, { source: 'unhandledrejection' });
    });
  }
}

/** Singleton instance — team ID set after auth. */
export const telemetryClient = new TelemetryClient('');
```

- [ ] **Step 4: Run tests**

Run: `cd client && npx vitest run telemetryClient`
Expected: All pass.

- [ ] **Step 5: Commit**

```
git add client/src/services/telemetryClient.ts client/src/services/telemetryClient.test.ts
git commit -m "feat: add TelemetryClient with error capture, breadcrumbs, and opt-in"
```

---

## Task 5: Client — install hooks + wire into app

**Files:**
- Modify: `client/src/pages/AppLayout.tsx` (or app entry)
- Modify: `client/src/hooks/useTeamSync.ts`

- [ ] **Step 1: Install telemetry client on app mount**

In the app entry (e.g., `AppLayout.tsx` or `App.tsx`), add near the top of the component:

```typescript
import { telemetryClient } from '../services/telemetryClient';

// Inside useEffect on mount:
useEffect(() => {
  telemetryClient.install();
}, []);
```

- [ ] **Step 2: Set team ID after auth**

In `useTeamSync.ts`, after the WS connection is established and `activeTeamId` is known:

```typescript
import { telemetryClient } from '../services/telemetryClient';

// After WS connects:
telemetryClient.setTeamId(activeTeamId);
```

- [ ] **Step 3: Add navigation breadcrumbs**

In `AppLayout.tsx`, add a route change listener:

```typescript
import { useLocation } from 'react-router-dom';

const location = useLocation();
useEffect(() => {
  telemetryClient.addBreadcrumb('navigation', `${location.pathname}`, { to: location.pathname });
}, [location.pathname]);
```

- [ ] **Step 4: Run full test suite**

Run: `cd client && npx vitest run`
Expected: All 1601+ tests pass.

Run: `cd server-rs && cargo test`
Expected: All 610+ tests pass.

- [ ] **Step 5: Commit**

```
git add client/src/pages/AppLayout.tsx client/src/hooks/useTeamSync.ts
git commit -m "feat: install telemetry hooks and wire into app lifecycle"
```

---

## Task 6: Server — relay tests

**Files:**
- Modify: `server-rs/src/telemetry/mod.rs` (add `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write relay unit tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    struct MockAdapter { call_count: AtomicU32 }
    impl MockAdapter { fn new() -> Self { Self { call_count: AtomicU32::new(0) } } }

    #[async_trait::async_trait]
    impl TelemetryAdapter for MockAdapter {
        async fn forward(&self, _event: TelemetryEvent) -> Result<(), String> {
            self.call_count.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    fn test_event() -> TelemetryEvent {
        TelemetryEvent {
            level: "error".into(), message: "test".into(), stack: String::new(),
            tags: Default::default(), breadcrumbs: vec![], timestamp: 0,
            context: ClientContext { browser: String::new(), os: String::new(), url: String::new(), viewport: String::new() },
            user_id: String::new(), server_name: String::new(), release: String::new(), environment: String::new(),
        }
    }

    #[tokio::test]
    async fn forwards_to_adapter() {
        let mock = Arc::new(MockAdapter::new());
        let relay = TelemetryRelay::new(Some(Box::new(mock.clone())), "s".into(), "v".into(), "test".into());
        relay.forward_error("u1", test_event()).await;
        assert_eq!(mock.call_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn drops_when_no_adapter() {
        let relay = TelemetryRelay::new(None, "s".into(), "v".into(), "test".into());
        relay.forward_error("u1", test_event()).await; // should not panic
    }

    #[tokio::test]
    async fn rate_limits_errors() {
        let mock = Arc::new(MockAdapter::new());
        let relay = TelemetryRelay::new(Some(Box::new(mock.clone())), "s".into(), "v".into(), "test".into());
        for _ in 0..15 {
            relay.forward_error("u1", test_event()).await;
        }
        assert_eq!(mock.call_count.load(Ordering::SeqCst), 10); // capped at 10/min
    }
}
```

Note: `MockAdapter` needs to be wrapped in `Arc` and the trait impl adjusted. The `TelemetryRelay` needs to accept `Arc<dyn TelemetryAdapter>` instead of `Box<dyn TelemetryAdapter>` for the mock to work with `Arc::clone`. Adjust as needed during implementation.

- [ ] **Step 2: Run tests**

Run: `cd server-rs && cargo test telemetry`
Expected: All pass.

- [ ] **Step 3: Commit**

```
git add server-rs/src/telemetry/mod.rs
git commit -m "test: add relay unit tests for dispatch, drop, and rate limiting"
```

---

## Task 7: Verification

- [ ] **Step 1: Run full server test suite**

Run: `cd server-rs && cargo test`
Expected: All tests pass.

- [ ] **Step 2: Run full client test suite**

Run: `cd client && npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run cargo clippy**

Run: `cd server-rs && cargo clippy`
Expected: No new warnings in telemetry module.

- [ ] **Step 4: Manual smoke test**

1. Set `DILLA_TELEMETRY_ADAPTER=sentry` and `DILLA_SENTRY_DSN=https://fake@o1.ingest.sentry.io/1` (or a real DSN)
2. Start server with `cargo run -- --insecure`
3. Verify log: "Telemetry: Sentry adapter enabled"
4. Open client, trigger an error (e.g., navigate to broken route)
5. Check server logs for "telemetry forward failed" (expected with fake DSN) or Sentry dashboard (with real DSN)
