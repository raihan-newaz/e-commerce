# PBX protocol v2 rollout

The local backup contains the original `/opt/pbx-ivr-agent/agent.js`, a callback shell script and systemd unit. Updated, credential-free replacements are in `deploy/pbx/`. Protocol v2 is installed on the live PBX. The follow-up check confirmed the agent runs as `asterisk`, signed trunk requests return 200, invalid dispatch/callback signatures return 401, and production IVR remains enabled. Do not copy private backups or config.json into Git.

The follow-up also replaced the unusable database-backup claim with validated private SQL snapshots, rotated the database password exposed in the pasted command report, and verified the application recovered healthy. Current PBX state-directory permissions are 0700. The custom reporting panel and nightly PBX snapshots are documented in `deploy/freepbx/README.md`. This check did not place a chargeable call or repeat a complete customer-call lifecycle.

## Coordinated installation required

1. Pause automated IVR and wait for existing calls to finish. Deploy the app and PBX changes together. Legacy signatures are intentionally rejected: there is no insecure compatibility fallback.
2. Rotate the previously exposed PBX signing secret and SIP extension password. Use a fresh random signing secret of at least 32 characters. Update the app's encrypted IVR setting (or `PBX_IVR_SECRET` if no saved setting), the PBX private `config.json` `apiSecret`, and `PBX_WEBRTC_PASSWORD`. Rotating only an environment variable does not replace an existing encrypted database setting. Keep the SIP extension's dial permissions and outbound spend restricted.
3. Install `deploy/pbx/agent.cjs` and `callback.cjs` in `/opt/pbx-ivr-agent/`. Preserve the existing private `config.json` with its webhookUrl/callerId/trunkContext/allowedIps; replace its signing secret. Make it readable only to the service owner (mode 600). Never use `allowedIps: ["*"]`.
4. Install the supplied systemd unit. It runs as `asterisk`, not root. Ensure that user can read the config, access the Asterisk control socket, and write `/var/lib/pbx-ivr-agent`, `/var/spool/asterisk/ivr-staging`, and `/var/spool/asterisk/outgoing`. Staging and outgoing must be on the same filesystem for atomic call-file moves. Confirm `/usr/sbin/asterisk` and `/usr/bin/node` paths on the server.
5. Replace the existing `ivr-callback.sh` with the supplied `.sh.example` content and make it executable. Update **every** callback invocation in the `ecommerce-order-verify` custom dialplan to pass a fourth quoted argument: `"${IVR_CALL_ID}"`. Preserve the existing order/status/phone arguments. The call file sets inherited `__IVR_CALL_ID`, `__ORDER_ID`, `__CUSTOMER_PHONE`, and `__ORDER_AMOUNT`. Reload the dialplan after reviewing the changes; do not overwrite FreePBX-generated configuration.
6. The HTTP agent binds loopback by default. Expose it to the application through an authenticated-network path/TLS reverse proxy with a source IP allowlist; do not publish port 7088 unrestricted. `PBX_BIND_HOST` can be set to the private tunnel address if required. Confirm the allowedIps list matches the actual peer address; forwarded HTTP headers are not trusted.
7. Configure a valid TLS WebSocket listener/reverse proxy on the PBX and set app `PBX_SIP_UPSTREAM_URL=wss://<your-pbx-host>/ws` (include the configured port if needed). TLS certificate verification stays enabled. The browser uses the app's authenticated `/ws-sip`; old `PBX_WEBRTC_WS_SERVER` is no longer used. Restrict direct PBX WebSocket access to the application server.
8. Reload systemd and restart the agent, deploy/restart the app, then verify with an operator-owned phone before enabling customer calls. Check one call, its callback, cancellation/restock, duplicate callback, hangup, reconnect and a short mobile viewport. Check reverse proxy WebSocket upgrade forwarding and cookie forwarding to the app.

## Wire contract

- HMAC-SHA256 input is the exact string `timestamp + "." + rawBody`; send the hex digest in `X-PBX-Signature` and integer Unix seconds in `X-PBX-Timestamp` (five-minute tolerance).
- Dispatch JSON contains `callId`, `orderId`, `phone`, `amount`, `callerId`. `callId` is the application's message-log ID and the PBX's durable idempotency key. Do not replace it with a provider-generated ID.
- Callback JSON contains `callId`, `orderId`, `phone`, `status`. Return one final outcome per call. Accepted statuses: CONFIRMED, CANCELLED, CALL_ENDED_NO_INPUT, INVALID_INPUT, NO_ANSWER, BUSY. Duplicate callbacks are acknowledged without repeating stock changes or retry scheduling.
- Trunk requests sign the empty GET body. Hangup requests use the same v2 signing format.

## Reliability and operations

Application call jobs are persisted using the existing MessageLog table (`IVR_JOB`); callback deduplication uses its existing unique dedupeKey (`IVR_RECEIPT`). No schema migration is needed. Initial jobs commit with checkout. Before dispatch, the worker rechecks the order and calling hours. Interrupted/uncertain dispatches become UNKNOWN rather than blindly creating another chargeable call. Operators must reconcile UNKNOWN records with the PBX before redialing. PBX state files in `/var/lib/pbx-ivr-agent` must survive restarts and not be deleted while call IDs may be retried.

If deployment cannot be coordinated, leave IVR disabled. App source fixes alone do not rotate a real credential or update the remote PBX.
