const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const directory = path.join(__dirname, '..', 'build', 'static', 'js');
// 184 KiB gzip of initial JavaScript: the build measures 182.0 after axios
// 1.21.1, which alone added 2.65 KiB (#2969). It was 176.4 after the landing-page
// perf split #2257, down from 249; routes, the public tree and the signed-in Nav
// pieces load on demand; the discard dialog stays static. Keep ~2 KiB of headroom over what the build measures (see #63).
const budgetKb = Number(process.env.INITIAL_JS_BUDGET_KB || 184);

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
