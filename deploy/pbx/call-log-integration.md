# PBX call history events

The OMS accepts signed PBX call completion events at `POST /api/ivr/cdr-webhook`. The PBX event sender must POST JSON with the same signing secret saved in **Settings → Auto IVR Calling**. It signs the exact UTF-8 request body as:

```text
HMAC-SHA256(secret, `${unixTimestamp}.${rawBody}`)
```

Send these headers:

```text
Content-Type: application/json
X-PBX-Timestamp: <10 digit Unix timestamp>
X-PBX-Signature: <lowercase hex HMAC>
```

Example payload:

```json
{
  "providerCallId": "asterisk-unique-id-1740000000.42",
  "phone": "01912345678",
  "direction": "INBOUND",
  "status": "MISSED",
  "agentName": "Agent 2703",
  "startedAt": "2026-10-20T10:15:00.000Z",
  "endedAt": "2026-10-20T10:15:23.000Z",
  "durationSeconds": 23,
  "talkSeconds": 0,
  "disposition": "NO ANSWER",
  "metadata": {
    "recordingUrl": "https://<configured-pbx-api-host>/protected/recording/<temporary-token>"
  }
}
```

`direction` is `INBOUND` or `OUTBOUND`; `status` is `COMPLETED`, `MISSED`, `BUSY`, `FAILED`, or another supported call state. `providerCallId` must be stable so PBX retries update the same record. `recordingUrl` is optional, but if present must use HTTPS on the PBX API host configured in Auto IVR Calling and should be a short-lived, access-controlled URL. The order is linked by the supplied `orderId`, or by matching the caller phone to the latest non-trashed order.

Run `server/prisma/call-log-migration.sql` once against the application database before enabling call history writes. PBX CDR records and recordings appear after the PBX is configured to send this event; WebPhone initiated calls are logged by the application automatically.

Configure browser-call credentials in **Settings → Auto IVR Calling → PBX WebPhone Extension Credentials**. Enter the SIP domain, extension username and extension password. The password is encrypted with `DATA_ENCRYPTION_KEY`; only the WebPhone session endpoint sends it to signed-in calling staff because JsSIP needs it to authenticate. Keep `PBX_SIP_UPSTREAM_URL` on the server as an environment variable; it is deliberately not editable in the admin form.
