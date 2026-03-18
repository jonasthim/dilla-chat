# Code Review Report: Dilla

**Reviewed by:** Security, Performance, Architecture, Testing, Accessibility
**Files reviewed:** ~120 client files + ~40 server files (~32K lines total)
**Date:** 2026-03-18

---

## Critical (10 findings)

### 1. Federation transport has no authentication or encryption
- **File:** `server-rs/src/federation/transport.rs:58-97`
- **Dimensions:** Security
- **Description:** Federation connects over plain WebSocket with zero auth. Any host can connect as a peer and inject messages, trigger state sync dumps, modify presence, or delete messages across the mesh.
- **Recommendation:** Require TLS (wss://), add mutual auth handshake using join_secret, sign each FederationEvent with sending node's key.

### 2. WebSocket message handlers skip team membership authorization
- **File:** `server-rs/src/ws/client.rs:302-370`
- **Dimensions:** Security
- **Description:** `handle_message_send` creates messages in any channel_id without verifying the user is a member of the owning team. Same for DM handlers at line 1036. REST API handlers correctly check membership, but WS handlers do not.
- **Recommendation:** Add team membership and channel ownership verification in every WS event handler.

### 3. WebSocket edit/delete events broadcast regardless of authorization
- **File:** `server-rs/src/ws/client.rs:372-436`
- **Dimensions:** Security, Architecture
- **Description:** Edit/delete handlers broadcast events to all subscribers unconditionally. The DB write is gated on `msg.author_id == uid`, but the broadcast happens even when auth fails, allowing spoofed edits/deletes in clients' UI.
- **Recommendation:** Only broadcast after confirming the DB operation succeeded.

### 4. Client-server DM payload field name mismatch
- **File:** `client/src/services/websocket.ts:422` vs `server-rs/src/ws/events.rs:350`
- **Dimensions:** Architecture
- **Description:** Client sends `dm_id`, server expects `dm_channel_id`. All 5 DM WebSocket operations silently fail because serde deserializes the missing field as empty string. The `if let Ok(p) = serde_json::from_value(...)` pattern silently drops the parse error.
- **Recommendation:** Rename client fields from `dm_id` to `dm_channel_id`.

### 5. Single Mutex\<Connection\> serializes all database access
- **File:** `server-rs/src/db/mod.rs:29`
- **Dimensions:** Performance, Architecture
- **Description:** Every DB operation (reads and writes) contends on a single lock. Even with WAL mode, concurrent reads cannot proceed in parallel. Estimated ceiling: 500-2000 ops/sec vs 10-50x with a pool.
- **Recommendation:** Use a connection pool (r2d2-sqlite or deadpool-sqlite) with multiple read connections + 1 write connection.

### 6. `user_has_permission` issues up to 4 sequential DB queries per call
- **File:** `server-rs/src/db/queries.rs:586-629`
- **Dimensions:** Performance
- **Description:** Every permission-gated API request runs 4 separate queries serially. Combined with the single Mutex, this compounds the throughput bottleneck.
- **Recommendation:** Collapse into a single SQL query with JOINs.

### 7. Server has near-zero test coverage (12,228 lines, 6 tests)
- **File:** `server-rs/src/` (entire directory)
- **Dimensions:** Testing
- **Description:** Only 6 tests exist (observability UUID sanitization + webapp fallback routing). Zero tests for auth, database, WebSocket, federation, voice, and all 16 API handlers.
- **Recommendation:** Prioritize: auth.rs, db/queries.rs, ws/client.rs, federation/sync.rs, then API handlers.

### 8. Signal Protocol tested only at primitive level (79 lines test vs 984 lines source)
- **File:** `client/src/services/cryptoCore.test.ts`
- **Dimensions:** Testing
- **Description:** Tests cover only base64/concat/AES/HKDF utilities. X3DH, Double Ratchet, Sender Keys, CryptoManager, Ed25519, X25519 are all untested in TypeScript (the active browser code path).
- **Recommendation:** Port Rust test patterns: X3DH roundtrip, ratchet bidirectional, out-of-order messages, group sessions, safety numbers.

### 9. KeyStore has zero tests (681 lines)
- **File:** Missing `client/src/services/keyStore.test.ts`
- **Dimensions:** Testing
- **Description:** Identity key management, MEK derivation, key slots, passkey/PRF, recovery keys -- all untested. Bugs here can lock users out permanently.
- **Recommendation:** Test generate/persist identity, MEK wrap/unwrap, recovery key flow, corrupt keyfile rejection.

### 10. No live regions for messages or typing indicators
- **File:** `client/src/components/MessageList/MessageList.tsx:158-330`
- **Dimensions:** Accessibility (WCAG 4.1.3)
- **Description:** Zero `aria-live`, `role="log"`, or `role="status"` attributes in the entire codebase. Screen reader users are never notified of new messages -- the core functionality of a chat app is inaccessible.
- **Recommendation:** Add `role="log" aria-live="polite"` to message list, `role="status" aria-live="polite"` to typing indicator.

---

## High (17 findings)

### 11. JWT secret stored in plaintext in SQLite
- **File:** `server-rs/src/auth.rs:38-58`
- **Dimensions:** Security
- **Description:** JWT signing secret in `settings` table. Without DB passphrase (the default), it's plaintext on disk.
- **Recommendation:** Derive from DB passphrase via HKDF, or refuse to start without passphrase.

### 12. Unsafe static mutable for VERSION
- **File:** `server-rs/src/api/mod.rs:32`
- **Dimensions:** Security, Architecture
- **Description:** `pub static mut VERSION` is UB in multi-threaded Rust. Deprecated in Rust 2024 edition.
- **Recommendation:** Use `std::sync::OnceLock<String>`.

### 13. Config struct derives Debug, leaking secrets to logs
- **File:** `server-rs/src/config.rs:3`
- **Dimensions:** Security
- **Description:** `db_passphrase`, `cf_turn_api_token`, `turn_shared_secret`, `otel_api_key` all exposed via Debug.
- **Recommendation:** Custom Debug impl that redacts secret fields.

### 14. CORS defaults to very_permissive() allowing all origins
- **File:** `server-rs/src/api/mod.rs:45-47`
- **Dimensions:** Security
- **Description:** When `DILLA_ALLOWED_ORIGINS` is unset (default), any origin can make authenticated API requests.
- **Recommendation:** Default to restrictive policy; require explicit origin config for production.

### 15. Non-constant-time recovery key hash comparison
- **File:** `client/src/services/keyStore.ts:156-158`
- **Dimensions:** Security
- **Description:** Early-return byte comparison leaks timing info, reducing brute-force from 2^256 to ~8192 attempts.
- **Recommendation:** Use bitwise OR accumulator for constant-time comparison.

### 16. Federation state sync loads 100 messages per channel without pagination
- **File:** `server-rs/src/federation/sync.rs:114-119`
- **Dimensions:** Performance
- **Description:** Iterates ALL channels, loads 100 msgs each in one Mutex hold. 50 channels = 5000 messages, blocking DB for 500ms-2s.
- **Recommendation:** Paginate sync, transfer channel metadata first, stream messages in batches.

### 17. Federation sync merge does individual SELECT+INSERT per record (N+1)
- **File:** `server-rs/src/federation/sync.rs:157-212`
- **Dimensions:** Performance
- **Description:** 2000 messages = 4000 queries, no transaction batching, holding Mutex for 5-10 seconds.
- **Recommendation:** Wrap in BEGIN/COMMIT, use INSERT OR IGNORE.

### 18. MessageList renders all messages without virtualization
- **File:** `client/src/components/MessageList/MessageList.tsx:169-326`
- **Dimensions:** Performance
- **Description:** Every message DOM node mounted simultaneously with ReactMarkdown parsing. 500+ messages = slow renders, scroll jank.
- **Recommendation:** Implement virtualized rendering with react-virtuoso or @tanstack/virtual.

### 19. Zustand messageStore creates new Map on every mutation
- **File:** `client/src/stores/messageStore.ts:54-62`
- **Dimensions:** Performance
- **Description:** Any message in any channel triggers re-render of the current MessageList. 10 active channels = 10 unnecessary re-renders/second.
- **Recommendation:** Use granular selectors with `useShallow`, or switch from Map to plain objects with immer.

### 20. Missing index on dm_channel_id for DM queries
- **File:** `server-rs/migrations/001_initial.sql` (missing), `server-rs/src/db/dm_queries.rs:140-156`
- **Dimensions:** Performance
- **Description:** DM queries filter on `dm_channel_id` with no index. Full table scan degrades linearly with message count.
- **Recommendation:** `CREATE INDEX idx_messages_dm_channel ON messages(dm_channel_id, created_at);`

### 21. God file: ws/client.rs (1373 lines) mixing concerns
- **File:** `server-rs/src/ws/client.rs`
- **Dimensions:** Architecture
- **Description:** Single file handles all 30+ WS event types across messages, reactions, threads, voice, DMs. 194-line match statement.
- **Recommendation:** Split into domain-specific handler modules.

### 22. AppLayout.tsx is a god component (776 lines)
- **File:** `client/src/pages/AppLayout.tsx`
- **Dimensions:** Architecture
- **Description:** Manages WS lifecycle, data loading, presence, voice tracking, crypto init, layout, and keyboard shortcuts. Accesses 6 stores.
- **Recommendation:** Extract into custom hooks: useTeamSync, usePresenceEvents, useIdentityBackup, useCryptoRestore.

### 23. Hub callback architecture uses untyped closures
- **File:** `server-rs/src/ws/hub.rs:74-87`
- **Dimensions:** Architecture
- **Description:** 9 callback fields with `Fn(&str, &str, &str)` signatures -- impossible to know which param is which.
- **Recommendation:** Define typed event enum + mpsc broadcast channel.

### 24. Color contrast failure: --text-muted on dark backgrounds
- **File:** `client/src/styles/theme.css:17`
- **Dimensions:** Accessibility (WCAG 1.4.3)
- **Description:** `#4d6478` on `#121c26` = ~2.9:1 ratio. Fails 4.5:1 minimum. Used for timestamps, categories, typing indicators across 15+ CSS files.
- **Recommendation:** Increase to `#7a8e9e` (~4.5:1).

### 25. Interactive elements not keyboard accessible (divs with onClick)
- **File:** `client/src/components/TeamSidebar/TeamSidebar.tsx:48-54`, `ChannelList.tsx:109-117`, `SearchBar.tsx:138`, `StatusPicker.tsx:60`
- **Dimensions:** Accessibility (WCAG 2.1.1)
- **Description:** Team icons, channel items, search results, and status options are `<div>` with onClick but no role, tabIndex, or keyboard handlers.
- **Recommendation:** Use `<button>` elements or add role="button", tabIndex={0}, onKeyDown.

### 26. Modal dialogs lack focus trapping and ARIA roles
- **File:** `client/src/components/CreateChannel/`, `EditChannel/`, `NewDMModal/`, `ShortcutsModal/`
- **Dimensions:** Accessibility (WCAG 2.4.3, 1.3.1)
- **Description:** All modals are plain divs with no role="dialog", no aria-modal, no focus trap, no focus restore on close.
- **Recommendation:** Add dialog roles, focus-trap-react, manage focus lifecycle.

### 27. Presence indicators convey status by color alone
- **File:** `client/src/components/PresenceIndicator/PresenceIndicator.tsx:11-17`
- **Dimensions:** Accessibility (WCAG 1.4.1)
- **Description:** Online/idle/DND/offline distinguished solely by background-color. No aria-label, no role, no shape differentiation. Affects ~8% of male users.
- **Recommendation:** Add role="img", aria-label, and visual shape differentiation per status.

---

## Medium (19 findings)

### 28. WebSocket token passed as query parameter (exposed in logs)
- **File:** `server-rs/src/api/mod.rs:276`
- **Dimensions:** Security
- **Description:** JWT in URL query params logged by proxies/servers.

### 29. No rate limiting on auth endpoints
- **File:** `server-rs/src/api/auth_handlers.rs:42-103`
- **Dimensions:** Security
- **Description:** Challenge/verify/register endpoints have no per-IP rate limiting.

### 30. CSP allows connect-src to any HTTPS/WSS origin
- **File:** `client/src-tauri/tauri.conf.json:39`
- **Dimensions:** Security
- **Description:** Overly broad connect-src enables potential data exfiltration.

### 31. Skipped message keys in Double Ratchet accumulate without cleanup
- **File:** `client/src/services/cryptoCore.ts:413`
- **Dimensions:** Security
- **Description:** skippedKeys map grows indefinitely, expanding attack surface.

### 32. HKDF used for passphrase-to-key without proper work factor
- **File:** `client/src/services/cryptoCore.ts:961-968`
- **Dimensions:** Security
- **Description:** passphraseToKey uses HKDF (no iterations) instead of PBKDF2/Argon2.

### 33. Challenge HashMap vulnerable to memory exhaustion
- **File:** `server-rs/src/auth.rs:64-76`
- **Dimensions:** Security
- **Description:** Unbounded challenge storage, cleanup only every 300s.

### 34. WebSocket hub broadcasts clone message bytes per subscriber
- **File:** `server-rs/src/ws/hub.rs:198-211`
- **Dimensions:** Performance
- **Description:** Each broadcast clones Vec<u8> per subscriber. 100 users x 4KB = 400KB/broadcast.
- **Recommendation:** Use bytes::Bytes for O(1) clone.

### 35. Voice SFU renegotiation is O(N) sequential per room
- **File:** `server-rs/src/voice/sfu.rs:853-863`
- **Dimensions:** Performance
- **Description:** 10-person room join triggers 9 sequential renegotiations (50-200ms).
- **Recommendation:** Use futures::future::join_all for concurrent renegotiation.

### 36. Voice activity detection updates Zustand 50x/sec with 5 peers
- **File:** `client/src/services/webrtc.ts:860-877`
- **Dimensions:** Performance
- **Description:** 100ms interval x N peers = excessive re-renders for continuous voice levels.
- **Recommendation:** Only update on speaking state change or quantized level thresholds.

### 37. typing_throttle map grows without bounds
- **File:** `server-rs/src/ws/hub.rs:56`
- **Dimensions:** Performance
- **Description:** Entries never removed, memory leak over time.

### 38. No Vite code splitting or chunk optimization
- **File:** `client/vite.config.ts`
- **Dimensions:** Performance
- **Description:** emoji-picker-react (~200KB+), OpenTelemetry, react-markdown all in main bundle.

### 39. WebSocket messages dropped silently during reconnection
- **File:** `client/src/services/websocket.ts:161-169`
- **Dimensions:** Performance
- **Description:** No send queue; messages sent during disconnection are lost.

### 40. Error type abuse: rusqlite::Error for application-level errors
- **File:** `server-rs/src/api/messages.rs:58-61`
- **Dimensions:** Architecture
- **Description:** Business logic errors encoded as InvalidParameterName.

### 41. Silent error swallowing in all 30+ WS event handlers
- **File:** `server-rs/src/ws/client.rs:114`
- **Dimensions:** Architecture
- **Description:** Deserialization failures silently dropped. Enables bugs like the DM field mismatch to go undetected.

### 42. Dual crypto implementations with divergence risk
- **File:** `client/src/services/cryptoCore.ts` vs `client/src-tauri/src/crypto.rs`
- **Dimensions:** Architecture
- **Description:** Two independent Signal Protocol implementations that must stay synchronized.

### 43. Federation sync does not handle updates or conflicts
- **File:** `server-rs/src/federation/sync.rs:149-228`
- **Dimensions:** Architecture
- **Description:** "Create if not exists" only -- updates, deletes, and conflicts never propagated.

### 44. Inconsistent state management patterns across Zustand stores
- **File:** `client/src/stores/`
- **Dimensions:** Architecture
- **Description:** Mix of Map/Record, inconsistent persistence, `user: unknown` type requiring unsafe casts.

### 45. API client, WebSocket client, WebRTC service all have zero tests
- **File:** Missing: `api.test.ts`, `websocket.test.ts`, `webrtc.test.ts`
- **Dimensions:** Testing
- **Description:** 2,267 lines of critical service code with no tests.

### 46. Form inputs not programmatically associated with labels
- **File:** `client/src/components/CreateChannel/`, `EditChannel/`, `CreateIdentity.tsx`
- **Dimensions:** Accessibility (WCAG 1.3.1, 3.3.2)

---

## Low (10 findings)

### 47. Federation join secret used without key derivation
- **File:** `server-rs/src/federation/join.rs:49-56` | Security

### 48. unsafe-inline in style-src CSP
- **File:** `client/src-tauri/tauri.conf.json:39` | Security

### 49. ReactMarkdown remarkPlugins array recreated on every render
- **File:** `client/src/components/MessageList/MessageList.tsx:213-219` | Performance

### 50. has_users queries COUNT(*) without LIMIT
- **File:** `server-rs/src/db/mod.rs:97-101` | Performance

### 51. queries.rs exports all functions flat at module root
- **File:** `server-rs/src/db/mod.rs:13-17` | Architecture

### 52. Config struct growing without grouping (33 flat fields)
- **File:** `server-rs/src/config.rs:4-44` | Architecture

### 53. Test helpers use non-deterministic IDs
- **File:** `client/src/test/helpers.tsx:15` | Testing

### 54. Mocks in test setup may hide real bugs (RTCPeerConnection returns undefined not Promise)
- **File:** `client/src/test/setup.ts:59-82` | Testing

### 55. StatusPicker/SettingsLayout use divs instead of buttons
- **File:** `client/src/components/StatusPicker/StatusPicker.tsx:57-65` | Accessibility

### 56. Select elements and inputs suppress focus rings with outline: none
- **File:** `client/src/index.css:75`, multiple component CSS files | Accessibility

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 10 |
| High | 17 |
| Medium | 19 |
| Low | 10 |
| **Total** | **56** |

### Top 5 Actions by Impact

1. **Add WebSocket authorization checks** (#2, #3) -- any authenticated user can currently access any channel/DM and broadcast spoofed edits
2. **Authenticate federation transport** (#1) -- any network peer can inject messages and dump the database
3. **Fix DM field name mismatch** (#4) -- all DM WebSocket operations are silently broken
4. **Replace single Mutex DB with connection pool** (#5, #6) -- fundamental throughput ceiling
5. **Add Signal Protocol + KeyStore tests** (#8, #9) -- E2E encryption correctness is unverified in the browser code path

### Cross-Dimension Findings

Several issues were flagged by multiple dimensions:
- **Single Mutex DB** -- Performance + Architecture
- **WS edit/delete broadcast** -- Security + Architecture
- **unsafe static VERSION** -- Security + Architecture
- **Silent error swallowing in WS handlers** -- Architecture + Testing (enables #4 to go undetected)
