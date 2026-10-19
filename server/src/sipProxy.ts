import http from 'http';
import https from 'https';
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { config } from './config';
import { readSessionToken } from './middlewares/auth';

export function installSipProxy(server: http.Server) {
  const connections = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  const cleanup = setInterval(() => { for (const [ip, value] of attempts) if (value.until < Date.now()) attempts.delete(ip); }, 60000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws-sip')) return;
    const reject = () => { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); };
    if (req.url !== '/ws-sip' || !config.integrationsEnabled || !req.headers.origin ||
      ![config.publicOrigin, ...config.clientUrls].includes(req.headers.origin)) { reject(); return; }
    const ip = req.socket.remoteAddress || 'unknown';
    const previous = attempts.get(ip);
    const bucket = previous && previous.until > Date.now() ? previous : { count: 0, until: Date.now() + 60000 };
    bucket.count++; attempts.set(ip, bucket);
    if (bucket.count > 60 || attempts.size > 10000) { reject(); return; }
    void (async () => {
      let userId: string | undefined;
      try {
        const token = readSessionToken({ headers: req.headers });
        if (!token) throw new Error('Unauthorized');
        const session = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as { id: string; kind?: string; sessionVersion: number; exp?: number };
        if (session.kind === 'customer' || !Number.isInteger(session.sessionVersion) || !session.exp) throw new Error('Unauthorized');
        const user = await prisma.user.findUnique({ where: { id: session.id } });
        if (!user || user.status !== 'ACTIVE' || user.sessionVersion !== session.sessionVersion || !['SUPER_ADMIN', 'OPERATIONS_MANAGER', 'CALL_CENTER_AGENT'].includes(user.role)) throw new Error('Unauthorized');
        if ((connections.get(user.id) || 0) >= 2) throw new Error('Connection limit');
        const target = new URL(process.env.PBX_SIP_UPSTREAM_URL || '');
        if (target.protocol !== 'wss:' || target.username || target.password) throw new Error('A secure SIP upstream is required');
        if (socket.destroyed) return;
        userId = user.id;
        connections.set(userId, (connections.get(userId) || 0) + 1);
        const expiry = setTimeout(() => socket.destroy(), Math.min(session.exp * 1000 - Date.now(), 2147483647));
        const revalidate = setInterval(() => {
          void prisma.user.findUnique({ where: { id: user.id }, select: { status: true, sessionVersion: true } }).then(current => {
            if (!current || current.status !== 'ACTIVE' || current.sessionVersion !== session.sessionVersion) socket.destroy();
          }).catch(() => socket.destroy());
        }, 30000);
        socket.once('close', () => { clearTimeout(expiry); clearInterval(revalidate); connections.set(user.id, Math.max(0, (connections.get(user.id) || 1) - 1)); });
        const proxy = https.request({ hostname: target.hostname, port: target.port || 443, path: target.pathname + target.search, method: 'GET', headers: {
          host: target.host, upgrade: 'websocket', connection: 'Upgrade',
          'sec-websocket-key': req.headers['sec-websocket-key'] || '', 'sec-websocket-version': '13',
          'sec-websocket-protocol': 'sip',
        } });
        const deadline = setTimeout(() => { proxy.destroy(); socket.destroy(); }, 10000);
        proxy.on('upgrade', (response, upstream, upstreamHead) => {
          clearTimeout(deadline);
          if (socket.destroyed) { upstream.destroy(); return; }
          socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(response.headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`).join('') + '\r\n');
          if (upstreamHead.length) socket.write(upstreamHead);
          if (head.length) upstream.write(head);
          upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
          socket.once('close', () => upstream.destroy()); upstream.once('close', () => socket.destroy());
          upstream.pipe(socket); socket.pipe(upstream);
        });
        proxy.on('response', response => { response.resume(); clearTimeout(deadline); socket.destroy(); });
        proxy.on('error', () => { clearTimeout(deadline); socket.destroy(); });
        socket.once('close', () => { clearTimeout(deadline); proxy.destroy(); });
        proxy.end();
      } catch { if (userId) socket.destroy(); else reject(); }
    })();
  });
}
