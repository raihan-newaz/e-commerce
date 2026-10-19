# Security audit remediation — 2026-10-18

## Implemented in application source

- Shared transactional order transitions for staff and IVR: restore product/variant stock, write stock movements, update customer counters, enforce fraud/trash/terminal-state rules and reject stale order updates.
- IVR protocol v2 signs timestamp and raw body, validates timestamps/signatures, ties callbacks to the app-generated call ID/recipient/order, and persists one final result per call. Callback notes and stock effects commit together.
- Durable initial/retry call jobs using the existing MessageLog table. Initial jobs commit with checkout; workers claim jobs atomically, recheck current order eligibility, defer outside calling hours, and flag uncertain dispatches for operator review rather than silently redialing.
- SIP proxy requires a valid staff session, permitted role and origin. It has connection/rate limits, expiry/revocation checks and a configurable TLS upstream. Integration-disable mode covers PBX HTTP/WebSocket actions.
- Payment invoice binding occurs only after verified gateway metadata/amount checks. Final payment updates reject orders cancelled, returned, trashed or repriced during verification.
- Atomic server-side note append endpoint; whole-note replacement requires the expected order revision. Timeline uses Dhaka time, explicit unknown legacy timestamps and call IDs for deduplication.
- WebPhone initialization invalidation, one dial per registration lifecycle, session cleanup, checked hangup results and retry UI. Credential caching removed. Call storage is per authenticated user and browser tab, cleared on logout, hidden from login. Widget dimensions/position are constrained on resize and mode changes.
- Real PBX-unavailable status replaces fabricated registered trunks, including an admin UI message.
- Paginated sitemap index includes products, canonical landing/store pages and standalone published builder pages. Relative image URLs are resolved correctly.
- Lazy-loaded telephony reduces the admin initial JavaScript entry from 577.32 kB to 317.68 kB minified (156.60 kB to 99.32 kB gzip in the recorded build).
- The original 15 scoped lint errors were fixed. Lint now scans all 244 application source files, rejects new violations and records existing legacy debt in a hashed baseline. `npm run lint:full` intentionally shows all remaining legacy violations.

## Prepared PBX changes, not deployed

The backup contained the original agent and callback source. Credential-free replacements and a least-privilege systemd unit are in `deploy/pbx/`. They implement v2 signatures, persistent call-ID deduplication, validated call-file fields, bounded HTTP requests, signed trunk requests, safe process execution and targeted hangup.

Follow [PBX_SECURITY_UPGRADE.md](docs/PBX_SECURITY_UPGRADE.md) to coordinate the app, agent, callback and dialplan updates. Legacy callbacks are intentionally incompatible with v2. The PBX needs a valid TLS WebSocket upstream. No live server configuration or credentials have been changed.

## Validation and remaining work

- Production build passed; the admin no longer reports a >500 kB entry chunk.
- Full TypeScript check passed during implementation; final check status is reported in the response.
- PBX agent/callback and lint-runner JavaScript syntax checks passed.
- Full-source lint ratchet: zero new violations, 643 existing legacy violations recorded. These are not represented as fixed; the majority are explicit-any typing and unused-code diagnostics.
- No new tests or live PBX/customer calls were run in this fix turn. The audit's earlier 89 passing tests predate these changes and are not claimed as post-fix regression results.
- Browser/device verification, real payment verification, PBX installation and real credential rotation remain outstanding. No database schema migration is required by these changes.
- Existing user backup/restore notes and credential-bearing backup archives were preserved and must remain out of Git.
