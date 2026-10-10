# Unified VPS deployment and rollback

This is a new project and container (`nix-ecommerce`), not a replacement compose command in the old checkout. Keep the existing NIX containers available until acceptance. Other VPS services need no network, firewall or database bind changes.

## Prepare

1. Commit this new repository, review `git diff --cached`, and confirm `.env`, uploads, `.local`, logs and database dumps are not tracked. Deploy it into a new VPS directory.
2. Confirm an unused loopback port with `ss -ltnp`; default `ECOMMERCE_PORT=3010`. Set another unused port in the compose root `.env` if necessary. Do not reuse 5000/3007/3008 while the old app is running.
3. Build `docker compose build ecommerce`. The image contains both frontend builds and one Node process. Host networking reaches the VPS's existing localhost MariaDB; `API_HOST=127.0.0.1` prevents public listening.
4. Prepare `server/.env`: production `NODE_ENV`, canonical `PUBLIC_ORIGIN=https://nix.bd`, `CLIENT_URL=https://nix.bd`, distinct JWT secret, retained original `DATA_ENCRYPTION_KEY`, and the reviewed database URL. Start with `INTEGRATIONS_ENABLED=false`. Do not deploy the local dev database password or localhost public origin.
5. Persist media under `server/uploads`. The container runs as UID 1000; set ownership only on the new upload directory (`chown -R 1000:1000 ./server/uploads`). Never recursively change ownership on the old project or another service.

## Backup and isolated staging

Create a MariaDB credentials file outside the repository, readable only by root, with `[client]`, user, password, host and port. Use the actual database name from the deployed configuration. Keep dumps private.

```sh
umask 077
BACKUP_DIR="/root/nix-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
mysqldump --defaults-extra-file=/root/.config/nix/mysql.cnf --single-transaction --skip-lock-tables YOUR_LIVE_DATABASE > "$BACKUP_DIR/database.sql"
tar -czf "$BACKUP_DIR/uploads.tar.gz" -C /PATH/TO/OLD/server uploads
```

Restore into a newly created staging database and use a user restricted to it. Do not point staging to live data. Apply the additive schema SQL **once** to staging, then validate data counts and media. No seed/reset/db-push is needed in production.

Build the tools image to run the version-pinned Prisma CLI (the runtime image excludes development tools):

```sh
docker build --target build -t nix-ecommerce-tools .
docker run --rm --network host --env-file ./server/.env nix-ecommerce-tools node server/node_modules/prisma/build/index.js db execute --file server/prisma/upgrade-single-server.sql --schema server/prisma/schema.prisma
docker compose up -d ecommerce
curl --fail http://127.0.0.1:3010/api/ready
```

The SQL adds an optional order email column and three new tables. It does not drop or rewrite historical data. It is a one-time upgrade from the inherited schema; check information_schema before execution. If any addition already exists, do not blindly rerun the whole SQL. A partial upgrade must be reviewed before retrying.

## Cutover

1. Arrange a short checkout/admin write freeze using the existing reverse proxy's maintenance response; pause inbound writes/webhooks as well. Keep the last pre-cutover backup.
2. Dump the latest live data and restore it to a fresh final database; copy latest uploads. Preserve all IDs and encryption keys. Apply the reviewed additive upgrade once and set the new app's restricted DB user to the final database. Staging fixtures must never be included.
3. Start the new container on the verified unused port. Confirm `/api/ready`, product/landing loads, `/admin/login`, `/admin/orders`, media, Studio preview/publication and checkout totals.
4. Point only the `nix.bd` virtual host to `http://127.0.0.1:3010`. Forward Host and X-Forwarded-Proto; configure WebSocket Upgrade for `/socket.io`. The app expects one trusted reverse-proxy hop.
5. Redirect `my.nix.bd` page URLs: `/` → `https://nix.bd/admin`, `/login` → `/admin/login`, `/orders/...` → `/admin/orders/...`, and equivalent staff paths. Existing `/api/*` webhook clients must be proxied during transition or updated explicitly; do not redirect webhook POSTs through the generic page redirect. Verify external courier/payment/WooCommerce callback URLs.
6. Set `INTEGRATIONS_ENABLED=true` only on the final reviewed database. Enable and test desired SMTP notifications with an operator-controlled recipient. Check real callback signatures and credentials before reopening writes.
7. Monitor readiness, error rates, new orders, inventory deductions, notification logs and media. Stop old NIX containers only after acceptance. Never run global compose down, prune or MariaDB bind changes.

## Rollback

Before writes reopen, return the reverse proxy to the old upstream and keep the new container isolated. Existing containers and original data are still available.

After the new app accepts orders, the old database is stale. Freeze all writes, backup the new final database, reconcile orders/inventory/settings accepted since cutover, and point the old app at the reconciled data before switching traffic. The upgrade is additive, so old code can use the upgraded database; retain the encryption key and take a backup before this operation. Do not restore a pre-cutover dump over new orders.

Health: `/api/health` is process liveness; `/api/ready` executes a database query and returns 503 when unavailable. Docker uses readiness as its health check. No migration or seed runs at container startup.
