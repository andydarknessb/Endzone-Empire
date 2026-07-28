/**
 * Generate a frozen season schedule manifest (server/data/nfl-schedule-<season>.json)
 * from nflverse's PUBLIC games.csv - a source independent of the app database
 * the manifest will later be used to validate.
 *
 * Usage:
 *   node server/scripts/generate-schedule-manifest.js \
 *     --csv <path-to-games.csv> --commit <nfldata-commit-sha> --blob <games.csv-blob-sha> \
 *     [--season 2026] [--fetched <iso-instant>] [--cross-check-db]
 *
 * The CSV must be the file at
 *   https://raw.githubusercontent.com/nflverse/nfldata/<commit>/data/games.csv
 * and the commit/blob SHAs pin exactly which revision was used, so the
 * manifest can be regenerated bit-for-bit and its digest re-verified against
 * the pinned source by anyone.
 *
 * Deadline policy (`captureNotAfter`, one instant per week): the week's
 * earliest scheduled kickoff, taking `gameday` + `gametime` as
 * America/New_York wall time and converting to UTC. A game with no listed
 * time counts as 00:00 ET on its gameday. Both rules are CONSERVATIVE - the
 * derived deadline can be earlier than the true first kickoff (a flexed
 * game, a TBD time) but never later, which is the property the holdout
 * cutoff needs. Runtime schedule data may tighten this deadline further; it
 * must never extend it.
 *
 * `--cross-check-db` additionally compares game identities against the
 * synced `nfl_games` rows (read-only; needs .env). The structural checks and
 * the digest do not need credentials.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const CROSS_CHECK_DB = args.includes('--cross-check-db');
if (CROSS_CHECK_DB) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
}

const { normalizeTeamKey } = require('../services/projectionFeatures');
const { computeManifestDigest, SEASON_WEEKS } = require('../services/scheduleManifest');

const CANONICAL_TEAM_KEYS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
  'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA',
  'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB',
  'TEN', 'WAS',
];

function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { fields.push(field); field = ''; }
    else field += ch;
  }
  fields.push(field);
  return fields;
}

function zoneOffsetMinutes(utcMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === '24' ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  return (asUtc - utcMs) / 60000;
}

/** America/New_York wall time -> UTC instant, DST-correct via Intl fixpoint. */
function easternWallToUtc(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  let utc = wallAsUtc - zoneOffsetMinutes(wallAsUtc, 'America/New_York') * 60000;
  utc = wallAsUtc - zoneOffsetMinutes(utc, 'America/New_York') * 60000;
  return new Date(utc);
}

(async () => {
  try {
    const csvPath = flag('csv');
    const commit = flag('commit');
    const blob = flag('blob');
    const season = Number(flag('season') || 2026);
    const fetchedAt = flag('fetched') || new Date().toISOString();
    if (!csvPath || !commit || !blob) {
      throw new Error('required: --csv <path> --commit <sha> --blob <sha> (the pinned nfldata revision)');
    }

    const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
    const header = splitCsvLine(lines[0]);
    const col = Object.fromEntries(header.map((h, i) => [h, i]));
    for (const name of ['season', 'game_type', 'week', 'away_team', 'home_team', 'gameday', 'gametime']) {
      if (!(name in col)) throw new Error(`games.csv is missing column ${name}`);
    }

    const games = [];
    for (const line of lines.slice(1)) {
      const f = splitCsvLine(line);
      if (Number(f[col.season]) !== season || f[col.game_type] !== 'REG') continue;
      games.push({
        week: Number(f[col.week]),
        away: normalizeTeamKey(f[col.away_team]),
        home: normalizeTeamKey(f[col.home_team]),
        kickoffUtc: easternWallToUtc(f[col.gameday], f[col.gametime]),
      });
    }
    games.sort((a, b) => a.week - b.week || a.home.localeCompare(b.home));
    console.log(`nflverse ${season} REG games: ${games.length}`);

    // Structural validation of the independent source itself.
    const errors = [];
    if (games.length !== 272) errors.push(`expected 272 games, got ${games.length}`);
    const canonical = new Set(CANONICAL_TEAM_KEYS);
    const appearances = new Map(CANONICAL_TEAM_KEYS.map((t) => [t, new Set()]));
    for (const g of games) {
      if (!canonical.has(g.home)) errors.push(`unknown home ${g.home} wk${g.week}`);
      if (!canonical.has(g.away)) errors.push(`unknown away ${g.away} wk${g.week}`);
      if (g.week < 1 || g.week > SEASON_WEEKS) errors.push(`week out of range: ${g.week}`);
      appearances.get(g.home)?.add(g.week);
      appearances.get(g.away)?.add(g.week);
    }
    for (const [team, weeks] of appearances) {
      if (weeks.size !== 17) errors.push(`${team}: ${weeks.size} weeks, expected 17`);
    }

    const captureNotAfter = {};
    for (let week = 1; week <= SEASON_WEEKS; week++) {
      const kicks = games.filter((g) => g.week === week).map((g) => g.kickoffUtc.getTime());
      if (kicks.length === 0) { errors.push(`week ${week} has no games`); continue; }
      captureNotAfter[String(week)] = new Date(Math.min(...kicks)).toISOString();
    }

    if (CROSS_CHECK_DB) {
      const pool = require('../modules/pool');
      const db = await pool.query(
        `SELECT "week", "nfl_team", "opponent" FROM "nfl_games"
         WHERE "season" = $1 AND "week" BETWEEN 1 AND ${SEASON_WEEKS}`,
        [season]
      );
      const pairKey = (w, a, b) => `${w}:${[a, b].sort().join('-')}`;
      const dbPairs = new Set(db.rows.map((r) =>
        pairKey(Number(r.week), normalizeTeamKey(r.nfl_team), normalizeTeamKey(r.opponent))));
      const manifestPairs = new Set(games.map((g) => pairKey(g.week, g.away, g.home)));
      const dbOnly = [...dbPairs].filter((p) => !manifestPairs.has(p));
      const manifestOnly = [...manifestPairs].filter((p) => !dbPairs.has(p));
      console.log(`cross-check: db pairs ${dbPairs.size}, manifest pairs ${manifestPairs.size}`);
      if (dbOnly.length) errors.push(`DB-only pairs: ${dbOnly.slice(0, 8).join(' ')}`);
      if (manifestOnly.length) errors.push(`manifest-only pairs: ${manifestOnly.slice(0, 8).join(' ')}`);
      await pool.end();
    }

    if (errors.length > 0) {
      console.error('MANIFEST VALIDATION FAILED:');
      for (const e of errors.slice(0, 20)) console.error('  ' + e);
      process.exit(1);
    }

    const manifest = {
      season,
      source: {
        url: `https://raw.githubusercontent.com/nflverse/nfldata/${commit}/data/games.csv`,
        repo: 'nflverse/nfldata',
        path: 'data/games.csv',
        commit,
        blobSha: blob,
        fetchedAt,
        generator: 'server/scripts/generate-schedule-manifest.js',
        deadlinePolicy: 'captureNotAfter per week = earliest scheduled kickoff (gameday+gametime as America/New_York, converted to UTC; a game with no listed time counts as 00:00 ET on its gameday). Conservative: never later than the true first kickoff. Runtime data may tighten, never extend.',
      },
      captureNotAfter,
      games: games.map(({ week, away, home }) => ({ week, away, home })),
    };
    manifest.digest = computeManifestDigest(manifest);

    const outPath = flag('out') || path.join(__dirname, '..', 'data', `nfl-schedule-${season}.json`);
    fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`manifest written to ${outPath}`);
    console.log(`digest ${manifest.digest}`);
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
})();
