#!/usr/bin/env python3
"""Take a consistent private SQL dump using the app's configured DB identity."""
import datetime as dt
import gzip
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from urllib.parse import urlsplit, unquote

def main():
    if os.geteuid() != 0:
        raise RuntimeError('Run as root')
    os.umask(0o077)
    env = Path('/root/Ecommerce/server/.env').read_text()
    value = next((line.split('=', 1)[1].strip().strip('"\'') for line in env.splitlines() if line.startswith('DATABASE_URL=')), '')
    url = urlsplit(value)
    if url.scheme != 'mysql' or not url.hostname or not url.username:
        raise RuntimeError('Invalid database configuration')
    name = unquote(url.path.lstrip('/'))
    if not name or not all(c.isalnum() or c == '_' for c in name):
        raise RuntimeError('Invalid database name')
    root = Path('/var/backups/nix-ecommerce')
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    def quote(text):
        return '"' + text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') + '"'
    with tempfile.TemporaryDirectory(prefix='snapshot-', dir=root) as work:
        config = Path(work) / 'client.cnf'
        config.write_text('[client]\n' + '\n'.join(k + '=' + quote(v) for k, v in {
            'user': unquote(url.username), 'password': unquote(url.password or ''), 'host': url.hostname, 'port': str(url.port or 3306)
        }.items()) + '\n')
        os.chmod(config, 0o600)
        dump = Path(work) / 'database.sql'
        with dump.open('wb') as output:
            result = subprocess.run(['/usr/bin/mariadb-dump', '--defaults-file=' + str(config), '--single-transaction', '--hex-blob', '--triggers', '--databases', name], stdout=output, stderr=subprocess.PIPE, timeout=180)
        if result.returncode or dump.stat().st_size < 1024 or b'CREATE TABLE' not in dump.read_bytes():
            raise RuntimeError('Database dump failed validation; credentials were not logged')
        target = root / ('ecommerce-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.sql.gz')
        with dump.open('rb') as source, gzip.open(target, 'wb') as output:
            shutil.copyfileobj(source, output)
        digest = hashlib.file_digest(target.open('rb'), 'sha256').hexdigest()
        target.with_suffix(target.suffix + '.sha256').write_text(digest + '  ' + target.name + '\n')
        print('APP_DB_BACKUP_OK bytes=' + str(target.stat().st_size) + ' file=' + target.name)

if __name__ == '__main__':
    main()
