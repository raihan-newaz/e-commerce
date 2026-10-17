#!/usr/bin/env python3
"""Coordinated local DB credential rotation with private rollback material."""
import datetime as dt
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit, urlunsplit, unquote, quote

def main():
    if os.geteuid() != 0 or sys.argv[1:] != ['--rotate']:
        raise RuntimeError('Root and explicit --rotate required')
    os.umask(0o077)
    envfile = Path('/root/Ecommerce/server/.env')
    original = envfile.read_text()
    line = next((s for s in original.splitlines() if s.startswith('DATABASE_URL=')), '')
    value = line.split('=', 1)[1].strip().strip('"\'')
    url = urlsplit(value)
    if url.scheme != 'mysql' or url.hostname not in ['127.0.0.1', 'localhost']:
        raise RuntimeError('Only this host local MySQL account is supported')
    old = unquote(url.password or '')
    user = unquote(url.username or '')
    if not old or not user:
        raise RuntimeError('Missing DB identity')
    backupdir = Path('/root/pre_security_upgrade_backup')
    backupdir.mkdir(mode=0o700, exist_ok=True)
    os.chmod(backupdir, 0o700)
    private = backupdir / ('server.env.before-db-rotation-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    private.write_text(original); os.chmod(private, 0o600)
    def sqlquote(v): return "'" + v.replace('\\', '\\\\').replace("'", "\\'") + "'"
    def client(password, sql):
        def ini(v): return '"' + v.replace('\\', '\\\\').replace('"', '\\"') + '"'
        with tempfile.TemporaryDirectory(prefix='db-rotation-', dir=backupdir) as work:
            config = Path(work) / 'client.cnf'
            config.write_text('[client]\n' + '\n'.join(k+'='+ini(v) for k,v in {'user':user,'password':password,'host':url.hostname,'port':str(url.port or 3306)}.items()))
            os.chmod(config, 0o600)
            result = subprocess.run(['/usr/bin/mariadb', '--defaults-file='+str(config), '--batch', '--skip-column-names'], input=sql, text=True, capture_output=True, timeout=15)
            if result.returncode: raise RuntimeError('DB credential check failed')
            return result.stdout.strip()
    current = client(old, 'SELECT CURRENT_USER();')
    account, host = current.rsplit('@', 1)
    if account != user: raise RuntimeError('Unexpected DB account mapping')
    def alter(password):
        sql = 'ALTER USER ' + sqlquote(user) + '@' + sqlquote(host) + ' IDENTIFIED BY ' + sqlquote(password) + ';'
        result = subprocess.run(['/usr/bin/mariadb'], input=sql, text=True, capture_output=True, timeout=15)
        if result.returncode: raise RuntimeError('DB credential rotation failed')
    def write_env(content):
        tmp = envfile.with_suffix('.rotation-tmp')
        tmp.write_text(content); os.chmod(tmp, 0o600); tmp.replace(envfile)
    def restart():
        result = subprocess.run(['docker','compose','up','-d','--no-deps','--force-recreate','ecommerce'], cwd='/root/Ecommerce', capture_output=True, timeout=90)
        if result.returncode: raise RuntimeError('App recreation failed')
    def healthy():
        for _ in range(30):
            result = subprocess.run(['docker','inspect','-f','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}','nix-ecommerce'], capture_output=True, text=True, timeout=10)
            if result.stdout.strip() == 'healthy': return True
            time.sleep(2)
        return False
    fresh = secrets.token_urlsafe(36)
    netloc = quote(user, safe='') + ':' + quote(fresh, safe='') + '@' + url.hostname + (':' + str(url.port) if url.port else '')
    nexturl = urlunsplit((url.scheme, netloc, url.path, url.query, url.fragment))
    replacement = 'DATABASE_URL="' + nexturl + '"'
    content = original.replace(line, replacement, 1)
    # Update explicitly named DB aliases only when they contain the same old password.
    for entry in content.splitlines():
        if '=' in entry and entry.split('=',1)[0] in ['DB_PASSWORD','DATABASE_PASSWORD','MYSQL_PASSWORD'] and entry.split('=',1)[1].strip().strip('"\'') == old:
            content = content.replace(entry, entry.split('=',1)[0]+'="'+fresh+'"', 1)
    changed = False
    try:
        alter(fresh); changed = True
        client(fresh, 'SELECT 1;')
        write_env(content); restart()
        if not healthy(): raise RuntimeError('Health did not recover')
    except Exception:
        if changed:
            alter(old); write_env(original); restart()
            if not healthy(): raise RuntimeError('Rollback needs operator attention') from None
        raise RuntimeError('Rotation stopped and rolled back; credentials were not logged') from None
    print('DATABASE_ROTATED app=healthy rollback_env_mode=0600')

if __name__ == '__main__':
    main()
