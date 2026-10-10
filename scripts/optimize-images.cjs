#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootArg = process.argv[2];
if (!rootArg) {
  console.error('Usage: node scripts/optimize-images.cjs <image-directory>');
  process.exit(2);
}

const root = path.resolve(rootArg);
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`Image directory not found: ${root}`);
  process.exit(2);
}

const quality = Math.max(50, Math.min(95, Number(process.env.WEBP_QUALITY) || 82));
const maxDimension = Math.max(640, Math.min(6000, Number(process.env.WEBP_MAX_DIMENSION) || 2560));
const extensions = new Set(['.jpg', '.jpeg', '.png']);
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) files.push(file);
  }
}
collect(root);

let generated = 0;
let skipped = 0;
let originalBytes = 0;
let webpBytes = 0;
for (const file of files) {
  const original = fs.statSync(file);
  const extension = path.extname(file);
  const output = path.join(path.dirname(file), `${path.basename(file, extension)}.webp`);
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= original.mtimeMs) { skipped++; continue; }

  const result = spawnSync(process.env.CWEBP_PATH || 'cwebp', [
    '-quiet', '-q', String(quality), '-m', '5', '-resize', String(maxDimension), String(maxDimension), file, '-o', output,
  ], { encoding: 'utf8', windowsHide: true, timeout: 45_000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) {
    if (fs.existsSync(output)) fs.rmSync(output, { force: true });
    console.error(`Could not optimize ${path.relative(root, file)}: ${result.error?.message || result.stderr || 'cwebp failed'}`);
    process.exit(1);
  }

  const optimized = fs.statSync(output);
  if (optimized.size >= original.size) {
    fs.rmSync(output, { force: true });
    skipped++;
    continue;
  }
  generated++;
  originalBytes += original.size;
  webpBytes += optimized.size;
}

const savedBytes = originalBytes - webpBytes;
console.log(`WebP optimization complete: ${generated} generated, ${skipped} unchanged or already optimized, ${Math.max(0, Math.round(savedBytes / 1024))} KB saved across converted files.`);
