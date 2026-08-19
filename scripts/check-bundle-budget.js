const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const directory = path.join(__dirname, '..', 'build', 'static', 'js');
// 250 KiB gzip of initial JavaScript. Netlify builds of the same commit vary
// by tens of bytes, so keep real headroom under this line (see #63, which
// trimmed main.js from 250 to ~230 after the guard failed three deploys).
const budgetKb = Number(process.env.INITIAL_JS_BUDGET_KB || 250);

if (!fs.existsSync(directory)) {
  throw new Error('build/static/js does not exist; run npm run build first');
}

const entryFiles = fs.readdirSync(directory)
  .filter((name) => /^main\..+\.js$/.test(name) && !name.endsWith('.map'));
if (entryFiles.length !== 1) throw new Error(`expected one main bundle, found ${entryFiles.length}`);

const file = path.join(directory, entryFiles[0]);
const gzipKb = zlib.gzipSync(fs.readFileSync(file)).length / 1024;
console.log(`Initial JavaScript: ${gzipKb.toFixed(2)} KiB gzip (budget ${budgetKb} KiB)`);
if (gzipKb > budgetKb) {
  throw new Error(`initial JavaScript exceeds budget by ${(gzipKb - budgetKb).toFixed(2)} KiB`);
}
