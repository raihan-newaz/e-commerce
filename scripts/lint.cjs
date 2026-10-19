const { ESLint } = require('eslint');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Scan every application file. Known legacy violations remain visible in the
// checked-in baseline; new violations (including new source lines) fail CI.
(async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['server/src', 'client/src', 'storefront/src']);
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../eslint-baseline.json'), 'utf8'));
  let existing = 0;
  let errors = 0;
  for (const result of results) {
    const file = path.relative(process.cwd(), result.filePath).replaceAll('\\', '/');
    const lines = fs.readFileSync(result.filePath, 'utf8').split(/\r?\n/);
    for (const message of result.messages) {
      const key = crypto.createHash('sha256').update(JSON.stringify([file, message.ruleId, (lines[message.line - 1] || '').trim()])).digest('hex');
      if (baseline[key] > 0) { baseline[key]--; existing++; continue; }
      console.error(`${file}:${message.line}:${message.column} ${message.ruleId || 'parser'} ${message.message}`);
      errors++;
    }
  }
  console.log(`Linted ${results.length} files: ${errors} new violations; ${existing} existing legacy violations tracked in baseline.`);
  process.exitCode = errors ? 1 : 0;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
