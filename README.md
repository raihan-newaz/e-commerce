# NIX Ecommerce — one application server

Storefront `/`, staff portal `/admin`, API `/api`, Socket.IO `/socket.io`, landing pages `/:slug`, thank-you `/:slug/thank-you`, published Studio documents `/b/:slug`.

## Local setup

Use Node.js 22 or newer, MariaDB/MySQL, and npm. Run from this directory:

```powershell
npm ci
npm run setup
# Only for the first copy; refuses an existing destination database:
npm run db:clone
cd server
npx prisma db push
cd ..
npm run build
npm start
```

Open `http://localhost:3000` and `http://localhost:3000/admin/login`. `npm run dev` first builds, then watches both frontend bundles and reloads the backend. There are no Vite HTTP listeners. Frontend edits require a browser refresh after the watcher completes.

The delivered local `.env` points to `nix_ecommerce_dev`, with a database user restricted to that database. Source data remains in the old project. The clone script expects local XAMPP MariaDB by default; `MYSQL_BIN`, `MYSQL_ADMIN_USER`, `MYSQL_ADMIN_PASSWORD`, and `SOURCE_ENV` can override local setup. It deliberately refuses an existing target and does not drop databases. Failed partial copies require operator review before rerunning.

`server/.env` is resolved independently of the shell working directory. `PUBLIC_ORIGIN` is the single canonical origin for payment callbacks, page links and courier webhooks. Production requires it. Staff and customer cookies remain distinct; server permissions remain authoritative.

## Safe test environment

`INTEGRATIONS_ENABLED=false` blocks backend courier, WooCommerce, SMS, WhatsApp and Meta API calls. Public payment and analytics settings are disabled. SMTP delivery is also blocked. Integration configuration and encrypted credentials are preserved, so production can explicitly enable integrations after review. Do not enable them against a cloned database containing customer data.

## Email

Super Administrators configure **Settings → Email**, at `/admin/settings/email`:

- SMTP host, TLS port, encrypted password, sender, reply-to and new-order admin recipients.
- Per-event enable switches, subjects, headings and message bodies with template tags.
- Order product lists, quantities and totals, saved-template preview, test email and delivery logs.
- Customer emails use the checkout email snapshot. Orders without an email still work; no email is guessed from a phone number. Existing imported orders without an email snapshot cannot receive customer email notifications.

Order-created, status and courier/payment notifications feed a database queue. Local testing records `PREVIEW` deliveries. Production sends queued jobs in the same application process. Failed and uncertain jobs require review and an explicit resend. SMTP cannot guarantee exactly-once delivery; stale in-flight jobs are marked `UNKNOWN` and are never automatically retried. Admin new-order recipients receive the initial order event. Cancellation and payment events are customer events.

SMTP supports SSL/TLS on 465 and mandatory STARTTLS on 25, 587 or 2525, certificate validation, public host resolution and short timeouts. Local/private SMTP hosts are rejected. No SMTP delivery was performed during local verification; real sending requires your SMTP credentials and `INTEGRATIONS_ENABLED=true`.

## Validation

```powershell
npm run typecheck
npm run test:builder
npm --prefix server run test:audit
npm run test:unified
npm run test:builder:e2e
npm run audit:data
docker compose config --quiet
```

The unified test suite refuses any database except `nix_ecommerce_dev`. It starts a temporary server on loopback port 3110, creates and cleans test fixtures, and verifies checkout replay across a real process restart. Playwright uses the single server on 3000. Review `.local/data-audit.json` for data/media checks; this local report is excluded from Git.

See [deployment guide](docs/UNIFIED_DEPLOYMENT.md), [CyberPanel/Docker setup](docs/CYBERPANEL_DOCKER.md) and [verification report](docs/UNIFIED_VERIFICATION.md). Older files in `docs` describe inherited features and historical audits; use this README for current startup and URLs.
