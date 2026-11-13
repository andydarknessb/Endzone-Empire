// Usage: node scripts/fetch-prior-year-adp.js [--raw-dir <dir>] [--years 2025,2026]
// Reads the saved raw FantasyFootballCalculator ADP responses (<dir>/adp-<year>-<format>.json,
// fetched from https://fantasyfootballcalculator.com/api/v1/adp/<format>?teams=12&year=<year>)
// and writes the committed fixtures server/data/adp-<year>-<format>.json. It never queries the database.
// FFC names a defense "<City> Defense", which never joins the players table, so DEF gets no curve and a no-history DEF keeps the Position baseline.
// shortcut: reads saved raw FFC responses only, add a live fetch when a season's responses are not saved first

const fs = require('fs');
const path = require('path');
const { normalizeAdpEntry } = require('../server/services/adp.service');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const DEFAULT_RAW_DIR = path.join(ROOT, 'backtest-artifacts', 'v3.2-successor-gate', 'ffc-adp');
const FORMATS = ['standard', 'half-ppr', 'ppr'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: one raw FFC response in, the fixture object out. Throws a plain message when the response is unusable. */
function buildFixture(raw) {
  if (!raw || raw.status !== 'Success') throw new Error(`status is ${raw && raw.status}, not Success`);
  if (!raw.meta || typeof raw.meta !== 'object') throw new Error('meta is missing');
  const { start_date: start, end_date: end, total_drafts: drafts } = raw.meta;
  if (!DATE.test(start) || !DATE.test(end)) throw new Error(`meta dates must be YYYY-MM-DD, got ${start} and ${end}`);
  if (!Array.isArray(raw.players) || raw.players.length === 0) throw new Error('players is missing or empty');
  const entries = raw.players
    .map(normalizeAdpEntry)
    .filter(Boolean)
    .map(({ nameKey, position, adp }) => ({ nameKey, position, adp }))
    .sort((a, b) => a.adp - b.adp);
  return { meta: { start_date: start, end_date: end, total_drafts: drafts }, entries };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function flag(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${name} needs a value. Usage: node scripts/fetch-prior-year-adp.js [--raw-dir <dir>] [--years 2025,2026]`);
  }
  return value;
}

function main() {
  const rawDir = path.resolve(flag('--raw-dir', DEFAULT_RAW_DIR));
  const years = flag('--years', '2025,2026').split(',').map(Number);

  // Every input is read and checked before anything is written, so one bad file leaves the fixtures as they were.
  const outputs = [];
  for (const year of years) {
    for (const format of FORMATS) {
      const file = path.join(rawDir, `adp-${year}-${format}.json`);
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        fail(`${file}: ${err.message}`);
      }
      let body;
      try {
        body = buildFixture(raw);
      } catch (err) {
        fail(`${file}: ${err.message}`);
      }
      outputs.push({ file: path.join(DATA_DIR, `adp-${year}-${format}.json`), body });
    }
  }

  for (const { file, body } of outputs) {
    fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
    console.log(`${path.basename(file)}: ${body.entries.length} entries, meta ${JSON.stringify(body.meta)}`);
  }
}

if (require.main === module) main();

module.exports = { buildFixture };
