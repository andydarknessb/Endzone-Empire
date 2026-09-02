const pool = require('../modules/pool');
const projectionService = require('./projection.service');
const { availabilityFor } = require('./projectionModel');
const { computeByeWeeks } = require('./bye.service');
const { normalizeNflTeam } = require('./nflTeam');
const { optimalLineup, parseLineupSettings } = require('./lineup.service');

/**
 * Expected final (CONTEXT.md, Scoring and the week): a starter's, or a
 * team's, points at the end of the week as best known now. Per starter it is
 * his weekly projection before his kickoff, his points so far plus any
 * shortfall against that projection while his game is in progress, and his
 * points alone once it is final. A team's is the sum over its starters.
 * Players remaining is the count of starters whose game has not finished.
 *
 * One producer for every surface: the matchup list route, the matchup detail
 * route and the live score sync's `scores:updated` emit all read this, so a
 * card, the page it opens and the socket that refreshes both cannot disagree.
 * Nothing is persisted: every input (lineup rows, this week's stats, the
 * weekly projection run, the live game table, the schedule) is already
 * stored, and a stored copy of the answer would only be a second thing to
 * keep fresh.
 *
 * Inputs and rules:
 *  - Starters are the team's non-BENCH, non-IR lineup rows joined to the
 *    current roster (team_players), the same population the detail route
 *    and the live score read. No lineup is materialized here: a list GET
 *    must not write a dozen teams' rows; the week advance and the first
 *    score sync do that.
 *  - Projection is the weekly (league-aware) engine, the number the Lineup
 *    page shows, under the same availability rule: bye, Out and IR count as
 *    zero before kickoff.
 *  - Game state is `live_game_states.game_status` for the starter's NFL
 *    team, matched on the normalized team code. With no row yet, the
 *    schedule's kickoff decides: before it, not started; after it, in
 *    progress. A starter on bye has no game and is final at his points. A
 *    starter with points on the board is in progress whatever the table
 *    says, since points prove the game began.
 *  - Best-ball leagues use every current non-IR candidate, then choose the
 *    optimal legal lineup on per-player expected finals. That makes the
 *    figure converge with best-ball scoring once every game is final.
 *  - Best-effort: a failed projection read answers no expected final at
 *    all (an empty result) rather than failing the caller. A figure built
 *    from actual points alone would read as a forecast of zero for every
 *    starter yet to kick off, which is worse than a dash.
 */

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * The per-starter rule, pure. `gameState` is 'scheduled' | 'in_progress' |
 * 'final'. Rounded to 2dp for display unless `round: false`, which a caller
 * summing several starters uses so the team total is rounded once.
 */
function expectedFinalForStarter({ projection, points, gameState, round = true }) {
  const actual = Number(points) || 0;
  const proj = Number(projection) || 0;
  let value;
  if (gameState === 'final') value = actual;
  else if (gameState === 'in_progress') value = actual + Math.max(0, proj - actual);
  else value = proj;
  return round ? round2(value) : value;
}

/**
 * With no live row, a game is taken as over this long after its scheduled
 * kickoff. NFL games run about three and a half hours; five leaves room for
 * a long overtime and a weather delay. Without this bound a week the live
 * engine never covered would keep every starter "in progress" forever, at
 * his full projection and counted as remaining.
 */
const NO_LIVE_ROW_FINAL_AFTER_MS = 5 * 60 * 60 * 1000;

/**
 * Resolve a starter's game state, pure. `liveStatus` is the live table's
 * status for his team or null; `kickoffAt` is the schedule's kickoff or
 * null; `onBye` means no game this week. The live table wins when it has a
 * row; otherwise the schedule decides: before kickoff not started, after it
 * in progress, and well after it (NO_LIVE_ROW_FINAL_AFTER_MS) final.
 */
function gameStateFor({ liveStatus, kickoffAt, onBye, points, now }) {
  if (onBye) return 'final';
  const actual = Number(points) || 0;
  if (liveStatus === 'final') return 'final';
  if (liveStatus === 'in_progress') return 'in_progress';
  if (liveStatus === 'scheduled') return actual > 0 ? 'in_progress' : 'scheduled';
  const kickoff = kickoffAt && now ? new Date(kickoffAt).getTime() : null;
  const at = now ? new Date(now).getTime() : null;
  if (kickoff != null && Number.isFinite(kickoff) && at != null) {
    if (at - kickoff >= NO_LIVE_ROW_FINAL_AFTER_MS) return 'final';
    if (at >= kickoff) return 'in_progress';
  }
  return actual > 0 ? 'in_progress' : 'scheduled';
}

/**
 * Expected finals for the given teams in one (season, week) of one league.
 * Returns a Map<teamId, { expectedFinal, playersRemaining, starters }> with
 * an entry only for teams that have at least one starter row; `starters` is
 * an array of { playerId, projection, points, gameState, expectedFinal }
 * for callers that show per-player figures. Best-ball entries contain the
 * optimizer's chosen lineup. `db` may be a pool or a checked-out client.
 */
async function expectedFinalsForWeek({ league, season, week, teamIds, db = pool, now = new Date() }) {
  const result = new Map();
  const ids = [...new Set((teamIds || []).map(Number).filter(Number.isFinite))];
  if (!league || ids.length === 0) return result;
  // Required lazily: scoring.service reads this module from inside its own
  // live-score pass, so a top-level require in both directions would leave
  // one side with an empty export object at load time.
  const { rulesForLeague, calculateFantasyPoints } = require('./scoring.service');
  const rules = rulesForLeague(league);

  const candidateRows = await db.query(
    `SELECT "lineup_entries"."team_id", "lineup_entries"."player_id",
            "players"."position", "players"."nfl_team", "players"."injury_status", "player_stats"."stats"
     FROM "lineup_entries"
     JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
       AND "team_players"."player_id" = "lineup_entries"."player_id"
     JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
     LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
       AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
     WHERE "lineup_entries"."team_id" = ANY($1)
       AND "lineup_entries"."season" = $2 AND "lineup_entries"."week" = $3
       AND "lineup_entries"."slot" ${league.best_ball ? "!= 'IR'" : "NOT IN ('BENCH', 'IR')"}`,
    [ids, season, week]
  );
  if (candidateRows.rows.length === 0) return result;

  const playerIds = [...new Set(candidateRows.rows.map((r) => r.player_id))];
  const nflTeams = [...new Set(candidateRows.rows.map((r) => r.nfl_team).filter(Boolean))];

  const [projections, byeByTeam, liveRows, scheduleRows] = await Promise.all([
    projectionService
      .getWeeklyProjections({ season, week, league, playerIds })
      .then((run) => ({ ok: true, map: projectionService.toLegacyProjectionMap(run) }))
      .catch((err) => {
        console.error('expected final: weekly projections unavailable', err.message);
        return { ok: false, map: new Map() };
      }),
    computeByeWeeks(nflTeams, season, { client: db }),
    db.query(
      `SELECT "home_team", "away_team", "game_status"
       FROM "live_game_states" WHERE "season" = $1 AND "week" = $2`,
      [season, week]
    ),
    db.query(
      `SELECT "nfl_team", "kickoff_at" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
      [season, week]
    ),
  ]);

  // No projection run means no expected final: a number built from actual
  // points alone would read as a forecast of zero for every starter who has
  // not kicked off yet, which is worse than a dash.
  if (!projections.ok) return result;

  // Both live and schedule maps are keyed by the normalized team code and
  // looked up the same way, so a DEF unit's full team name and Tank01's raw
  // abbreviation agree (the #423 / #425 pattern).
  const liveByTeam = new Map();
  for (const row of liveRows.rows) {
    liveByTeam.set(normalizeNflTeam(row.home_team), row.game_status);
    liveByTeam.set(normalizeNflTeam(row.away_team), row.game_status);
  }
  const kickoffByTeam = new Map(scheduleRows.rows.map((r) => [normalizeNflTeam(r.nfl_team), r.kickoff_at]));

  const byTeam = new Map();
  for (const row of candidateRows.rows) {
    const team = normalizeNflTeam(row.nfl_team);
    const onBye = byeByTeam.get(row.nfl_team) === Number(week);
    const availability = availabilityFor({ injuryStatus: row.injury_status, onBye });
    const raw = projections.map.get(row.player_id);
    const projection = availability.available && raw && Number.isFinite(Number(raw.points))
      ? round2(Number(raw.points))
      : 0;
    // Points stay unrounded until the team total is rounded once, the way
    // the score pass sums a team, so an expected final and a score built
    // from the same finished games cannot differ by a rounding step.
    const points = row.stats ? calculateFantasyPoints(row.stats, rules) : 0;
    const gameState = gameStateFor({
      liveStatus: liveByTeam.get(team) || null,
      kickoffAt: kickoffByTeam.get(team) || null,
      onBye,
      points,
      now,
    });
    const starter = {
      playerId: row.player_id,
      position: row.position,
      projection,
      points: round2(points),
      gameState,
      expectedFinal: expectedFinalForStarter({ projection, points, gameState }),
      rawExpectedFinal: expectedFinalForStarter({ projection, points, gameState, round: false }),
    };
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, []);
    byTeam.get(row.team_id).push(starter);
  }

  for (const [teamId, candidates] of byTeam) {
    const starters = league.best_ball
      ? (() => {
        const { rosterSlots } = parseLineupSettings(league);
        const pointsFor = new Map(candidates.map((candidate) => [candidate.playerId, candidate.rawExpectedFinal]));
        const { starters: chosen } = optimalLineup(candidates, rosterSlots, pointsFor);
        const byPlayerId = new Map(candidates.map((candidate) => [candidate.playerId, candidate]));
        return chosen.map(({ playerId }) => byPlayerId.get(playerId));
      })()
      : candidates;
    result.set(Number(teamId), {
      expectedFinal: round2(starters.reduce((sum, s) => sum + s.rawExpectedFinal, 0)),
      playersRemaining: starters.filter((s) => s.gameState !== 'final').length,
      starters: starters.map(({ rawExpectedFinal, ...starter }) => starter),
    });
  }
  return result;
}

/**
 * Decorate matchup list rows with `home_expected_final`, `away_expected_final`,
 * `home_players_remaining` and `away_players_remaining` (number or null).
 * Final matchups carry null and never read projections: their result is the
 * score. Rows for a (season, week) with no lineup rows carry null too, which
 * is what an untouched future week looks like. Best-effort: a failed read
 * leaves nulls and the list still answers.
 */
async function attachExpectedFinals(rows, { league, db = pool, now = new Date() } = {}) {
  const out = rows.map((row) => ({
    ...row,
    home_expected_final: null,
    away_expected_final: null,
    home_players_remaining: null,
    away_players_remaining: null,
  }));
  const open = out.filter((m) => !m.final);
  if (open.length === 0 || !league) return out;

  const groups = new Map();
  for (const m of open) {
    const key = `${m.season}:${m.week}`;
    if (!groups.has(key)) groups.set(key, { season: Number(m.season), week: Number(m.week), matchups: [] });
    groups.get(key).matchups.push(m);
  }
  for (const { season, week, matchups } of groups.values()) {
    const teamIds = matchups.flatMap((m) => [m.home_team_id, m.away_team_id]);
    let byTeam;
    try {
      byTeam = await expectedFinalsForWeek({ league, season, week, teamIds, db, now });
    } catch (err) {
      console.error('expected final: matchup list decoration unavailable', err.message);
      continue;
    }
    for (const m of matchups) {
      const home = byTeam.get(Number(m.home_team_id));
      const away = byTeam.get(Number(m.away_team_id));
      if (home) {
        m.home_expected_final = home.expectedFinal;
        m.home_players_remaining = home.playersRemaining;
      }
      if (away) {
        m.away_expected_final = away.expectedFinal;
        m.away_players_remaining = away.playersRemaining;
      }
    }
  }
  return out;
}

module.exports = {
  expectedFinalForStarter,
  gameStateFor,
  expectedFinalsForWeek,
  attachExpectedFinals,
};
