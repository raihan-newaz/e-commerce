(() => {
  'use strict';
  const root = document.getElementById('nixops');
  if (!root) return;
  const $ = id => document.getElementById(id);
  let tab = 'overview', page = 1, total = 0, liveBusy = false, expired = false, audioUrl = '';
  let reportRequest = 0;
  let permissions = { media: false, followup: false, manage: false };
  const text = (id, value) => { $(id).textContent = String(value); };
  const duration = seconds => { const n = Math.max(0, Number(seconds) || 0); return n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m` : `${Math.floor(n / 60)}m ${n % 60}s`; };
  function fail(error) { $('nx-error').hidden = false; $('nx-error').textContent = error.message || 'Could not load PBX data'; }
  function clearError() { $('nx-error').hidden = true; }
  function url(command, params = {}) { return 'ajax.php?' + new URLSearchParams({ module: 'nixops', command, ...params }); }
  async function request(command, params = {}, raw = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), raw ? 60000 : 12000);
    try {
      const res = await fetch(url(command, params), { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Nixops-Token': root.dataset.token }, signal: controller.signal });
      if ([401, 403].includes(res.status)) { expired = true; throw new Error('Your session expired or access was denied. Refresh this page and sign in again.'); }
      if (!res.ok) throw new Error(raw ? 'The file is unavailable. It may have been archived or removed.' : 'PBX data is temporarily unavailable. Try Refresh.');
      if (raw) return res;
      const result = await res.json();
      if (!result.success) throw new Error(result.message || 'PBX data is unavailable');
      return result.data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('The request timed out. Try again shortly.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  function cell(value) { const td = document.createElement('td'); td.textContent = String(value ?? ''); return td; }
  function badge(value, good) { const span = document.createElement('span'); span.className = 'nx-status ' + (good ? 'good' : 'warn'); span.textContent = value; return span; }
  function rows(id, values, columns, empty = 'No matching records') {
    const body = $(id); body.replaceChildren();
    if (!values.length) { const tr = document.createElement('tr'), td = cell(empty); td.colSpan = columns; td.className = 'nx-empty'; tr.append(td); body.append(tr); return; }
    for (const valuesRow of values) {
      const tr = document.createElement('tr');
      for (const value of valuesRow) { if (value instanceof Node) { const td = document.createElement('td'); td.append(value); tr.append(td); } else tr.append(cell(value)); }
      body.append(tr);
    }
  }
  async function live() {
    if (liveBusy || expired) return;
    liveBusy = true;
    try {
      const data = await request('live');
      text('nx-active', data.channels.length);
      text('nx-endpoints', data.endpoints.filter(e => !/Unavailable|Invalid|Unknown/i.test(e.state)).length + ' / ' + data.endpoints.length);
      text('nx-trunks', data.trunks.filter(t => t.state === 'Registered').length + ' / ' + data.trunks.length);
      rows('nx-channels', data.channels.map(c => [c.caller || '—', c.extension, badge(c.state, c.state === 'Up'), duration(c.seconds), c.channel]), 5, 'No active calls. Your PBX is ready.');
      $('nx-endpoint-list').replaceChildren();
      for (const endpoint of data.endpoints) {
        const card = document.createElement('div'); card.className = 'nx-device';
        const name = document.createElement('strong'); name.textContent = endpoint.name;
        const state = badge(endpoint.state, !/Unavailable|Invalid|Unknown/i.test(endpoint.state));
        const count = document.createElement('small'); count.textContent = `${endpoint.channels} active channels`;
        card.append(name, state, count); $('nx-endpoint-list').append(card);
      }
      if (!data.endpoints.length) text('nx-endpoint-list', 'No PJSIP endpoints found.');
      $('nx-trunk-list').replaceChildren();
      for (const trunk of data.trunks) {
        const row = document.createElement('div'), name = document.createElement('strong'); name.textContent = trunk.name;
        row.append(name, badge(trunk.state, trunk.state === 'Registered')); $('nx-trunk-list').append(row);
      }
      if (!data.trunks.length) text('nx-trunk-list', 'No registration-based trunks found. IP-authenticated trunks may not appear here.');
      text('nx-queue-live', data.queueStatus.trim() || 'No queues configured.');
      text('nx-sync', 'Updated ' + new Date(data.at).toLocaleTimeString());
    } catch (error) { text('nx-sync', 'Connection interrupted'); fail(error); }
    finally { liveBusy = false; }
  }
  function filters() {
    const from = $('nx-from').value, to = $('nx-to').value;
    if (!from || !to || to < from || (Date.parse(to) - Date.parse(from)) / 86400000 > 30) throw new Error('Choose a valid date range of at most 31 days.');
    return { from, to, search: $('nx-search').value.trim(), status: $('nx-status').value, recorded: $('nx-recorded').value, page: String(page) };
  }
  function dailyChart(data) {
    $('nx-daily').replaceChildren();
    const max = Math.max(1, ...data.map(d => Number(d.total)));
    for (const day of data) {
      const column = document.createElement('div'); column.className = 'nx-chart-column';
      const count = document.createElement('span'); count.textContent = day.total;
      const bar = document.createElement('div'); bar.className = 'nx-chart-bar'; bar.style.height = `${Math.max(2, Number(day.total) / max * 130)}px`;
      const answered = document.createElement('i'); answered.style.height = `${Number(day.total) ? Number(day.answered) / Number(day.total) * 100 : 0}%`;
      bar.append(answered); column.title = `${day.day}: ${day.total} records, ${day.answered} answered`;
      const label = document.createElement('small'); label.textContent = day.day.slice(5);
      column.append(count, bar, label); $('nx-daily').append(column);
    }
    if (!data.length) text('nx-daily', 'No call records in this date range.');
  }
  async function recording(row, play, button) {
    button.disabled = true;
    try {
      const res = await request('recording', { id: row.uniqueid }, true);
      const blob = await res.blob(), objectUrl = URL.createObjectURL(blob);
      if (play) {
        closePlayer(); audioUrl = objectUrl;
        $('nx-player').src = audioUrl; $('nx-player-card').hidden = false;
        text('nx-player-title', `${row.src} → ${row.dst} · ${row.calldate}`);
        $('nx-player-card').scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('nx-player').play().catch(() => {});
      } else {
        const filename = res.headers.get('Content-Disposition')?.match(/filename="([A-Za-z0-9._-]+)"/)?.[1] || 'call-recording';
        download(objectUrl, filename); setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      }
    } catch (error) { fail(error); }
    finally { button.disabled = false; }
  }
  function closePlayer() { $('nx-player').pause(); $('nx-player').removeAttribute('src'); $('nx-player-card').hidden = true; if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = ''; }
  function download(href, filename) { const link = document.createElement('a'); link.href = href; link.download = filename; link.click(); }
  async function reports() {
    const requestNumber = ++reportRequest;
    $('nx-apply').disabled = true;
    try {
      const data = await request('reports', filters());
      if (requestNumber !== reportRequest) return;
      total = data.summary.total;
      text('nx-total', total); text('nx-answered', data.summary.answered); text('nx-missed', data.summary.unanswered); text('nx-talk', duration(data.summary.talkSeconds));
      text('nx-rate', (total ? (data.summary.answered / total * 100).toFixed(1) : '0') + '% answered');
      text('nx-count', `${total} records`); text('nx-timezone', `Times use ${data.timezone}.`); text('nx-page', `Page ${page} of ${Math.max(1, Math.ceil(total / 50))}`);
      $('nx-prev').disabled = page <= 1; $('nx-next').disabled = page * 50 >= total;
      dailyChart(data.daily);
      $('nx-hourly').replaceChildren();
      const maxHour = Math.max(1, ...data.hourly.map(h => Number(h.total)));
      for (let hour = 0; hour < 24; hour++) {
        const point = data.hourly.find(h => Number(h.hour) === hour);
        const block = document.createElement('div'); block.className = 'nx-hour';
        const label = `${String(hour).padStart(2, '0')}:00 — ${point?.total || 0} records, ${point?.answered || 0} answered`;
        block.title = label; block.setAttribute('aria-label', label); block.tabIndex = 0;
        block.style.setProperty('--activity', String(Number(point?.total || 0) / maxHour));
        block.textContent = String(hour).padStart(2, '0'); $('nx-hourly').append(block);
      }
      rows('nx-destinations', data.destinations.map(d => [d.dst || 'Unknown', d.total, d.answered, duration(d.talkSeconds)]), 4);
      rows('nx-records', data.rows.map(row => {
        const actions = document.createElement('div'); actions.className = 'nx-recording-actions';
        if (row.recorded && permissions.media) {
          for (const [label, play] of [['▶ Play', true], ['↓ Save', false]]) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'nx-secondary'; button.textContent = label;
            button.addEventListener('click', () => recording(row, play, button)); actions.append(button);
          }
        } else actions.textContent = row.recorded ? 'Restricted' : 'Not recorded';
        if (permissions.followup && row.disposition !== 'ANSWERED') {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'nx-secondary'; button.textContent = 'Follow up';
          button.addEventListener('click', () => root.dispatchEvent(new CustomEvent('nx:followup', { detail: row }))); actions.append(button);
        }
        return [row.calldate, row.src, row.dst, badge(row.disposition, row.disposition === 'ANSWERED'), duration(row.duration), duration(row.billsec), actions];
      }), 7);
    } catch (error) { if (requestNumber === reportRequest) fail(error); }
    finally { if (requestNumber === reportRequest) $('nx-apply').disabled = false; }
  }
  async function queues() {
    try {
      const data = await request('queues', filters());
      text('nx-queue-note', !data.available ? 'Queue log is not readable. Check server permissions.' : data.partial ? 'Partial report: the selected period exceeds the last 8 MB of queue events.' : 'Current log events for the selected date range.');
      rows('nx-queue-records', data.queues.map(q => [q.name, q.entered, q.answered, q.abandoned, q.completed, duration(q.answered ? Math.round(q.waitSeconds / q.answered) : 0), duration(q.talkSeconds)]), 7, 'No queue events in this date range.');
    } catch (error) { fail(error); }
  }
  async function backup() {
    try {
      const data = await request('backup'); const box = $('nx-backup-state'); box.replaceChildren();
      if (!data.available) { box.textContent = 'No verified backup snapshot is recorded yet.'; return; }
      const state = badge(data.status === 'ok' ? 'Snapshot completed' : 'Latest backup failed', data.status === 'ok');
      const last = document.createElement('p'); last.textContent = 'Last success: ' + (data.lastSuccess ? new Date(data.lastSuccess).toLocaleString() : 'None');
      const size = document.createElement('p'); size.textContent = `${(Number(data.bytes || 0) / 1048576).toFixed(2)} MB · SHA-256 recorded`;
      box.append(state, last, size);
      if (data.status !== 'ok') { const note = document.createElement('p'); note.textContent = 'Check nixops-backup.service logs on the server.'; box.append(note); }
    } catch (error) { fail(error); }
  }
  async function health() {
    try {
      const data = await request('health'), box = $('nx-health'); box.replaceChildren();
      const notices = [];
      function card(label, value, detail) {
        const article = document.createElement('article'), title = document.createElement('span'), number = document.createElement('strong'), note = document.createElement('small');
        title.textContent = label; number.textContent = value; note.textContent = detail; article.append(title, number, note); box.append(article);
      }
      for (const disk of data.volumes) {
        const used = disk.available ? (1 - disk.free / disk.total) * 100 : null;
        card(disk.name + ' storage', used === null ? 'Unknown' : used.toFixed(1) + '%', disk.available ? (disk.free / 1073741824).toFixed(1) + ' GB free' : 'Storage information unavailable');
        if (used === null || used >= data.diskWarning) notices.push(disk.name + ': ' + (used === null ? 'unable to read disk capacity.' : 'storage is nearly full. Review retention and capacity.'));
      }
      card('Server load', data.load.length ? data.load[0].toFixed(2) : 'Unknown', '1 / 5 / 15 min: ' + data.load.map(n => n.toFixed(2)).join(' / '));
      card('Backup freshness', data.backupHealthy ? 'Healthy' : 'Review', data.backupAgeSeconds === null ? 'No successful snapshot' : duration(data.backupAgeSeconds) + ' since last success');
      if (!data.backupHealthy) notices.push(`Backup is missing, failed or older than ${data.backupHours} hours. Check the backup service.`);
      text('nx-health-alerts', notices.length ? notices.join(' ') : 'Storage and backup checks passed.');
      $('nx-health-alerts').className = notices.length ? 'nx-alert' : 'nx-note';
    } catch (error) { fail(error); }
  }
  async function refresh() { clearError(); if (tab === 'overview') await live(); else if (tab === 'calls') await reports(); else if (tab === 'queues') await queues(); else if (tab === 'health') await health(); else if (tab === 'backup') await backup(); else root.dispatchEvent(new CustomEvent('nx:view', { detail: tab })); }
  root.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => {
    tab = button.dataset.tab;
    root.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); });
    root.querySelectorAll('[data-view]').forEach(view => { view.hidden = view.dataset.view !== tab; });
    refresh();
  }));
  $('nx-refresh').addEventListener('click', refresh);
  root.querySelectorAll('[data-days]').forEach(button => button.addEventListener('click', () => {
    const date = new Date(root.dataset.today + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - Number(button.dataset.days) + 1);
    $('nx-from').value = date.toISOString().slice(0, 10); $('nx-to').value = root.dataset.today;
    page = 1; clearError(); reports();
  }));
  $('nx-reset').addEventListener('click', () => {
    $('nx-from').value = $('nx-to').value = root.dataset.today;
    $('nx-search').value = $('nx-status').value = $('nx-recorded').value = '';
    page = 1; clearError(); reports();
  });
  $('nx-wallboard').addEventListener('click', () => {
    const enabled = root.classList.toggle('nx-wallboard');
    $('nx-wallboard').textContent = enabled ? 'Exit wallboard' : 'Wallboard';
    $('nx-wallboard').setAttribute('aria-pressed', String(enabled));
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && root.classList.contains('nx-wallboard')) $('nx-wallboard').click(); });
  $('nx-apply').addEventListener('click', () => { page = 1; clearError(); reports(); });
  $('nx-search').addEventListener('keydown', event => { if (event.key === 'Enter') { page = 1; clearError(); reports(); } });
  $('nx-prev').addEventListener('click', () => { if (page > 1) { page--; reports(); } });
  $('nx-next').addEventListener('click', () => { if (page * 50 < total) { page++; reports(); } });
  $('nx-close-player').addEventListener('click', closePlayer);
  $('nx-export').addEventListener('click', async () => {
    $('nx-export').disabled = true;
    try { const res = await request('export', filters(), true); const objectUrl = URL.createObjectURL(await res.blob()); download(objectUrl, 'pbx-call-records.csv'); setTimeout(() => URL.revokeObjectURL(objectUrl), 10000); }
    catch (error) { fail(error); } finally { $('nx-export').disabled = false; }
  });
  const poll = setInterval(() => { if (tab === 'overview' && !document.hidden) live(); }, 5000);
  window.addEventListener('pagehide', () => { clearInterval(poll); closePlayer(); });
  request('capabilities').then(data => {
    permissions = data; root.dataset.role = data.role;
    root.querySelectorAll('[data-admin]').forEach(element => { element.hidden = !data.manage; });
    $('nx-export').hidden = !data.media;
    refresh();
  }).catch(fail);
})();
