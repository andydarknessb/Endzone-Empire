/**
 * QA f4 (#1789 triage acceptance list): "add an assertion that
 * reconcileAvailability is not required by anything under scripts/backtest".
 *
 * `reconcileAvailability` (server/services/projection.service.js) patches
 * cached `player_week_projections` rows - a table neither the holdout
 * capture path nor the backtest snapshot/replay path ever reads or writes
 * (they call `generateProjections` directly and live entirely in
 * `projection_snapshot_players`, per the #1789 triage's own facts). This
 * scan is the standing proof, over the real tree rather than by inspection:
 * no `.js` file under `scripts/backtest` or `scripts/holdout` mentions
 * `reconcileAvailability` anywhere in its source - not as a `require(...)`
 * spec, not as a bare property access off an already-required module, not
 * in a string. That is a strictly narrower, name-specific check than
 * `backtestExtractSnapshot.test.js`'s existing "the whole backtest tree ...
 * requires no server code" guard (which already forbids requiring
 * `server/services/*` at all); this one exists because the triage asked
 * for it by name, and it doubles as the more specific, more legible failure
 * message if it is ever the one that fires.
 *
 * Comments and string literals are NOT stripped before scanning, on purpose:
 * this is an ISOLATION check, not a hand-rolled-transaction-style
 * code-vs-comment guard, and the desired property - the whole tree carries
 * no trace of the name at all - is stronger than "no live reference". A
 * file that merely mentions the identifier in a comment would still be
 * worth a second look.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOTS = ['scripts/backtest', 'scripts/holdout'];
const REPO_ROOT = path.join(__dirname, '..', '..');
const FORBIDDEN = 'reconcileAvailability';

/** Every `.js` file under `dir` (repo-relative), recursively. */
function jsFilesUnder(dir) {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
  return walk(abs);
}

test('reconcileAvailability is not required (or mentioned at all) by anything under scripts/backtest or scripts/holdout', () => {
  const files = ROOTS.flatMap((root) => jsFilesUnder(root));
  assert.ok(files.length >= 10, `found the backtest and holdout tooling (${files.length} files)`);
  const hits = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(FORBIDDEN)) hits.push(path.relative(REPO_ROOT, file));
  }
  assert.deepEqual(hits, [], `${FORBIDDEN} must never appear under scripts/backtest or scripts/holdout - holdout captures and backtest replays call generateProjections directly and never touch player_week_projections`);
});
