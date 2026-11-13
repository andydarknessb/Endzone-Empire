// Usage: node scripts/fetch-prior-year-adp.js [--raw-dir <dir>] [--years 2025,2026]
// Reads the saved raw FantasyFootballCalculator ADP responses (<dir>/adp-<year>-<format>.json,
// fetched from https://fantasyfootballcalculator.com/api/v1/adp/<format>?teams=12&year=<year>)
// and writes the committed fixtures server/data/adp-<year>-<format>.json. It never queries the database.
// shortcut: reads saved raw FFC responses only, add a live fetch when a season's responses are not saved first

const fs = require('fs');
const path = require('path');
const { normalizeAdpEntry } = require('../server/services/adp.service');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'server', 'data');
const DEFAULT_RAW_DIR = path.join(ROOT, 'backtest-artifacts', 'v3.2-successor-gate', 'ffc-adp');
const FORMATS = ['standard', 'half-ppr', 'ppr'];

function flag(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

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
    if (raw.status !== 'Success') fail(`${file}: status is ${raw.status}, not Success`);
    const entries = raw.players
      .map(normalizeAdpEntry)
      .filter(Boolean)
      .map(({ nameKey, position, adp }) => ({ nameKey, position, adp }))
      .sort((a, b) => a.adp - b.adp);
    outputs.push({
      file: path.join(DATA_DIR, `adp-${year}-${format}.json`),
      body: {
        meta: {
          start_date: raw.meta.start_date,
          end_date: raw.meta.end_date,
          total_drafts: raw.meta.total_drafts,
        },
        entries,
      },
    });
  }
}

for (const { file, body } of outputs) {
  fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${path.basename(file)}: ${body.entries.length} entries, meta ${JSON.stringify(body.meta)}`);
}
