import adminDropdownRoutes from './modules/adminDropdowns/routes';
import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import emailRoutes from './modules/email/routes';
import { startEmailWorker } from './modules/email/service';
import { mountWebApps } from './webApps';
import { installIntegrationSafety } from './utils/integrationSafety';
installIntegrationSafety();
import { errorHandler } from './middlewares/errorHandler';
import jwt from 'jsonwebtoken';
import { readSessionToken } from './middlewares/auth';
import prisma from './prisma';
import { webpNegotiation } from './utils/webpImages';

// Import Routes
import authRoutes from './modules/auth/authRoutes';
import orderRoutes from './modules/orders/orderRoutes';
import courierRoutes from './modules/couriers/courierRoutes';
import orderProtectionRoutes from './modules/orders/orderProtectionRoutes';
import { getSitemapXml, getRobotsTxt } from './modules/storefront/seoController';
import incompleteOrderRoutes from './modules/orders/incompleteOrderRoutes';
import wooRoutes from './modules/woocommerce/wooRoutes';
import inventoryRoutes from './modules/inventory/inventoryRoutes';
import purchaseRoutes from './modules/purchases/purchaseRoutes';
import accountingRoutes from './modules/accounting/accountingRoutes';
import crmRoutes from './modules/crm/crmRoutes';
import messageRoutes from './modules/messaging/messageRoutes';
import dashboardRoutes from './modules/dashboard/dashboardRoutes';
import auditRoutes from './modules/audit/auditRoutes';
import storefrontRoutes from './modules/storefront/storefrontRoutes';
import mediaRoutes from './modules/media/mediaRoutes';
import builderRoutes, { publicBuilderPage, publicLandingDesign } from './modules/builder/routes';
import { submitBuilderForm } from './modules/builder/formService';
import { countdownRuntime } from './modules/builder/countdownRuntime';
import ivrRoutes from './modules/orders/ivrRoutes';

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
export const io = new SocketIOServer(server, {
  cors: {
    origin: config.clientUrls,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  },
});

// Proxy WebRTC SIP WebSocket to Asterisk PBX (103.169.160.153:8088/ws)
server.on('upgrade', (req, socket, head) => {
  if (req.url && (req.url === '/ws-sip' || req.url.startsWith('/ws-sip'))) {
    const proxyReq = http.request({
      hostname: '103.169.160.153',
      port: 8088,
      path: '/ws',
      method: req.method,
      headers: {
        ...req.headers,
        host: '103.169.160.153:8088',
      },
    });

    proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(proxyRes.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`)
          .join('') +
        '\r\n'
      );
      if (proxyHead && proxyHead.length) {
        socket.write(proxyHead);
      }
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxyReq.on('error', (err) => {
      console.error('SIP WebSocket proxy error:', err.message);
      socket.destroy();
    });

    proxyReq.end();
  }
});

io.use(async (socket, next) => {
  try {
    const token = readSessionToken({ headers: socket.handshake.headers as any });
    if (!token) return next(new Error('Unauthorized'));
    const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as { id: string; sessionVersion: number; kind?: string; exp?: number };
    if (decoded.kind === 'customer' || typeof decoded.id !== 'string' || !Number.isInteger(decoded.sessionVersion)) return next(new Error('Unauthorized'));
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { status: true, sessionVersion: true },
    });
    if (!user || user.status !== 'ACTIVE' || user.sessionVersion !== decoded.sessionVersion) return next(new Error('Unauthorized'));
    socket.data.session = { id: decoded.id, version: decoded.sessionVersion, expiresAt: decoded.exp ? decoded.exp * 1000 : 0 };
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const session = socket.data.session;
  const expiry = session.expiresAt ? setTimeout(() => socket.disconnect(true), Math.min(Math.max(0, session.expiresAt - Date.now()), 2147483647)) : undefined;
  const revalidate = setInterval(async () => {
    try {
      const user = await prisma.user.findUnique({ where: { id: session.id }, select: { status: true, sessionVersion: true } });
      if (!user || user.status !== 'ACTIVE' || user.sessionVersion !== session.version) socket.disconnect(true);
    } catch { socket.disconnect(true); }
  }, 30000);
  socket.on('disconnect', () => { clearInterval(revalidate); if (expiry) clearTimeout(expiry); });
  console.log(`🔌 Client connected to Socket.IO: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Middleware
app.disable('x-powered-by');
// Only the local reverse proxy can supply client IP/protocol headers.
app.set('trust proxy', 'loopback');
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: config.isDev ? false : { directives: {
    scriptSrc: ["'self'", 'https://www.googletagmanager.com', 'https://connect.facebook.net'],
    connectSrc: ["'self'", 'https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.facebook.com', 'wss:', 'ws:'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com'],
    upgradeInsecureRequests: config.publicOrigin.startsWith('https:') ? [] : null,
  } },
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.clientUrls.includes(origin)) return callback(null, true);
    const error = Object.assign(new Error('Origin not allowed'), { status: 403 });
    callback(error);
  },
  credentials: true,
}));
// Cookie-authenticated writes must originate from this site or an explicitly
// configured frontend. This also covers plain HTML forms that bypass CORS.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.headers.cookie || '';
  if (!cookie.includes(`${config.cookieName}=`) && !cookie.includes(`${config.customerCookieName}=`)) return next();
  const origin = req.headers.origin;
  const sameOrigin = `${req.protocol}://${req.get('host')}`;
  if (!origin || (origin !== sameOrigin && !config.clientUrls.includes(origin))) {
    res.status(403).json({ success: false, message: 'Request origin is not allowed' });
    return;
  }
  next();
});
app.use(express.json({
  limit: '1mb',
  verify: (req: any, _res, buffer) => { req.rawBody = Buffer.from(buffer); },
}));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((_req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 500) {
      return sendJson({ success: false, message: 'Internal server error' });
    }
    return sendJson(body);
  }) as typeof res.json;
  next();
});
const uploadedMediaDirectory = path.resolve(__dirname, '../uploads/media');
app.use('/uploads/media', webpNegotiation(uploadedMediaDirectory), express.static(uploadedMediaDirectory, {
  dotfiles: 'deny',
  fallthrough: false,
  immutable: true,
  maxAge: '30d',
  setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); },
}));

// Global Rate Limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests from this IP, please try again later.' },
});
app.use('/api', apiLimiter);
app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-LiteSpeed-Cache-Control', 'no-cache');
  next();
});
// The live LiteSpeed setup may serve the storefront shell directly for root
// paths, so expose the dynamic sitemap through the already proxied /api prefix.
app.get('/api/sitemap.xml', getSitemapXml);

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    service: 'NIX Enterprise OMS & ERP API',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/ready', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ready' }); }
  catch { res.status(503).json({ status: 'unavailable' }); }
});

// API Routes
app.use('/api/email', emailRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin-dropdowns', adminDropdownRoutes);
app.use('/api/order-protection', orderProtectionRoutes);
app.use('/api/incomplete-orders', incompleteOrderRoutes);
app.use('/api/couriers', courierRoutes);
app.use('/api/woocommerce', wooRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/messaging', messageRoutes);
app.use('/api/ivr', ivrRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/storefront', storefrontRoutes);
app.use('/api/media', mediaRoutes);
app.get('/api/builder/runtime.js', (_req, res) => { res.type('application/javascript').setHeader('Cache-Control', 'public, max-age=3600'); res.send(countdownRuntime); });
app.get('/api/builder/public-landings/:slug', publicLandingDesign);
app.use('/api/builder', builderRoutes);
app.get('/b/:slug', publicBuilderPage);
app.post('/b/:slug/forms/:formId', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: 'Too many form submissions. Please try again later.' }), submitBuilderForm);

app.get('/sitemap.xml', getSitemapXml);
app.get('/robots.txt', getRobotsTxt);

mountWebApps(app);

// Error handling middleware
app.use(errorHandler);

const emailTimer = startEmailWorker();
const PORT = config.port;
server.listen(PORT, config.apiHost, () => {
  console.log(`🚀 NIX OMS & ERP Server running on http://${config.apiHost}:${PORT}`);
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(emailTimer);
  const deadline = setTimeout(() => process.exit(1), 40000);
  deadline.unref();
  // Stop accepting HTTP and disconnect long-lived sockets while in-flight
  // checkout transactions finish before the database client is closed.
  io.disconnectSockets(true);
  server.close(() => { void prisma.$disconnect().finally(() => process.exit(0)); });
  server.closeIdleConnections();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
