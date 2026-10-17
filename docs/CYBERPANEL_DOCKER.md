# CyberPanel + one Docker application

Use CyberPanel's existing OpenLiteSpeed and MariaDB. Do not install another proxy,
publish another public port, or change MariaDB's localhost bind. Apply these steps
only to the NIX virtual hosts; other hosted services keep their configuration.

## Application container

`docker-compose.yml` uses one non-root Node container, host networking, a loopback
listener, read-only root filesystem, a 64 MB temporary filesystem and persistent
uploads. Docker rotates logs (3 × 10 MB), caps processes at 128, and defaults to
768 MB RAM / 1 CPU. Set `ECOMMERCE_MEMORY_LIMIT`, `ECOMMERCE_CPUS` and
`ECOMMERCE_PORT` in the compose root `.env` after checking available VPS resources.
The Node heap is capped at 512 MB; raise it with the memory limit for large imports.
The 45-second stop window lets active checkout requests finish. Only `/tmp` and
the uploads mount are writable. MariaDB backups remain independent of the image.
The image installs Debian's `webp` tools (`cwebp`) in the build and runtime stages.
During image build, local storefront JPEG/PNG assets get smaller sibling WebP files;
the original files stay intact. Browsers that advertise WebP receive those variants
for both `/images/*` and `/uploads/media/*` URLs. New JPEG/PNG Media Gallery uploads
are optimized automatically. GIF animation and original uploads remain unchanged.

On the Linux VPS (host networking is intentional):

```sh
ss -ltnp | grep ':3010 '
mkdir -p ./server/uploads/media
chown -R 1000:1000 ./server/uploads
chmod 600 ./server/.env
docker compose config --quiet
docker compose build ecommerce
docker compose up -d ecommerce
docker compose ps
curl --fail http://127.0.0.1:3010/api/ready
docker compose logs --tail 80 ecommerce
```

After copying an existing uploads backup to the new persistent directory, generate
WebP siblings once for the old JPEG/PNG media. The command preserves originals and
is safe to rerun; it only converts files when the source is newer than its variant.

```sh
docker exec --user 1000 nix-ecommerce node scripts/optimize-images.cjs server/uploads/media
```

The script reports how many variants were created and the approximate saved bytes.
`WEBP_QUALITY` (default `82`) and `WEBP_MAX_DIMENSION` (default `2560`) can be set
in the container environment. If an uploaded image's WebP is not smaller than its
original, the original is served instead. For non-Docker CyberPanel Node installs,
install the OS package that provides `cwebp` (`webp` on Debian/Ubuntu) before
starting the app, then run `npm run media:optimize:uploads` from the project root.

If port 3010 already belongs to another service, choose an unused port and use it
consistently below. Never stop an unknown listener. `server/.env` must contain the
production origin (`PUBLIC_ORIGIN=https://nix.bd`, `CLIENT_URL=https://nix.bd`),
production secrets, and the reviewed database URL. Keep integrations disabled for
staging. Follow [the deployment guide](UNIFIED_DEPLOYMENT.md) for backup, schema
upgrade and final data sync before switching public traffic. Startup never seeds
or migrates the database. An unhealthy status signals a failed readiness check;
Docker does not automatically restart an otherwise running unhealthy container.
Use a bounded MariaDB pool, for example append
`?connection_limit=5&pool_timeout=10&connect_timeout=5` to a database URL without
query parameters (`&` when parameters already exist). Start at five connections
on a VPS with other services; measure before increasing. Never print the URL in logs.

## Reverse proxy in CyberPanel / OpenLiteSpeed

Issue/retain the domain SSL certificate in CyberPanel. Edit only the `nix.bd`
virtual host using its vHost configuration or OpenLiteSpeed WebAdmin. Preserve
CyberPanel's existing SSL/listener configuration and ACME challenge context.

1. Add a **Web Server external application** at the virtual-host level:
   name `nixEcommerce`, address `127.0.0.1:3010`, max connections `100`, initial
   request timeout `60`, retry timeout `0`, response buffering `No`.
2. Add a **Proxy context** for URI `/` using the `nixEcommerce` external app.
   Remove a conflicting old root proxy/rewrite only in this host. Do not strip
   `/admin`, `/api` or landing path prefixes. Keep the ACME challenge's more
   specific static context so certificate renewal remains functional.
3. Add a **WebSocket Proxy** for URI `/socket.io/`, address `127.0.0.1:3010`.
   This supplements the HTTP proxy used for Socket.IO polling. Public HTTPS uses
   WSS; the local upstream uses plain HTTP/WS.
4. Keep the original Host and forward `X-Forwarded-Proto: https` on HTTPS
   requests and a sanitized `X-Forwarded-For` client address. The app trusts only
   loopback proxies. Verify the forwarded protocol before testing secure cookies.
5. Disable LSCache/full-page caching for this app host. Checkout, admin, orders,
   tracking and APIs must never be shared from cache. The app marks API responses
   `no-store` and HTML `no-cache`; fingerprinted assets use one-year immutable
   caching. Enable normal gzip/Brotli compression in OpenLiteSpeed. Do not rewrite
   JavaScript/CSS or cache authenticated responses with a WordPress optimizer.
6. Keep upload body limits at least as high as the app's configured media limit
   (currently 8 MB per media file); use 20 MB for the vhost request body limit.
   Make a graceful reload through CyberPanel after saving. Do not replace the
   global OpenLiteSpeed configuration or restart every hosted service.

Official configuration references:
[HTTP external app and proxy context](https://docs.openlitespeed.org/config/reverseproxy/),
[WebSocket proxy](https://docs.openlitespeed.org/config/reverseproxy/websocket/).
CyberPanel labels vary by installed version; verify the resulting virtual-host
configuration rather than pasting Nginx directives into OpenLiteSpeed.

## Acceptance after proxy setup

```sh
curl --fail https://nix.bd/api/health
curl --fail https://nix.bd/api/ready
curl --fail https://nix.bd/robots.txt
curl --fail https://nix.bd/sitemap.xml
curl --fail https://nix.bd/api/sitemap.xml
curl -I https://nix.bd/admin/orders
curl -I https://nix.bd/assets/missing.js
curl -I https://nix.bd/api/not-real
ss -ltnp | grep ':3010 '
docker stats --no-stream nix-ecommerce
```

Expect ready status, actual 404s for misses, and only `127.0.0.1:3010` listening.
In the browser verify `/admin/login`, refresh on `/admin/orders`, media upload,
landing checkout/thank-you, and admin live updates. Socket.IO should upgrade to
WebSocket (HTTP 101). Check cookies are Secure/HttpOnly and API responses never
show LSCache hits. Test webhook callbacks and payment return origins separately
before enabling live integrations. Check certificate renewal still works.

For `my.nix.bd`, redirect ordinary admin page links to `https://nix.bd/admin/...`
after cutover. Preserve or explicitly remap webhook/API callbacks first: a blanket
301 can change POST behavior and must not be used as an API migration strategy.
Do not enable SMTP until a real test email is accepted and DNS SPF/DKIM/DMARC is
configured for the sender domain. Delivery to an inbox still depends on provider
policy. Rollback and reconciliation steps are in the deployment guide.
