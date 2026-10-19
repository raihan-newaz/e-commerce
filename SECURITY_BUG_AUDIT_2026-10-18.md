# E-commerce security and bug audit — 2026-10-18

## Scope and limits

Reviewed admin, storefront and backend source, with emphasis on authentication/authorization routes, checkout, payments, stock transitions, uploads, HTML sanitization, WebPhone, IVR, notes and SEO. This is a source/build audit, not a completed browser/device or production penetration test. No real customer call, payment or production-data mutation was performed. Application code was not changed.

## Findings

### High priority

1. **IVR cancellation skips inventory and customer accounting.** `server/src/modules/orders/ivrWebhook.ts:141` directly updates status and notes. Unlike `orderController.ts:770`, it does not restore product/variant stock, create stock movements or increment cancellation counters. Cancel a pending order via IVR: stock remains deducted. Subsequent normal cancellation is a no-op. Use one transactional order-transition service for both paths.

2. **IVR signature permits replay.** `ivrWebhook.ts:12` accepts a nonnumeric timestamp because the age comparison with NaN is false. The HMAC at line 17 signs only the body, so a captured valid request can also receive a fresh timestamp. There is no persisted event deduplication. Local execution of the extracted verifier confirmed both cases; invalid signatures still fail. This requires possession of a previously signed request, not merely an arbitrary unsigned body. Sign timestamp + body, validate an integer timestamp, and persist unique event/call IDs.

3. **IVR status race bypasses order safeguards.** `ivrWebhook.ts:141` checks the previously fetched status but writes using only the ID. A simultaneous staff transition can be overwritten. The webhook also lacks the ordinary trash/fraud-review checks in `orderController.ts:741`. Use conditional transactional transitions and the same eligibility policy as staff actions.

4. **Public SIP proxy has no application authentication or origin gate.** `server/src/server.ts:60` forwards `/ws-sip*` upgrades before Express authentication/rate limits. Anyone reaching this endpoint can open a connection to the PBX, increasing exposure to SIP authentication guessing and resource exhaustion. SIP authentication may still prevent unauthorized calls; this is not proof calls can be made without credentials. Authenticate upgrades, restrict origin and exact path, enforce limits, and configure the upstream instead of hardcoding it. The upstream currently uses unencrypted HTTP WebSocket transport.

### Medium priority

5. **Payment attempt can be pinned to an unverified invoice.** `server/src/modules/storefront/uddoktaPayment.ts:96` stores invoiceId before gateway verification and metadata validation. A wrong invoice supplied through a valid payment-return link can prevent the later genuine invoice being accepted. Verify first, then atomically bind the matching invoice and amount.

6. **Delayed/retried calls use stale order state and are not durable.** `ivrWebhook.ts:127` and `storefrontController.ts:576` use in-memory timers with captured order data. Orders confirmed/cancelled before the timer fires can still be called; repeated callbacks can schedule duplicate retries; process restarts lose jobs. Re-read eligibility before dialing and use durable, deduplicated jobs.

7. **Async WebPhone setup can outlive the widget.** `client/src/components/orders/WebPhoneModal.tsx:172` sets `isMounted` false on cleanup but never reads it after the config request at line 127. Closing/remounting during the request can still create a UA and dial afterward, with no later cleanup for that orphan. Abort or invalidate pending initialization and stop any stale UA.

8. **Every SIP registration event triggers another dial.** `WebPhoneModal.tsx:153` unconditionally calls `dialCustomer`. Re-registration/reconnect can initiate another call, and the old session reference is replaced. Guard dialing per intentional call request and stop registration when the call is finished.

9. **Hangup failures are displayed as success.** `WebPhoneModal.tsx:256` swallows API errors and always says the Asterisk channel was killed. The server at `ivrRoutes.ts:324` also returns parsed upstream JSON without propagating the upstream HTTP failure and has no explicit timeout. Check status/result, show failure, and permit retry—especially for restored calls that have no browser session to terminate.

10. **Call details survive logout and appear on the login page.** `client/src/context/WebPhoneContext.tsx:30` restores customer phone/name/order from user-independent localStorage. The provider wraps the login route in `client/src/App.tsx`; `AuthContext.tsx:55` does not clear that storage. On a shared device, logout/reload within five minutes displays the prior customer's call details. Scope call storage to an authenticated user and clear it on logout.

11. **Concurrent internal notes overwrite each other.** `client/src/components/orders/OrderNotesCard.tsx:190` submits the full old note plus new text. `orderController.ts:287` allows replacement, while the IVR webhook independently performs the same read/append/write pattern. Two agents or an agent plus webhook can lose a note. Use append-only note records or an atomic server-side append/version check.

12. **Integration-disable mode does not cover all PBX operations.** `server/src/utils/integrationSafety.ts` blocks Axios, which DOES cover IVR dispatch; however, `ivrRoutes.ts:324` uses fetch and `server.ts:60` uses raw HTTP, neither checks the integration flag. WebPhone config also remains available. Test/clone environments can therefore still contact the PBX through hangup/browser calling/proxy paths. Apply the global flag consistently to those operations.

13. **PBX failure becomes fabricated healthy trunk status.** `server/src/modules/orders/ivrRoutes.ts:45` catches the real trunk lookup failure and responds with static records, including Registered. Operators cannot distinguish a healthy trunk from an unreachable PBX. Return an explicit unavailable state and preserve the error for diagnostics.

14. **WebPhone can overflow or become inaccessible on small/resized viewports.** `WebPhoneModal.tsx:305` uses a fixed 320px minimized width; its initial left offset is at least 16px, so a 320px viewport overflows. Position is clamped only while dragging, not on viewport resize or widget expansion. There is no viewport-height scroll constraint for short screens. Use viewport-bounded dimensions, reclamp on resize/mode changes, and make controls scrollable. Source-derived finding; browser screenshots have not been collected.

15. **Note timeline hides distinct IVR logs.** `OrderNotesCard.tsx:143` treats matching date prefix OR matching status as a duplicate. Multiple calls on a day or with the same result can disappear from the UI. Deduplicate using call/log IDs. Separately, `formatDhakaDateTime` at line 36 omits the Asia/Dhaka timezone and untimestamped notes use the order's latest updatedAt, so timeline dates can be misleading.

### Lower priority / coverage gaps

16. **Sitemap truncates larger catalogues.** `server/src/modules/storefront/seoController.ts:31` limits products to 2,000 and pages to 500 without a paginated sitemap index. Published builder pages are not queried. Add sitemap pagination and all intended public canonical page types.

17. **Large admin entry bundle.** Production build reports a 577.32 kB minified entry chunk (156.60 kB gzip), exceeding Vite's 500 kB warning threshold. Consider loading telephony and other infrequently used features on demand; measure user-facing performance before setting a target.

18. **Lint fails and does not cover the entire application.** Root `package.json` only lints builder directories and its installer. The current run reports 15 errors. Most admin/storefront/backend code, including new telephony files, is outside this command's coverage. Resolve the errors, expand coverage and add focused regressions for findings above.

## Validation

- Full TypeScript check: passed (server, admin, storefront).
- Production build: passed; admin bundle-size warning described above.
- Production npm dependency audit: zero reported vulnerabilities in root, server, client and storefront at audit time. This does not establish absence of application vulnerabilities.
- Existing audit tests: 6 passed.
- Existing order/courier tests: 5 passed.
- Extracted IVR verifier: nonnumeric timestamp accepted; changed timestamp accepted with same signed body; invalid signature rejected.
- Existing builder tests: 78 passed (89 tests passed across the three suites).
- Lint: failed with 15 errors, 0 warnings.
- Tests emitted a Redis connection warning and fell back to DB queries; Redis-backed behavior is not verified.
- Browser visual checks, authenticated end-to-end checkout/payment, real PBX behavior, server/network configuration and the previous exposed credentials' rotation remain unverified.

## Recommended order

First fix shared order transitions and IVR replay protection; restrict the SIP proxy and complete credential rotation. Then address payment binding, call lifecycle/jobs, note concurrency and logout privacy. Follow with responsive checks and SEO/performance improvements.
