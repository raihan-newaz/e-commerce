import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { RequestHandler } from 'express';

const execFileAsync = promisify(execFile);
const supportedSourceExtensions = new Set(['.jpg', '.jpeg', '.png']);

const boundedNumber = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
};

export async function convertImageToWebp(sourcePath: string, destinationPath: string): Promise<void> {
  const quality = boundedNumber(process.env.WEBP_QUALITY, 82, 50, 95);
  const maxDimension = boundedNumber(process.env.WEBP_MAX_DIMENSION, 2560, 640, 6000);
  await execFileAsync(process.env.CWEBP_PATH || 'cwebp', [
    '-quiet', '-q', String(quality), '-m', '5', '-resize', String(maxDimension), String(maxDimension), sourcePath, '-o', destinationPath,
  ], { timeout: 45_000, windowsHide: true, maxBuffer: 1024 * 1024 });
}

/** Serve a sibling WebP when the browser supports it, keeping stored URLs and originals intact. */
export function webpNegotiation(rootDirectory: string): RequestHandler {
  const root = path.resolve(rootDirectory);
  const rootPrefix = `${root}${path.sep}`;

  return (req, res, next) => {
    const accept = req.get('accept') || '';
    let decodedPath: string;
    try { decodedPath = decodeURIComponent(req.path); } catch { next(); return; }
    const sourceExtension = path.extname(decodedPath);
    const extension = sourceExtension.toLowerCase();
    if (!supportedSourceExtensions.has(extension)) { next(); return; }
    res.vary('Accept');
    const acceptsWebp = accept.split(',').some((entry) => {
      const [mediaType, ...parameters] = entry.trim().toLowerCase().split(';');
      return mediaType === 'image/webp' && !parameters.some((parameter) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(parameter));
    });
    if (!acceptsWebp) { next(); return; }

    const source = path.resolve(root, `.${decodedPath}`);
    if (!source.startsWith(rootPrefix)) { next(); return; }
    const webpPath = path.join(path.dirname(source), `${path.basename(source, path.extname(source))}.webp`);
    if (!fs.existsSync(webpPath)) { next(); return; }

    res.type('image/webp');
    res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    res.sendFile(webpPath, { dotfiles: 'deny', immutable: true, maxAge: '30d' }, (error) => {
      if (error) {
        if (res.headersSent) next(error);
        else next();
      }
    });
  };
}
