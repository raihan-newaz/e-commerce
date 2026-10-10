import express, { Express } from 'express';
import path from 'path';
import fs from 'fs';
import { webpNegotiation } from './utils/webpImages';

// API/static misses must never fall through to an application's HTML shell.
export function mountWebApps(app: Express) {
  app.use(['/api', '/uploads', '/socket.io'], (_req, res) => { res.status(404).json({ success: false, message: 'Not found' }); });
  const admin = path.resolve(__dirname, '../../client/dist');
  const store = path.resolve(__dirname, '../../storefront/dist');
  const assetMiss = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (path.extname(req.path) || req.path.startsWith('/assets/')) { res.status(404).end(); return; }
    next();
  };
  const shell = (dir: string) => (req: express.Request, res: express.Response) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).end(); return; }
    if (!fs.existsSync(path.join(dir, 'index.html'))) { res.status(503).type('text').send('Build the application before starting the server.'); return; }
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-LiteSpeed-Cache-Control', 'no-cache');
    res.sendFile(path.join(dir, 'index.html'));
  };
  const staticOptions = { index: false as const, maxAge: 0, setHeaders: (res: express.Response, file: string) => {
    if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }};
  app.use('/admin', express.static(admin, staticOptions), assetMiss, shell(admin));
  // Published HTML and builder iframe documents share these read-only font assets.
  for (const name of ['eicons', 'font-awesome']) app.use('/'+name, express.static(path.join(admin,name)), (_req,res) => {res.status(404).end();});
  app.use(webpNegotiation(store), express.static(store, staticOptions));
  app.get('*', assetMiss, shell(store));
}
