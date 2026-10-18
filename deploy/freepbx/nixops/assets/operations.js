(() => {
  'use strict';
  const root = document.getElementById('nixops'); if (!root) return;
  const $ = id => document.getElementById(id);
  let settingsVersion = 0, selectedCall = null, retentionToken = '', auditBefore = 0, customerRequest = 0;
  function fail(error) { $('nx-error').hidden = false; $('nx-error').textContent = error.message || 'Operation failed'; }
  async function api(command, values = {}, write = false) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try {
      const query = new URLSearchParams({ module: 'nixops', command, ...(write ? {} : values) });
      const response = await fetch('ajax.php?' + query, { method: write ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'X-Nixops-Token': root.dataset.token, ...(write ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, body: write ? new URLSearchParams(values) : undefined });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'Access denied or service unavailable. Refresh and sign in again.');
      return result.data;
    } catch (error) { if (error.name === 'AbortError') throw new Error('Request timed out. Refresh to check whether the change was saved before retrying.'); throw error; }
    finally { clearTimeout(timer); }
  }
  async function run(button, action) {
    if (button?.disabled) return;
    if (button) button.disabled = true;
    $('nx-error').hidden = true;
    try { await action(); } catch (error) { fail(error); } finally { if (button) button.disabled = false; }
  }
  function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text); if (className) el.className = className; return el; }
  function table(id, records) {
    const body = $(id); body.replaceChildren();
    if (!records.length) { const td = node('td', 'No matching records'); td.colSpan = body.closest('table').querySelectorAll('th').length; const tr = node('tr'); tr.append(td); body.append(tr); return; }
    for (const record of records) { const tr = node('tr'); record.forEach(value => tr.append(node('td', value))); body.append(tr); }
  }
  function field(label, control) { const wrapper = node('label', label); wrapper.append(control); return wrapper; }
  function select(options, value) { const el = node('select'); for (const [key, label] of options) { const option = node('option', label); option.value = key; el.append(option); } el.value = value; return el; }
  function input(value, max = 100) { const el = node('input'); el.value = value; el.maxLength = max; return el; }
  const statuses = [['open','Open'],['in_progress','In progress'],['done','Done'],['dismissed','Dismissed']];
  async function followups() {
    const data = await api('followups', { followupStatus: $('nx-followup-status').value });
    const box = $('nx-followup-list'); box.replaceChildren();
    if (!data.rows.length) box.append(node('p', 'No tasks in this status.', 'nx-note'));
    for (const row of data.rows) {
      const form = node('form', undefined, 'nx-task'); form.append(node('h2', row.phone));
      form.append(node('p', `Call: ${row.call_time} · Updated: ${new Date(row.updated).toLocaleString()}`, 'nx-note'));
      const fields = node('div', undefined, 'nx-filters'), owner = input(row.owner), status = select(statuses, row.status), note = node('textarea'); note.value = row.note; note.maxLength = 2000; note.rows = 3;
      fields.append(field('Assigned to', owner), field('Status', status)); form.append(fields, field('Follow-up notes', note));
      const save = node('button', 'Save task'); save.type = 'submit'; form.append(save);
      if (root.dataset.role === 'viewer') { owner.disabled = status.disabled = note.disabled = true; save.hidden = true; }
      form.addEventListener('submit', event => { event.preventDefault(); run(save, async () => {
        await api('saveFollowup', { id: row.id, version: row.version, owner: owner.value, status: status.value, note: note.value }, true); await followups();
      }); }); box.append(form);
    }
  }
  root.addEventListener('nx:followup', event => {
    selectedCall = event.detail;
    const choices = [...new Set([selectedCall.src, selectedCall.dst])].filter(value => /^\+?[0-9]{3,20}$/.test(value));
    $('nx-followup-phone').replaceChildren();
    choices.forEach(value => { const option = node('option', value); option.value = value; $('nx-followup-phone').append(option); });
    if (!choices.length) { fail(new Error('This call has no numeric customer number.')); return; }
    $('nx-followup-dialog').showModal();
  });
  $('nx-followup-cancel').addEventListener('click', () => $('nx-followup-dialog').close());
  $('nx-followup-form').addEventListener('submit', event => { event.preventDefault(); run(event.submitter, async () => {
    await api('saveFollowup', { callId: selectedCall.uniqueid, phone: $('nx-followup-phone').value }, true);
    $('nx-followup-dialog').close(); root.querySelector('[data-tab="followups"]').click();
  }); });
  $('nx-followup-load').addEventListener('click', event => run(event.currentTarget, followups));
  async function customer() {
    const sequence = ++customerRequest;
    $('nx-customer-orders').hidden = true;
    const data = await api('customer', { phone: $('nx-customer-phone').value, from: $('nx-from').value, to: $('nx-to').value });
    if (sequence !== customerRequest) return;
    table('nx-customer-calls', data.calls.map(row => [row.calldate, row.src, row.dst, row.disposition, row.billsec]));
    const box = $('nx-customer-notes'); box.replaceChildren();
    data.followups.forEach(row => { const item = node('article', undefined, 'nx-task'); item.append(node('strong', `${row.status} · ${row.owner || 'Unassigned'}`), node('p', row.note || 'No notes')); box.append(item); });
    if (!data.followups.length) box.append(node('p', 'No follow-up notes.', 'nx-note'));
    if (data.ordersUrl) { const url = new URL(data.ordersUrl); if (url.protocol === 'https:') { $('nx-customer-orders').href = url.href; $('nx-customer-orders').hidden = false; } }
  }
  $('nx-customer-find').addEventListener('click', event => run(event.currentTarget, customer));
  $('nx-customer-phone').addEventListener('keydown', event => { if (event.key === 'Enter') $('nx-customer-find').click(); });
  const definitions = [
    ['retentionDays','Recording age (days)','number'],['diskWarning','Disk warning (%)','number'],['backupHours','Backup stale after (hours)','number'],
    ['alertChannel','Alert channel',[['none','Not configured'],['email','Email'],['telegram','Telegram']]],['email','Alert email','email'],['telegramChat','Telegram chat ID','text'],
    ['offsiteType','Offsite storage',[['none','Not configured'],['sftp','SFTP'],['s3','S3-compatible']]],['offsiteProfile','Server connection profile name','text'],['offsitePath','Remote folder / bucket prefix','text'],['offsiteKeepDays','Offsite retention (days)','number'],['ordersUrl','E-commerce orders URL','url']
  ];
  async function roles() { const data = await api('roles'); table('nx-role-list', data.map(row => [row.username, row.role])); }
  async function settings() {
    const data = await api('settings'); settingsVersion = data.version;
    const box = $('nx-settings-fields'); box.replaceChildren();
    for (const [key, label, type] of definitions) {
      const control = Array.isArray(type) ? select(type, data.values[key]) : input(data.values[key], 250);
      if (!Array.isArray(type)) control.type = type;
      control.name = key; box.append(field(label, control));
    }
    $('nx-settings-status').textContent = `Alerts: ${data.alertDelivery}. Offsite: ${data.offsiteDelivery}.`;
    await roles();
  }
  $('nx-settings-form').addEventListener('submit', event => { event.preventDefault(); run(event.submitter, async () => {
    const values = Object.fromEntries(new FormData(event.currentTarget)); values.version = settingsVersion;
    const data = await api('saveSettings', values, true); settingsVersion = data.version;
    $('nx-settings-status').textContent = 'Settings saved. Alert delivery and offsite upload remain disconnected until securely configured and verified.';
  }); });
  $('nx-role-form').addEventListener('submit', event => { event.preventDefault(); run(event.submitter, async () => {
    await api('saveRole', { username: $('nx-role-user').value, role: $('nx-role-value').value }, true); await roles(); $('nx-role-user').value = '';
  }); });
  async function audit(older = false) {
    const data = await api('audit', { before: older ? auditBefore : 0 });
    table('nx-audit-list', data.map(row => [row.at, row.actor, row.action, row.target]));
    auditBefore = data.length ? data[data.length - 1].id : 0; $('nx-audit-older').disabled = data.length < 100;
  }
  $('nx-audit-older').addEventListener('click', () => run(null, () => audit(true)));
  async function retention() {
    const data = await api('retention'); retentionToken = data.token;
    $('nx-retention-note').textContent = `${data.files.length} candidates older than ${data.days} days · ${(data.bytes / 1048576).toFixed(2)} MB in this preview.${data.partial ? ' Partial scan; additional files may exist.' : ''} Preview expires in 10 minutes.`;
    const box = $('nx-retention-files'); box.replaceChildren();
    for (const file of data.files) {
      const row = node('div', undefined, 'nx-task'), button = node('button', 'Quarantine', 'nx-secondary'); button.type = 'button';
      row.append(node('p', `${file.name} · ${(file.bytes / 1048576).toFixed(2)} MB · ${new Date(file.modified).toLocaleDateString()}`), button);
      button.addEventListener('click', () => { if (!confirm(`Move ${file.name} out of recording playback? You can restore it from this panel.`)) return; run(button, async () => { await api('quarantine', { id: file.id, token: retentionToken }, true); await retention(); }); }); box.append(row);
    }
    const recover = $('nx-retention-quarantine'); recover.replaceChildren();
    for (const file of data.quarantine) {
      const row = node('div', undefined, 'nx-task'), button = node('button', 'Restore', 'nx-secondary'); button.type = 'button';
      row.append(node('p', `${file.id.slice(0, 12)} · ${(file.bytes / 1048576).toFixed(2)} MB · ${new Date(file.at).toLocaleString()}`), button);
      button.addEventListener('click', () => run(button, async () => { await api('restoreRecording', { id: file.id }, true); await retention(); })); recover.append(row);
    }
    if (!data.files.length) box.append(node('p', 'No old recordings in this preview.', 'nx-note'));
    if (!data.quarantine.length) recover.append(node('p', 'No quarantined recordings.', 'nx-note'));
  }
  $('nx-retention-preview').addEventListener('click', event => run(event.currentTarget, retention));
  root.addEventListener('nx:view', event => {
    const actions = { followups, settings, audit: () => audit(false), retention };
    if (actions[event.detail]) run(null, actions[event.detail]);
  });
})();
