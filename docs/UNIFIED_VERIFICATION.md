# Unified migration verification

Local delivery: `D:\Antigravity\Ecommerce`. Source project remains separate.
No GitHub push, VPS deployment, public traffic change or live integration send
was performed by this migration.

## Delivered

- Separate admin and storefront bundles served by one Express listener. Admin
  uses `/admin`; APIs, media, Socket.IO and public builder pages share the origin.
- Root build/start/dev commands, one multi-stage Docker image and one Compose
  service. Linux host networking reaches the existing loopback MariaDB. Container
  runs as a non-root user, with persistent uploads, read-only root, resource and
  log limits, readiness check and graceful shutdown.
- Independent MariaDB database `nix_ecommerce_dev` and a dedicated user granted
  access only to it. Original encryption key retained privately for copied
  integration settings. External integrations fail closed in the test copy.
- Database-backed transactional checkout idempotency, stable browser retry keys,
  and an atomic order-created email outbox. No automatic schema change on start.
- WooCommerce-style SMTP settings, editable per-event templates, customer/admin
  new-order notifications, product/totals content, sandboxed preview, test send,
  delivery history and explicit resend. SMTP credentials encrypted/masked.
- Optional email field on landing COD checkout. Customers without an email can
  still order; imported orders do not infer email from matching phone numbers.
- Legacy decorative checkout anchors removed only from the rendered landing
  design, preserving saved documents and the real checkout. Studio design panels
  remain available with a selection; design-token inputs have accessible labels.

## Evidence

| Check | Result |
| --- | --- |
| Root/server/client/storefront dependency installation | Passed; client lock repaired for its missing zod dependency |
| Frontend and backend production builds | Passed |
| All three application TypeScript checks | Passed |
| Builder/unit/publication suite | 78 passed |
| Existing server audit suite | 6 passed |
| Unified production API integration suite | 7 passed |
| Full browser/visual suite | 12 passed, including desktop/mobile screenshot baselines |
| Docker Compose syntax | Passed |
| Final Docker image build | Passed: `nix-ecommerce:local` |
| Docker container smoke | Passed: non-root/read-only, application shells/404s, unavailable DB gives 503, no baked secrets/development tools |

Unified integration tests cover production route shells, separated asset paths,
true API/media/asset 404s, CSP, health/readiness, public settings redaction,
customer/staff session separation, actual Socket.IO authorization, media upload
and deletion, SMTP encryption/masking/escaping, blocked test sends, simultaneous
checkout retries, correct multi-product totals/stock deduction, replay after a
real process restart, and changed-payload conflict. Test fixtures are removed.

Browser tests cover Pages creation, Studio editing/undo/save/publish, revision and
draft isolation, mobile/desktop image baselines, reusable design components,
permissions, public forms/review/export, dynamic product loops, theme header/footer,
linked checkout publication, mobile layout, admin deep links/refresh/logout,
email preview, and a real multi-product landing checkout through Thank-you refresh
with product names and images. All 12 browser tests passed. The original desktop
and mobile visual baselines were retained, with explicit stable fixture content.

The Docker smoke uses `node scripts/tests/docker-smoke.cjs`, binds its temporary
container only to `127.0.0.1:3012`, deliberately points at an unavailable dummy
database, and removes its own container afterward. It never connects to original
customer data. The local application remains running at `http://localhost:3000`;
health, database readiness, admin login and the copied Borka landing returned 200.

The initial copy audit matched counts in all **42 source tables**, found **85
media references**, **zero missing files**, and **zero reserved slug collisions**.
New email/idempotency tables and temporary test fixtures are outside that original
count comparison. Private details are in ignored `.local/data-audit.json`.

## Source changes reviewed

Uncommitted source code was included in the initial snapshot, excluding the
generated `seed.js`. Later concurrent source changes were reviewed: eager loading
for the first homepage image was carried over. Old per-service Nginx Dockerfile
changes are superseded by the unified container and CyberPanel compression/cache
instructions. Proposed `.webp` default banner paths were not copied because those
files were absent in the source and copy. Inline font `onload` handlers were not
introduced because they conflict with the production CSP. Unified storefront
settings use a separate localStorage cache key. The original edits were preserved.

## Limits before live cutover

- SMTP transport is configured but real sending/deliverability requires provider
  credentials and sender DNS. Local tests intentionally recorded previews only.
- Real courier bookings, SMS/WhatsApp, payment callbacks and external stock sync
  were not sent against copied customer data. They require provider-specific
  staging checks, callback signatures and final-origin verification.
- CyberPanel/OpenLiteSpeed configuration is documented against official HTTP and
  WebSocket proxy references. It has not been applied or tested on the VPS.
- This is migration verification, not a guarantee that all inherited features or
  every historical security issue are fixed. Complete the explicit VPS acceptance
  checks before traffic switch and retain backups/old containers for rollback.
- Dependency audit found zero advisories in the server production dependencies
  and storefront dependency tree. Admin build tooling has seven inherited
  advisories in the Tailwind 3 dependency chain (five high, two moderate). These
  development packages are excluded from the runtime image. The suggested
  Tailwind 4 upgrade is a breaking CSS/toolchain migration and was not forced as
  part of preserving the existing design. Track it before rebuilding from
  untrusted templates or adopting a new styling toolchain.
- Docker host networking is intended for the Linux VPS. Windows Docker smoke
  testing uses a separate temporary loopback-published bridge container; Windows
  host MariaDB access differs from Linux host networking.

See [deployment/rollback](UNIFIED_DEPLOYMENT.md) and
[CyberPanel/Docker configuration](CYBERPANEL_DOCKER.md).
