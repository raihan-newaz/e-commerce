'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const config = JSON.parse(fs.readFileSync(process.env.PBX_CONFIG_FILE || path.join(__dirname, 'config.json'), 'utf8'));
const secret = process.env.PBX_IVR_SECRET || config.apiSecret;
if (typeof secret !== 'string' || secret.length < 32) throw new Error('Configure a new PBX signing secret of at least 32 characters');
const stateDir = process.env.PBX_STATE_DIR || '/var/lib/pbx-ivr-agent';
const spool = '/var/spool/asterisk/outgoing';
const staging = '/var/spool/asterisk/ivr-staging';
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const phone = value => { const digits = String(value || '').replace(/\D/g, '').replace(/^88/, ''); return /^01[3-9]\d{8}$/.test(digits) ? digits : ''; };
const sign = (body, timestamp) => crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
function verified(req, body) {
  const timestamp = String(req.headers['x-pbx-timestamp'] || '');
  const signature = String(req.headers['x-pbx-signature'] || '');
  return /^\d{10}$/.test(timestamp) && /^[a-f\d]{64}$/i.test(signature) && Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300 && crypto.timingSafeEqual(sign(body, timestamp), Buffer.from(signature, 'hex'));
}
function dispatch(data) {
  if (!validId(data.callId) || !validId(data.orderId) || !phone(data.phone) || !Number.isFinite(data.amount) || data.amount < 0 || data.amount > 100000000) throw new Error('Invalid call payload');
  const callerId = String(data.callerId || config.callerId || '');
  const context = String(config.trunkContext || 'from-internal');
  if (!/^\d{6,20}$/.test(callerId) || !/^[\w-]{1,80}$/.test(context)) throw new Error('Invalid PBX routing configuration');
  const recordPath = path.join(stateDir, data.callId + '.json');
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify([data.orderId, phone(data.phone), data.amount, callerId])).digest('hex');
  let descriptor;
  try { descriptor = fs.openSync(recordPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const previous = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    if (previous.fingerprint !== fingerprint) throw new Error('Call ID conflict');
    if (previous.status !== 'QUEUED') throw new Error('Previous dispatch is uncertain; inspect PBX before retry');
    return { success: true, callId: data.callId, duplicate: true };
  }
  const record = { fingerprint, status: 'PREPARING' };
  fs.writeFileSync(descriptor, JSON.stringify(record)); fs.fsyncSync(descriptor); fs.closeSync(descriptor);
  const file = path.join(staging, data.callId + '.call');
  const contents = [
    `Channel: Local/${phone(data.phone)}@${context}`, `CallerID: "Order Verification" <${callerId}>`,
    'MaxRetries: 0', 'RetryTime: 60', 'WaitTime: 30', 'Context: ecommerce-order-verify', 'Extension: s', 'Priority: 1',
    `Setvar: __ORDER_ID=${data.orderId}`, `Setvar: __IVR_CALL_ID=${data.callId}`, `Setvar: __CUSTOMER_PHONE=${phone(data.phone)}`, `Setvar: __ORDER_AMOUNT=${Math.round(data.amount)}`, 'Archive: No', '',
  ].join('\n');
  fs.writeFileSync(file, contents, { flag: 'wx', mode: 0o600 });
  fs.renameSync(file, path.join(spool, path.basename(file)));
  fs.writeFileSync(recordPath, JSON.stringify({ ...record, status: 'QUEUED' }), { mode: 0o600 });
  return { success: true, callId: data.callId };
}
function trunks() {
  const raw = execFileSync('/usr/sbin/asterisk', ['-rx', 'pjsip show registrations'], { encoding: 'utf8', timeout: 3000 });
  return raw.split('\n').filter(line => /Registered|Rejected|Unregistered/.test(line)).map(line => {
    const parts = line.trim().split(/\s+/);
    return { name: parts[0].split('/')[0], callerId: parts[0].match(/096\d+/)?.[0] || '', provider: 'PBX', status: parts.includes('Registered') ? 'Registered' : 'Offline' };
  });
}
function hangup(data) {
  const target = phone(data.phone);
  if (!target) throw new Error('Invalid phone');
  const raw = execFileSync('/usr/sbin/asterisk', ['-rx', 'core show channels concise'], { encoding: 'utf8', timeout: 3000 });
  let count = 0;
  for (const line of raw.split('\n')) {
    const fields = line.split('!');
    const channel = fields[0];
    // Never terminate every WebRTC agent channel as the old agent did.
    if (!/^[A-Za-z0-9_/@:.;-]+$/.test(channel) || !new RegExp(`(^|\\D)${target}(\\D|$)`).test(line)) continue;
    execFileSync('/usr/sbin/asterisk', ['-rx', 'channel request hangup ' + channel], { timeout: 3000 });
    count++;
  }
  return { success: true, hungUp: count };
}
const server = http.createServer((req, res) => {
  const reply = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (!['127.0.0.1', '::1', ...(config.allowedIps || []).filter(value => value !== '*')].includes(ip)) { reply(403, { success: false }); return; }
  if (req.method === 'GET' && req.url === '/api/health') { reply(200, { success: true, protocol: 2 }); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (Buffer.byteLength(body) > 16384) req.destroy(); });
  req.on('end', () => {
    if (!verified(req, body)) { reply(401, { success: false, message: 'Invalid signature' }); return; }
    try {
      if (req.method === 'GET' && req.url === '/api/trunks') { reply(200, { success: true, trunks: trunks() }); return; }
      if (req.method !== 'POST') { reply(404, { success: false }); return; }
      const data = JSON.parse(body);
      if (req.url === '/api/call/dispatch') reply(200, dispatch(data));
      else if (req.url === '/api/call/hangup') reply(200, hangup(data));
      else reply(404, { success: false });
    } catch { reply(409, { success: false, message: 'PBX operation could not be confirmed; inspect service logs/state before retry' }); }
  });
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.maxConnections = 50;
server.listen(config.port || 7088, process.env.PBX_BIND_HOST || '127.0.0.1');
