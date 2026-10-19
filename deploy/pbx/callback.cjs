'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const https = require('node:https');
const config = JSON.parse(fs.readFileSync(process.env.PBX_CONFIG_FILE || '/opt/pbx-ivr-agent/config.json', 'utf8'));
const secret = process.env.PBX_IVR_SECRET || config.apiSecret;
const [orderId, status, phone, callId] = process.argv.slice(2);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
if (!validId(orderId) || !validId(callId) || !/^01[3-9]\d{8}$/.test(phone || '') || !['CONFIRMED', 'CANCELLED', 'CALL_ENDED_NO_INPUT', 'INVALID_INPUT', 'NO_ANSWER', 'BUSY'].includes(status) || typeof secret !== 'string' || secret.length < 32) throw new Error('Invalid callback arguments or signing configuration');
const target = new URL(config.webhookUrl);
if (target.protocol !== 'https:' || target.username || target.password) throw new Error('HTTPS webhook is required');
const body = JSON.stringify({ orderId, status, phone, callId });
function send() {
  return new Promise((resolve, reject) => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const req = https.request(target, { method: 'POST', timeout: 10000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-PBX-Timestamp': timestamp, 'X-PBX-Signature': signature, 'X-PBX-Signature-Version': '2' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('timeout', () => req.destroy(new Error('Callback timeout'))); req.on('error', reject); req.end(body);
  });
}
(async () => {
  for (let attempt = 0; attempt < 4; attempt++) {
    let code;
    try { code = await send(); } catch { code = 503; }
    if (code >= 200 && code < 300) return;
    if (code < 500 && code !== 429) break;
    await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
  }
  console.error('IVR callback not acknowledged; inspect application/PBX logs'); process.exitCode = 1;
})();
