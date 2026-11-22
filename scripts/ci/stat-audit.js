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

// decimal(8,2) rounds half away from zero on insert, so the plan is rounded the same way.
const toCents = (points) => (Math.sign(points) * Math.round(Number((Math.abs(points) * 100).toPrecision(15)))) / 100;

/**
 * Pure: where the stored Stat lines differ from what the correction would write.
 * `lines` are buildNflverseUnitLines output ({ playerId, fresh, position });
 * `storedByPlayer` maps a player id to its stored row ({ stats, fantasy_points });
 * `plan` is planPlayerStatsWrite. Returns one { playerId, key, stored, expected }
 * per differing key, one for a line with no stored row, and one for the points.
 */
function compareStatLines({ lines, storedByPlayer, plan }) {
  const differences = [];
  for (const { playerId, fresh, position } of lines) {
    const row = storedByPlayer.get(playerId) || null;
    const planned = plan({ source: CORRECTION_SOURCE, fresh, prior: row ? row.stats : null, position });
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
    const points = toCents(planned.fantasyPoints);
    // Negated <= so a NaN (a stored value that is not a number) is a difference.
    if (!(Math.abs(storedPoints - points) <= FANTASY_POINTS_TOLERANCE)) {
      differences.push({ playerId, key: 'fantasy_points', stored: storedPoints, expected: points });
    }
  }
  return differences;
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const frontier = await settledFrontier(client);
    if (!frontier) {
      console.log('stat audit: no settled frontier (no ok nflverse-correction run with games in its file), nothing to audit');
      return 0;
    }
    const { season, week } = frontier;
    // The fetch half of syncNflverseCorrection, line for line: same reads, same filters, same units.
    const [players, teams, scores, xwalk] = await Promise.all([
      fetchPlayerWeekStatsForSeason(season),
      fetchTeamWeekStatsForSeason(season),
      fetchGameScoresForSeason(season),
      fetchPlayersCrosswalk(),
    ]);
    const weekPlayerRows = filterRowsForWeek(players, { season, week });
    const weekTeamRows = filterRowsForWeek(teams, { season, week });
    const knownPlayers = await client.query(
      `SELECT "id", "external_id", "position" FROM "players" WHERE "external_id" IS NOT NULL`
    );
    const idByExternal = new Map(knownPlayers.rows.map((r) => [String(r.external_id), r.id]));
    const positionById = new Map(knownPlayers.rows.map((r) => [r.id, r.position]));
    const defByTeamCode = await boxScoreApply.loadDefUnitsByTeamCode();
    const shared = { season, week, scoresByGameId: scores, crosswalk: xwalk, idByExternal, positionById, defByTeamCode };
    const units = buildCorrectionUnits({ weekPlayerRows, weekTeamRows }).map((u) => ({ ...shared, ...u }));
    const lines = units.flatMap((unit) => {
      const unitLines = buildNflverseUnitLines(unit);
      return [...unitLines.players, ...unitLines.dst];
    });

    const stored = await client.query(
      `SELECT "player_id", "stats", "fantasy_points" FROM "player_stats" WHERE "season" = $1 AND "week" = $2`,
      [season, week]
    );
    const storedByPlayer = new Map(stored.rows.map((r) => [r.player_id, r]));

    const differences = compareStatLines({ lines, storedByPlayer, plan: planPlayerStatsWrite });
    const differing = new Set(differences.map((d) => d.playerId)).size;
    report({ season, week, checked: lines.length, differing, differences });
    return differing;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

if (require.main === module) {
  main()
    .then((differing) => {
      process.exitCode = differing > 0 ? 1 : 0;
    })
    .catch((err) => {
      console.error('FAILED:', err.stack || err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { compareStatLines, main };
