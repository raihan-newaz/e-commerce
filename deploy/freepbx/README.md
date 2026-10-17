# NIX PBX Console

Original MIT-licensed reporting module for FreePBX 17. Uses FreePBX authentication and the `nixops` module permission. It does not modify dialplans, originate calls or load commercial module code.

Features: live channel and PJSIP presence, registration health, queue wallboard, date/phone/outcome CDR reports with daily activity, CSV export, session-protected recording playback/download, current queue-log analytics and private nightly backup health.

Open **Reports → NIX PBX Console**, or `/admin/config.php?display=nixops`. Give operators the `nixops` permission using existing FreePBX access management. Recordings remain under `/var/spool/asterisk/monitor`; no public recording directory or new listener is created. Audio files missing from disk are reported as unavailable. WAV, MP3, OGG and GSM files are allowed; browser codec support varies. Reports show call legs, not unique customer conversations. CSV is limited to 5,000 records, date ranges to 31 days; queue history is bounded to the last 8 MB of the current log and explicitly labels partial history.

This Bangladesh deployment uses Asia/Dhaka for local CDR dates, or UTC when CDRUSEGMT is enabled. Use `Open-PbxConsole.ps1` to open an SSH tunnel from Windows if public HTTPS is unavailable; it binds only 127.0.0.1 and uses the existing `BDIX-VPS` SSH alias. The GUI at local port 18080 still requires FreePBX login.

Install `nixops/` under `/var/www/html/admin/modules/nixops/`, owner `asterisk:asterisk`, files 0644 and directories 0755. Run `fwconsole ma install nixops`. FreePBX may label this original local module as unsigned; its code is reviewable here. Do not disable global module signature checks. A dialplan reload is unnecessary.

`nixops-backup.py` runs as root, keeps seven private PBX config/CDR snapshots under `/var/backups/nixops` (0700), records SHA-256 and exposes only status metadata under `/var/lib/nixops`. The systemd timer runs around 03:30 Asia/Dhaka. `app-db-backup.py` separately backs up the e-commerce DB on its own host using a temporary 0600 client file; credentials never enter process arguments. Neither backup captures audio recordings. A restore drill on an isolated host is still required to validate disaster recovery.

Rollback: `fwconsole ma disable nixops`, then disable `nixops-backup.timer`. Existing FreePBX modules and call routing continue to function. Keep private snapshots. No database schema migration is performed by this module.

Version 1.1 adds hourly analytics, top destinations, recording-only filtering (including CSV), date presets, wallboard mode and System health. Click Wallboard to fill the window; Escape exits. Health checks are refreshed on opening the tab or pressing Refresh. No outbound notifications are sent. A backup older than 36 hours or storage usage at least 85% displays a warning. Reports remain call-leg statistics rather than unique-customer or agent-performance metrics.
