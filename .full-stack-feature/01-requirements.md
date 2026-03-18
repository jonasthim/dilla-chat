# Requirements: Implement Code Review Findings

## Problem Statement
Multi-dimension code review identified 56 findings (10 Critical, 17 High, 19 Medium, 10 Low) across security, performance, architecture, testing, and accessibility. The most critical issues allow unauthorized access via WebSocket, unauthenticated federation, and silently broken DM functionality.

## Acceptance Criteria
- [ ] All Critical findings addressed
- [ ] All High security findings addressed
- [ ] DM WebSocket operations functional (field name fix)
- [ ] WebSocket handlers check team membership before operations
- [ ] Edit/delete broadcasts gated on authorization success
- [ ] Silent error swallowing replaced with logging + client error responses
- [ ] unsafe static mut VERSION replaced with OnceLock
- [ ] Config Debug redacts secrets
- [ ] Key accessibility fixes (live regions, keyboard nav, contrast)

## Scope

### In Scope (Priority Order)
1. Security: WS authorization, broadcast gating, unsafe static, config debug, CORS default
2. Bug: DM field name mismatch
3. Architecture: WS error logging, error type cleanup
4. Accessibility: Live regions, keyboard nav, contrast, focus trapping
5. Performance: DB index for dm_channel_id, permission query optimization

### Out of Scope (Future Work)
- DB connection pool (architectural change, needs separate design)
- Federation auth overhaul (needs protocol design)
- Message list virtualization (needs UI testing)
- Full test suite creation (separate effort)
- Vite code splitting

## Technology Stack
- Server: Rust (axum, rusqlite, tokio-tungstenite)
- Client: React 19 + TypeScript (Zustand, Vite)

## Configuration
- Stack: rust + react
- API Style: rest
- Complexity: high
