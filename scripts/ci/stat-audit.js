'use strict';

/**
 * Weekly read-only audit (#3006, spec #2998): would the nflverse stat correction,
 * run again now for the settled week, change any player_stats row? A row it would
 * change does not hold what nflverse says: a later writer overwrote it, or nflverse
 * revised the week after the Wednesday correction. The lines come from the
 * correction's own builders, so the audit cannot disagree with it about what
 * "correct" means. One read-only transaction on DATABASE_URL_RUNTIME; writes nothing.
 * Exit 1 when a stored line differs; the same report goes to GITHUB_STEP_SUMMARY.
 */

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const pool = require('../../server/modules/pool');
const { settledFrontier } = require('../../server/services/playerStatsIntegrity.service');
const { planPlayerStatsWrite } = require('../../server/services/playerStatsWrite.service');
const {
  fetchPlayerWeekStatsForSeason, fetchTeamWeekStatsForSeason, fetchGameScoresForSeason,
  fetchPlayersCrosswalk, filterRowsForWeek, buildCorrectionUnits, buildNflverseUnitLines,
} = require('../../server/services/nflverseSync.service');
const boxScoreApply = require('../../server/services/boxScoreApply.service');

const CORRECTION_SOURCE = 'nflverse-correction';
const NO_ROW = '(no stored row)';
const FANTASY_POINTS_TOLERANCE = 0.005;
const DIFF_LIMIT = 50;

/**
 * Pure: where the stored Stat lines differ from what the correction would write.
 * `lines` are buildNflverseUnitLines output ({ playerId, fresh, position }) in the
 * correction's write order; `storedByPlayer` maps a player id to its stored row
 * ({ stats, fantasy_points }); `plan` is planPlayerStatsWrite. A player id with
 * two lines is compared on its last one, the line the correction leaves stored.
 * Returns one { playerId, key, stored, expected } per differing key, one for a
 * line with no stored row, and one for the fantasy points.
 */
function compareStatLines({ lines, storedByPlayer, plan }) {
  const differences = [];
  const latest = new Map(lines.map((line) => [line.playerId, line]));
  for (const { playerId, fresh, position } of latest.values()) {
    const row = storedByPlayer.get(playerId) || null;
    const planned = plan({ source: CORRECTION_SOURCE, fresh, prior: row ? row.stats : null, position });
    if (planned === null) continue; // the policy writes nothing, so nothing can differ
    if (!row) {
      differences.push({ playerId, key: NO_ROW, stored: null, expected: planned.stats });
      continue;
    }
    // The funnel stores JSON, which drops -0 and undefined: compare what would be stored.
    const expected = JSON.parse(JSON.stringify(planned.stats));
    const stored = row.stats || {};
    for (const key of Object.keys(expected)) {
      if (!isDeepStrictEqual(expected[key], stored[key])) {
        differences.push({ playerId, key, stored: stored[key] ?? null, expected: expected[key] });
      }
    }
    for (const key of Object.keys(stored)) {
      if (!Object.hasOwn(expected, key)) differences.push({ playerId, key, stored: stored[key], expected: null });
    }
    const storedPoints = Number(row.fantasy_points);
    // Negated <= so a NaN (a stored value that is not a number) is a difference.
    if (!(Math.abs(storedPoints - planned.fantasyPoints) <= FANTASY_POINTS_TOLERANCE)) {
      differences.push({ playerId, key: 'fantasy_points', stored: storedPoints, expected: planned.fantasyPoints });
    }
  }
  return differences;
}

/**
 * Pure: why a settled week's lines cannot be audited, or null when they can. A
 * settled week with games always has player lines; none means the feed came back
 * empty or truncated, which must not read as a clean week.
 */
function emptyWeekProblem({ season, week, units, playerLines, dstLines }) {
  if (playerLines > 0) return null;
  return `stat audit ${season} week ${week}: nflverse gave no player lines for ${units} units (${dstLines} DST lines), and a settled week with games is never empty`;
}

function report({ season, week, checked, differing, differences }) {
  const shown = differences.slice(0, DIFF_LIMIT);
  const out = [`stat audit ${season} week ${week}: ${checked} lines checked, ${differing} differ`];
  for (const d of shown) out.push(`${d.playerId}, ${d.key}, ${JSON.stringify(d.stored)}, ${JSON.stringify(d.expected)}`);
  if (differences.length > shown.length) out.push(`... ${differences.length - shown.length} more differences not shown`);
  console.log(out.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = shown.map((d) => `| ${d.playerId} | ${d.key} | \`${JSON.stringify(d.stored)}\` | \`${JSON.stringify(d.expected)}\` |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      `### Stat audit: ${season} week ${week}`,
      '',
      `${checked} lines checked, ${differing} differ`,
      '',
      '| player id | key | stored | expected |',
      '|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'));
  }
}

async function main() {
  // The frontier and the fetches run with no transaction open: a connection idle in a
  // transaction through a multi-megabyte download can be ended by the pooler.
  const frontier = await settledFrontier(pool);
  if (!frontier) {
    console.log('::warning::stat audit: no settled frontier (no ok nflverse-correction run with games in its file), nothing audited');
    return 0;
  }
  const { season, week } = frontier;
  // The same exported fetches, filters and units syncNflverseCorrection uses for its fetch.
  const [players, teams, scores, xwalk] = await Promise.all([
    fetchPlayerWeekStatsForSeason(season),
    fetchTeamWeekStatsForSeason(season),
    fetchGameScoresForSeason(season),
    fetchPlayersCrosswalk(),
  ]);
  const weekPlayerRows = filterRowsForWeek(players, { season, week });
  const weekTeamRows = filterRowsForWeek(teams, { season, week });
  const defByTeamCode = await boxScoreApply.loadDefUnitsByTeamCode();

  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const knownPlayers = await client.query(
      `SELECT "id", "external_id", "position" FROM "players" WHERE "external_id" IS NOT NULL`
    );
    const idByExternal = new Map(knownPlayers.rows.map((r) => [String(r.external_id), r.id]));
    const positionById = new Map(knownPlayers.rows.map((r) => [r.id, r.position]));
    const shared = { season, week, scoresByGameId: scores, crosswalk: xwalk, idByExternal, positionById, defByTeamCode };
    const units = buildCorrectionUnits({ weekPlayerRows, weekTeamRows }).map((u) => ({ ...shared, ...u }));
    const built = units.map((unit) => buildNflverseUnitLines(unit));
    const problem = emptyWeekProblem({
      season,
      week,
      units: units.length,
      playerLines: built.reduce((n, u) => n + u.players.length, 0),
      dstLines: built.reduce((n, u) => n + u.dst.length, 0),
    });
    if (problem) {
      console.error(problem);
      return 1;
    }
    // The order the correction writes them: each unit's player lines, then its DST lines.
    const lines = built.flatMap((u) => [...u.players, ...u.dst]);

    const stored = await client.query(
      `SELECT "player_id", "stats", "fantasy_points" FROM "player_stats" WHERE "season" = $1 AND "week" = $2`,
      [season, week]
    );
    const storedByPlayer = new Map(stored.rows.map((r) => [r.player_id, r]));

    const differences = compareStatLines({ lines, storedByPlayer, plan: planPlayerStatsWrite });
    const checked = new Set(lines.map((l) => l.playerId)).size;
    const differing = new Set(differences.map((d) => d.playerId)).size;
    report({ season, week, checked, differing, differences });
    return differing > 0 ? 1 : 0;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { compareStatLines, emptyWeekProblem, main };
