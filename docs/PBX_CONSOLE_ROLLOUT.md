# PBX Console rollout — 2026-10-18

Installed NIX PBX Console 1.0.0 on FreePBX 17.0.33.2 at `/admin/config.php?display=nixops` (Reports menu). The original module uses FreePBX login and section permissions plus a per-session token, including explicit authentication on localhost. It adds no public listener, schema migration, dialplan change or call-control action.

Features: live channels/endpoints/trunks, queue wallboard, phone/date/outcome call-leg reports, daily activity chart, CSV export, secure recording playback/download, current queue-log performance and nightly config/CDR snapshot health. Local call timestamps on this Bangladesh PBX use Asia/Dhaka; the CDRUSEGMT flag switches reports to UTC when enabled.

Validated on the PBX: PHP syntax and live AMI/CDR/queue/backup responses; missing session, wrong token, missing section permission, invalid dates/status/search denied; a real recording streamed as valid WAV; CSV exported with seven columns. GUI navigation was reviewed locally with sample data. Anonymous HTTP AJAX access returns 403. The installed backup service completed under its systemd sandbox and its timer is active. Only backup metadata is readable by the web service; archive and database backups are root-only.

Security follow-up: the old reported e-commerce dump was 128 bytes and not SQL. Two actual application SQL snapshots were generated and validated. The database password in the pasted command history matched the app's active password; it was rotated with coordinated environment/container recreation, and the app returned healthy. Credentials were not logged or committed. A fresh backup was taken using the new credentials. The PBX state directory was tightened from 0755 to 0700, owner asterisk.

Regression evidence: PBX agent active, application healthy, IVR enabled, signed `/api/trunks` 200, invalid dispatch and webhook signatures 401. Five existing order/courier tests passed. No real outbound calls were placed by this rollout; a full human call/DTMF/WebPhone check and an isolated restore drill remain separate checks.

The existing public FreePBX address uses HTTP. On this workstation, `Open-PbxConsole.ps1` starts a loopback-only SSH tunnel to provide encrypted network access without changing public routing. Open `http://127.0.0.1:18080/admin/config.php?display=nixops` while the tunnel is running and use the existing FreePBX login. The tunnel is limited to the current workstation. A public HTTPS hostname requires DNS/TLS provisioning.

Rollback: disable the local module with `fwconsole ma disable nixops`; disable the backup timer if needed. Existing PBX calling configuration does not depend on the module. Root-only application environment rollback material is under `/root/pre_security_upgrade_backup/`; PBX archives are under `/var/backups/nixops/`, application SQL snapshots under `/var/backups/nix-ecommerce/`. Never publish those directories or put their contents in Git.

## Version 1.2.0 — 2026-10-19

Added missed-call follow-up tasks, BD phone-format customer lookup and an allowlisted e-commerce orders link; per-user viewer/operator/supervisor scopes; audit events with HMAC-hashed customer lookup references; recording retention preview with reversible quarantine/restore; and admin-only operational settings. Email/Telegram alerts and SFTP/S3 uploads are preferences only and are not active until a server admin supplies and verifies a destination using protected server configuration. The settings screen explicitly warns operators not to enter secrets. Local SQLite state and the module code are included in the private nightly backup; the audit key is included when present. No permanent recording deletion is automated.

Validation after install: the isolated operations suite passed admin settings, POST enforcement, optimistic conflicts, URL allowlisting, viewer/operator permission scope, follow-up persistence, customer lookup, retention boundaries, symlink guard, quarantine/restore, audit and SQLite integrity. Live CSV and recording integration checks passed. The backup unit completed successfully and the latest archive contains the operations database and v1.2 module assets. Asterisk uptime remained continuous. The authenticated browser GUI and an actual phone call were not tested during this deployment.

## Version 1.1.0 — 2026-10-18

Added hourly call-leg activity, top ten destinations, recording-only reports/CSV, Today/7/30-day shortcuts and reset, full-window wallboard (Escape to exit), and a system-health view. Health shows disk capacity for system/recording locations, 1/5/15-minute load and backup freshness. Storage warnings begin at 85%; backup warnings appear when missing, failed or older than 36 hours. These are on-screen checks, not email alerts. The two storage locations may share one disk. Date presets use the PBX page date; reload after midnight to renew Today.

Deployed 1.1.0 with a root-only copy of the prior module for rollback. PHP/JS syntax passed. Live integration checks passed for authentication, CSRF, permissions, report/hourly totals, recording filtering, health, queues and backup. Browser sample-data checks covered report layout, date shortcuts, system health and wallboard. Actual browser remains at FreePBX login; no authenticated browser or phone call test was performed for this update. PBX uptime remained continuous across deployment.
