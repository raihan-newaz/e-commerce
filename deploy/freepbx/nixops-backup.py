#!/usr/bin/env python3
"""Root-only PBX config/CDR snapshots. Does not reload or modify Asterisk."""
import datetime as dt
import grp
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path('/var/backups/nixops')
STATE = Path('/var/lib/nixops/backup-status.json')

def manifest(data):
    STATE.parent.mkdir(mode=0o750, parents=True, exist_ok=True)
    os.chown(STATE.parent, 0, grp.getgrnam('asterisk').gr_gid)
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(data))
    os.chmod(temporary, 0o640)
    os.chown(temporary, 0, grp.getgrnam('asterisk').gr_gid)
    temporary.replace(STATE)

def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(ROOT, 0o700)
    previous = json.loads(STATE.read_text()) if STATE.exists() else {}
    try:
        with tempfile.TemporaryDirectory(prefix='snapshot-', dir=ROOT) as work:
            dump = Path(work) / 'pbx-databases.sql'
            with dump.open('wb') as output:
                subprocess.run(['/usr/bin/mariadb-dump', '--single-transaction', '--routines', '--triggers', '--hex-blob', '--databases', 'asterisk', 'asteriskcdrdb'], stdout=output, stderr=subprocess.PIPE, check=True, timeout=180)
            if dump.stat().st_size < 1024 or b'CREATE TABLE' not in dump.read_bytes():
                raise RuntimeError('Invalid database snapshot')
            stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            target = ROOT / ('pbx-' + stamp + '.tar.gz')
            pending = target.with_suffix('.pending')
            with tarfile.open(pending, 'w:gz') as archive:
                archive.add(dump, arcname='pbx-databases.sql')
                for name in ['/etc/asterisk', '/etc/freepbx.conf', '/opt/pbx-ivr-agent', '/usr/local/bin/ivr-callback.sh', '/etc/systemd/system/pbx-ivr-agent.service', '/etc/iptables/rules.v4']:
                    path = Path(name)
                    if path.exists():
                        archive.add(path, arcname=name.lstrip('/'))
            pending.replace(target)
            digest = hashlib.file_digest(target.open('rb'), 'sha256').hexdigest()
            target.with_suffix(target.suffix + '.sha256').write_text(digest + '  ' + target.name + '\n')
            manifest({'available': True, 'status': 'ok', 'lastSuccess': dt.datetime.now(dt.timezone.utc).isoformat(), 'bytes': target.stat().st_size, 'sha256': digest, 'file': target.name})
            # Only files produced by this job, within the verified backup directory.
            for old in sorted(ROOT.glob('pbx-*.tar.gz'), reverse=True)[7:]:
                if old.resolve().parent != ROOT.resolve() or old.is_symlink():
                    continue
                old.unlink()
                old.with_suffix(old.suffix + '.sha256').unlink(missing_ok=True)
            print('PBX_BACKUP_OK bytes=' + str(target.stat().st_size))
    except Exception:
        manifest({**previous, 'available': True, 'status': 'failed', 'lastAttempt': dt.datetime.now(dt.timezone.utc).isoformat()})
        raise RuntimeError('PBX backup failed; previous successful snapshots retained') from None

if __name__ == '__main__':
    main()
