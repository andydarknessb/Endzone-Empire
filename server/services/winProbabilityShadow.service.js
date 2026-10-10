const pool = require('../modules/pool');
const { winProbabilityV2 } = require('./winProbability');

/**
 * Win probability v2 shadow mode (Home v2 spec, "Win probability v2" board):
 * record v2 from the live score pass without showing it anywhere, so it can
 * be scored against v1 and the real results before it replaces v1.
 *
 * The score pass already decorates its open matchups with Expected finals
 * (expectedFinal.service decorateMatchups); each team entry there now also
 * carries `varianceRemaining`. This writer turns those into one
 * `win_probability_shadow` row per matchup per 15-minute window, keeping the
 * window's first snapshot. `scheduled`, `live` and `played` matchups are
 * recorded (`played`, every game over but the week not settled, is where the
 * gate's "exactly 0 or 1 once over" is checked); a `final` one is settled and
 * a null status is a read the server could not trust (ADR 0030). A matchup
 * with no Expected final on either side has no v2 and writes nothing.
 *
 * v1 is not stored: the client's v1 (src/entities/matchup/model/winProbability.js) is a
 * function of each side's score and Expected final, both on the row, so the
 * evaluation recomputes it exactly by calling that function.
 *
 * `k` is the calibration constant; shadow mode records at k = 1 and the
 * backtest fits the value v2 ships with.
 */

const MODEL_VERSION = 'v2';
const BUCKET_MS = 15 * 60 * 1000;
const RECORDED_STATUSES = new Set(['scheduled', 'live', 'played']);
const COLUMNS = [
  'league_id', 'matchup_id', 'season', 'week', 'bucket_start', 'captured_at', 'status',
  'home_score', 'away_score', 'home_expected_final', 'away_expected_final',
  'home_players_remaining', 'away_players_remaining', 'starters_without_interval',
  'mu', 'sigma', 'k', 'home_probability', 'model_version',
];
const withoutInterval = (team) => (team && Number(team.uncertainStartersWithoutInterval)) || 0;

function bucketStart(now) {
  return new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);
}

async function recordWinProbabilityShadow({
  leagueId, season, week, scored = [], decorations = new Map(), db = pool, now = new Date(), k = 1,
}) {
  const capturedAt = new Date(now);
  const bucket = bucketStart(capturedAt);
  const rows = [];
  for (const entry of scored) {
    const decoration = decorations.get(entry.matchupId);
    if (!decoration || !RECORDED_STATUSES.has(decoration.status)) continue;
    const v2 = winProbabilityV2({
      homeExpectedFinal: decoration.homeExpectedFinal,
      awayExpectedFinal: decoration.awayExpectedFinal,
      homeVariance: decoration.home ? decoration.home.varianceRemaining : null,
      awayVariance: decoration.away ? decoration.away.varianceRemaining : null,
      k,
    });
    if (!v2) continue;
    rows.push([
      leagueId, entry.matchupId, season, week, bucket, capturedAt, decoration.status,
      entry.homeScore, entry.awayScore, decoration.homeExpectedFinal, decoration.awayExpectedFinal,
      decoration.homePlayersRemaining, decoration.awayPlayersRemaining,
      withoutInterval(decoration.home) + withoutInterval(decoration.away),
      v2.mu, v2.sigma, k, v2.home, MODEL_VERSION,
    ]);
  }
  if (rows.length === 0) return 0;

  const values = rows.map((_, r) => `(${COLUMNS.map((__, c) => `$${r * COLUMNS.length + c + 1}`).join(', ')})`);
  await db.query(
    `INSERT INTO "win_probability_shadow" (${COLUMNS.map((c) => `"${c}"`).join(', ')})
     VALUES ${values.join(', ')}
     ON CONFLICT ("matchup_id", "bucket_start") DO NOTHING`,
    rows.flat()
  );
  return rows.length;
}

module.exports = { recordWinProbabilityShadow, MODEL_VERSION };
