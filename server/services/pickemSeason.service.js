const pool = require('../modules/pool');
const { REG_SEASON_WEEKS, winnerOf, getSeasonSlate, getStandings } = require('./pickem.service');
const { awardPickemChampions, notifyAwardedOwners } = require('./trophy.service');
const { notifyLeague } = require('./activity.service');

/**
 * Pick'em season lifecycle for pick'em-only leagues.
 *
 * A pick'em-only league has no matchups, so the commissioner advance-week
 * action can never run for it. Its weeks follow the NFL calendar instead, and
 * its season completes on its own once week 18 finalizes. This module owns
 * that axis (week sync, completion, champion) and leaves picks, locks and
 * scoring to pickem.service.js.
 */

/* ------------------------------------------------------------------ *
 * Pure core                                                           *
 * ------------------------------------------------------------------ */

/**
 * How long after a week's LAST kickoff that week still counts as the current
 * one. Monday night's game is still in play for ~3.5 hours after kickoff, and
 * a rollover during it would move the league on before the week's picks are
 * even graded. The create-time seed in league.router.js uses the same value
 * through resolveNflSeasonPointer, so a new league and the lifecycle job
 * agree by construction.
 */
const WEEK_ROLLOVER_GRACE_HOURS = 6;

const HOUR_MS = 60 * 60 * 1000;

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Pure: which NFL week a pick'em-only league should be sitting on at `now`:
 * the SMALLEST week whose last kickoff plus grace is still in the future.
 * Once every week has closed the answer is REG_SEASON_WEEKS; with no schedule
 * on file it is 1; and it never leaves 1..REG_SEASON_WEEKS.
 *
 * "Smallest still-open week" rather than "highest week that has kicked off":
 * on the Tuesday between two weeks the latter reports the finished,
 * unpickable week, this one reports the week managers can pick. A week with
 * no bounds row (Tank01 drops TBD week-18 games) is simply not open, so the
 * fallback still lands on 18 once week 17 closes.
 *
 * Depends only on nfl_games.kickoff_at (see the live_game_states warning at
 * the top of pickem.service.js).
 *
 * @param {Array} weekBounds `[{ week, lastKickoffAt }]` from getSeasonWeekBounds
 * @param {Date}  now
 * @param {object} [options]
 * @param {number} [options.graceHours=WEEK_ROLLOVER_GRACE_HOURS]
 */
function deriveNflWeek(weekBounds, now, { graceHours = WEEK_ROLLOVER_GRACE_HOURS } = {}) {
  const { seen, open } = openWeeks(weekBounds, now, graceHours);
  if (open.length > 0) return Math.min(...open);
  return seen ? REG_SEASON_WEEKS : 1;
}

/**
 * Pure: has every week of the season closed (bounds non-empty, no week still
 * open under the grace)? deriveNflWeek answers 18 both for "week 18 is being
 * played" and "everything is over"; this is the second case on its own.
 */
function seasonHasClosed(weekBounds, now, { graceHours = WEEK_ROLLOVER_GRACE_HOURS } = {}) {
  const { seen, open } = openWeeks(weekBounds, now, graceHours);
  return seen && open.length === 0;
}

/**
 * Internal: the regular-season weeks (1..REG_SEASON_WEEKS, valid kickoff)
 * whose last kickoff plus grace is still ahead of `now`, and whether any
 * valid week was seen at all.
 */
function openWeeks(weekBounds, now, graceHours) {
  const at = toDate(now) || new Date();
  const graceMs = Number(graceHours) * HOUR_MS;
  const open = [];
  let seen = false;
  for (const bound of weekBounds || []) {
    const week = Number(bound && bound.week);
    if (!Number.isInteger(week) || week < 1 || week > REG_SEASON_WEEKS) continue;
    const last = toDate(bound.lastKickoffAt);
    if (!last) continue;
    seen = true;
    if (last.getTime() + graceMs > at.getTime()) open.push(week);
  }
  return { seen, open };
}

/**
 * How far from the MIDDLE of an NFL week one of its games can kick off and
 * still be that week's game. A real week runs Thursday night to Monday night
 * (four days), and even the COVID Tuesday/Wednesday games stayed inside a
 * week of the rest. A kickoff further out than this has been rescheduled
 * OUT of its week while keeping its original week label (Tank01's upsert
 * keys on that label; the 2020 TEN@PIT week 4 -> week 7 shape).
 */
const WEEK_SPAN_DAYS = 7;

/**
 * Pure: collapse per-game kickoffs into one `{ week, lastKickoffAt }` per
 * week, ascending by week. A kickoff more than WEEK_SPAN_DAYS after the
 * week's MEDIAN kickoff is a game moved out of the week: it stays on that
 * week's slate for picking (getWeekSlate keys on the label), but it does
 * not hold the week open, or current_week would sit on a finished week for
 * as long as the moved game is pending. The median, not the first kickoff,
 * is the anchor so that one early outlier (a game moved the other way, or a
 * bad kickoff_at row) cannot make every real game look moved.
 *
 * @param {Array} rows `[{ week, kickoff_at }]`, one per game or per team-week
 * @returns {Array} `[{ week, lastKickoffAt: Date }]`
 */
function weekBoundsFromKickoffs(rows) {
  const byWeek = new Map();
  for (const row of rows || []) {
    const week = Number(row && row.week);
    const kickoff = toDate(row && row.kickoff_at);
    if (!Number.isInteger(week) || !kickoff) continue;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(kickoff.getTime());
  }
  const bounds = [];
  for (const [week, kickoffs] of byWeek) {
    kickoffs.sort((a, b) => a - b);
    const median = kickoffs[Math.floor(kickoffs.length / 2)];
    const cutoff = median + WEEK_SPAN_DAYS * 24 * HOUR_MS;
    const last = Math.max(...kickoffs.filter((at) => at <= cutoff));
    bounds.push({ week, lastKickoffAt: new Date(last) });
  }
  bounds.sort((a, b) => a.week - b.week);
  return bounds;
}

/**
 * How long after week 18's last kickoff an unresolved game stops holding the
 * season open. Every game normally resolves within hours (live engine, then
 * the recap tier), so this only ever fires for a game nothing marked final;
 * without it one such game would wedge the league out of a champion forever.
 */
const FINALIZATION_GRACE_HOURS = 24;

/**
 * Pure: has the pick'em regular season finished? True when the week-18 slate
 * is non-empty AND either every game resolves via winnerOf (a tie resolves,
 * it just credits nobody) or `now` is past the last week-18 kickoff plus
 * FINALIZATION_GRACE_HOURS. An empty slate is never complete: a freshly
 * rolled-over season has no schedule yet and must not complete on the spot.
 *
 * The time fallback exists so ONE never-finalized game cannot wedge the
 * league out of a champion. It needs at least one week-18 game resolved as
 * evidence the week was graded at all: with zero resolved the finalization
 * pipeline never ran, and completing then would crown a permanent champion
 * from weeks 1-17.
 *
 * @param {object} input
 * @param {Array}  input.week18Games the season slate filtered to week 18
 * @param {Date}   input.now
 * @param {number} [input.graceHours=FINALIZATION_GRACE_HOURS]
 */
function pickemSeasonComplete({ week18Games, now, graceHours = FINALIZATION_GRACE_HOURS }) {
  const games = week18Games || [];
  if (games.length === 0) return false;
  const resolved = games.filter((game) => winnerOf(game).final).length;
  if (resolved === games.length) return true;
  if (resolved === 0) return false;
  const at = toDate(now) || new Date();
  let lastKickoff = null;
  for (const game of games) {
    const kickoff = toDate(game && game.kickoffAt);
    if (kickoff && (lastKickoff === null || kickoff.getTime() > lastKickoff)) {
      lastKickoff = kickoff.getTime();
    }
  }
  if (lastKickoff === null) return false;
  return at.getTime() > lastKickoff + Number(graceHours) * HOUR_MS;
}

/**
 * Pure: every standings row tied with the leader on (points, correct), or
 * nobody when the leader has no points and no correct picks. Ties are
 * co-champions by product decision; the username sort inside
 * computePickemStandings is a display order, never a tie-break for the
 * title. The nobody case matters because computePickemStandings lists every
 * member, zero-filled, and completion only needs one pick to exist this
 * season: without it one losing pick would crown the whole league.
 *
 * @param {Array} standings computePickemStandings rows, leader first
 */
function pickemChampions(standings) {
  const rows = standings || [];
  if (rows.length === 0) return [];
  const leader = rows[0];
  if (!(Number(leader.points) > 0) && !(Number(leader.correct) > 0)) return [];
  return rows.filter(
    (row) => Number(row.points) === Number(leader.points) && Number(row.correct) === Number(leader.correct)
  );
}

/**
 * Pure: "The pick'em season is over. ..." for the league-wide notification.
 * Names at most three winners: team names run to 120 characters, a pick'em
 * league holds up to 50 managers, and notifications.message is varchar(500).
 */
const MAX_NAMED_CHAMPIONS = 3;
function seasonOverMessage(champions) {
  const winners = champions || [];
  if (winners.length === 0) return "The pick'em season is over.";
  const names = winners.map((row) => row.teamName || row.username || `Manager ${row.userId}`);
  const points = Number(winners[0].points) || 0;
  const tally = `${points} ${points === 1 ? 'point' : 'points'}`;
  if (names.length === 1) return `The pick'em season is over. ${names[0]} wins with ${tally}.`;
  if (names.length > MAX_NAMED_CHAMPIONS) {
    return `The pick'em season is over. ${names.length} managers share the title with ${tally}.`;
  }
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `The pick'em season is over. ${list} share the title with ${tally}.`;
}

/* ------------------------------------------------------------------ *
 * I/O                                                                 *
 * ------------------------------------------------------------------ */

// Same row filter as pickem.service's SLATE_GAMES_SQL: a bye row (null
// opponent) or a game with no kickoff yet is not a game the week can key on.
const SEASON_KICKOFFS_SQL = `
  SELECT DISTINCT "week", "kickoff_at"
    FROM "nfl_games"
   WHERE "season" = $1
     AND "week" BETWEEN 1 AND $2
     AND "opponent" IS NOT NULL AND "kickoff_at" IS NOT NULL`;

const PICKEM_ONLY_LEAGUES_SQL = `
  SELECT "id", "current_season", "current_week", "created_at"
    FROM "leagues"
   WHERE "pickem_only" = true AND "season_status" <> 'complete'
   ORDER BY "id"`;

/** Has anyone in the league saved a pick this season? Pool or client. */
async function hasPicksThisSeason(db, leagueId, season) {
  const result = await db.query(
    `SELECT 1 FROM "pickem_picks" WHERE "league_id" = $1 AND "season" = $2 LIMIT 1`,
    [leagueId, season]
  );
  return Boolean(result.rows[0]);
}

/**
 * One season's `[{ week, lastKickoffAt }]` for deriveNflWeek. Accepts a pool
 * or a checked-out client.
 */
async function getSeasonWeekBounds({ season, db = pool }) {
  const result = await db.query(SEASON_KICKOFFS_SQL, [season, REG_SEASON_WEEKS]);
  return weekBoundsFromKickoffs(result.rows);
}

/**
 * Where a NEW pick'em-only league starts: the newest season on file and the
 * week deriveNflWeek reports for it, or null when the schedule table is
 * empty (the caller keeps the column defaults). This is the create-time seed
 * in league.router.js, and it shares getSeasonWeekBounds + deriveNflWeek
 * with syncPickemOnlyWeeks so a league's week cannot jump at its first tick.
 *
 * Accepted residue: between the end of week 18 and the next season's schedule
 * sync this points at the finished season at week 18, since the data holds no
 * better answer; completePickemSeasons' zombie guard keeps such a league from
 * completing on the spot, and once the next schedule loads
 * syncPickemOnlyWeeks moves it there (moveLeagueToNewestSeason).
 */
async function resolveNflSeasonPointer({ db = pool, now = new Date() } = {}) {
  const newest = await db.query(
    `SELECT MAX("season")::int AS "season"
       FROM "nfl_games"
      WHERE "opponent" IS NOT NULL AND "kickoff_at" IS NOT NULL
        AND "week" BETWEEN 1 AND $1`,
    [REG_SEASON_WEEKS]
  );
  const season = newest.rows[0] && newest.rows[0].season;
  if (season == null) return null;
  const bounds = await getSeasonWeekBounds({ season: Number(season), db });
  return { season: Number(season), week: deriveNflWeek(bounds, now) };
}

/**
 * A pick'em-only league with NO picks in a season that has entirely closed
 * has nothing to complete (the zombie guard in completePickemSeasons is what
 * keeps it from crowning anyone) and no way to roll over: it was created
 * into a finished season, or abandoned. Once a newer season is on file it
 * follows the calendar there, so it is never wedged on a dead season.
 * Returns the change record, or null when the league stays put.
 */
async function moveLeagueToNewestSeason({ league, from, pointer, db }) {
  if (await hasPicksThisSeason(db, league.id, Number(league.current_season))) return null;
  const moved = await db.query(
    `UPDATE "leagues" SET "current_season" = $1, "current_week" = $2, "updated_at" = now()
      WHERE "id" = $3 AND "pickem_only" = true AND "season_status" <> 'complete'
        AND "current_season" = $4 AND "current_week" = $5
      RETURNING "id"`,
    [pointer.season, pointer.week, league.id, Number(league.current_season), from]
  );
  if (!moved.rows[0]) return null;
  return {
    leagueId: league.id,
    from,
    to: pointer.week,
    fromSeason: Number(league.current_season),
    toSeason: pointer.season,
  };
}

/**
 * Scheduler job: point every pick'em-only league that is still in season at
 * the NFL week it should be on. Bounds are fetched once per distinct season,
 * the UPDATE names the week and season it expects to replace (so a
 * concurrent writer is never clobbered) and only rows whose derived week
 * differs are touched. One league's failure is logged and does not stop the
 * others.
 *
 * @returns {Array} `[{ leagueId, from, to }]` for logging and tests; a
 *   league moved to a newer season also carries `fromSeason`/`toSeason`
 */
async function syncPickemOnlyWeeks({ now = new Date(), db = pool } = {}) {
  const leagues = await db.query(PICKEM_ONLY_LEAGUES_SQL);
  const boundsBySeason = new Map();
  let newestPointer; // resolved lazily, only once some league's season has closed
  const changes = [];
  for (const league of leagues.rows) {
    try {
      const season = Number(league.current_season);
      if (!boundsBySeason.has(season)) {
        boundsBySeason.set(season, await getSeasonWeekBounds({ season, db }));
      }
      const bounds = boundsBySeason.get(season);
      const from = Number(league.current_week);
      if (seasonHasClosed(bounds, now)) {
        if (newestPointer === undefined) newestPointer = await resolveNflSeasonPointer({ db, now });
        if (newestPointer && newestPointer.season > season) {
          const moved = await moveLeagueToNewestSeason({ league, from, pointer: newestPointer, db });
          if (moved) changes.push(moved);
          continue;
        }
      }
      const to = deriveNflWeek(bounds, now);
      if (to === from) continue;
      const updated = await db.query(
        `UPDATE "leagues" SET "current_week" = $1, "updated_at" = now()
          WHERE "id" = $2 AND "pickem_only" = true AND "season_status" <> 'complete'
            AND "current_week" = $3 AND "current_season" = $4
          RETURNING "id"`,
        [to, league.id, from, season]
      );
      if (updated.rows[0]) changes.push({ leagueId: league.id, from, to });
    } catch (error) {
      console.error("pick'em week sync failed for league %s:", league.id, error.message);
    }
  }
  return changes;
}

/**
 * Complete ONE league's pick'em season in a single transaction: re-check the
 * row under lock, compute the final standings, flip season_status, award the
 * champion trophy/trophies and tell the league. Returns null when the league
 * turns out not to be completable after all (already complete, or the zombie
 * guard: no picks were ever made this season).
 */
async function completeOnePickemSeason({ league, season, seasonGames }) {
  const client = await pool.connect();
  let outcome = null;
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT "id", "current_season", "season_status" FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
      [league.id]
    );
    const row = locked.rows[0];
    if (!row || row.season_status === 'complete' || Number(row.current_season) !== season) {
      await client.query('ROLLBACK');
      return null;
    }
    if (!(await hasPicksThisSeason(client, league.id, season))) {
      // Zombie guard: a league nobody ever picked in (created into a finished
      // season, or simply abandoned) never completes and never crowns anyone.
      await client.query('ROLLBACK');
      return null;
    }
    const { standings, mode } = await getStandings({
      leagueId: league.id, season, db: client, games: seasonGames,
    });
    const champions = pickemChampions(standings);
    await client.query(
      `UPDATE "leagues" SET "season_status" = 'complete', "updated_at" = now() WHERE "id" = $1`,
      [league.id]
    );
    const awarded = await awardPickemChampions({
      client, leagueId: league.id, season, champions, mode,
    });
    await notifyLeague(client, {
      leagueId: league.id,
      type: 'season',
      message: seasonOverMessage(champions),
      data: {
        season,
        champions: champions.map((row) => ({ userId: row.userId, points: row.points, correct: row.correct })),
      },
    });
    await client.query('COMMIT');
    outcome = {
      leagueId: league.id,
      season,
      champions: champions.map((row) => ({
        userId: row.userId,
        teamName: row.teamName,
        username: row.username,
        points: row.points,
        correct: row.correct,
      })),
      awarded,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // Post-commit, best-effort: a notify failure must never roll back the
  // completed season or its trophies, nor report the completion as failed.
  try {
    await notifyAwardedOwners({ leagueId: league.id, awarded: outcome.awarded });
  } catch (error) {
    console.error("pick'em champion notification failed for league %s:", league.id, error.message);
  }
  return outcome;
}

/**
 * Scheduler job: complete every pick'em-only league whose regular season has
 * finished (pickemSeasonComplete on the week-18 slate). This runs every
 * tick all season, so the cheap week-bounds query gates it: nothing can
 * complete before week 18's last kickoff has passed, and only then is the
 * whole season's games (three full-season queries) pulled, once per distinct
 * season. Each league completes in its own transaction and one league's
 * failure is logged and does not stop the others.
 *
 * A season with NO week-18 rows (Tank01 drops TBD-time games; the per-season
 * nflverse schedule re-sync fills them) is held, not completed: completing
 * on week 17 would crown a champion before week 18 is played. Leagues in it
 * complete on the tick after the rows arrive. Likewise a season whose
 * fallback window has passed with no week-18 game resolved is held (see
 * pickemSeasonComplete); both are logged every tick so REPEATED lines are
 * the operator's cue.
 *
 * Zombie guard, part one: a league created after week 18's last kickoff was
 * seeded into a finished season and is skipped here without a transaction
 * (part two, "no picks this season", is checked under the row lock).
 *
 * @returns {Array} `[{ leagueId, season, champions, awarded }]`
 */
async function completePickemSeasons({ now = new Date() } = {}) {
  const leagues = await pool.query(PICKEM_ONLY_LEAGUES_SQL);
  const at = toDate(now) || new Date();
  const seasons = new Map(); // season -> { week18LastKickoff, seasonGames } once the gate passes
  const completed = [];
  for (const league of leagues.rows) {
    const season = Number(league.current_season);
    try {
      if (!seasons.has(season)) {
        const bounds = await getSeasonWeekBounds({ season });
        const week18 = bounds.find((bound) => bound.week === REG_SEASON_WEEKS);
        const week18LastKickoff = week18 ? week18.lastKickoffAt.getTime() : null;
        if (week18LastKickoff === null && seasonHasClosed(bounds, at)) {
          console.warn(
            "pick'em season %s is held: every scheduled week has closed but week 18 has no games on file",
            season
          );
        }
        const gateOpen = week18LastKickoff !== null && week18LastKickoff <= at.getTime();
        seasons.set(season, {
          week18LastKickoff,
          seasonGames: gateOpen ? await getSeasonSlate({ season }) : null,
        });
      }
      const { week18LastKickoff, seasonGames } = seasons.get(season);
      if (!seasonGames) continue;
      const week18Games = seasonGames.filter((game) => Number(game.week) === REG_SEASON_WEEKS);
      if (!pickemSeasonComplete({ week18Games, now: at })) {
        const pastFallback = at.getTime() > week18LastKickoff + FINALIZATION_GRACE_HOURS * HOUR_MS;
        if (pastFallback && !week18Games.some((game) => winnerOf(game).final)) {
          console.warn(
            "pick'em season %s is held: week 18 finished over %sh ago and no game has resolved",
            season, FINALIZATION_GRACE_HOURS
          );
        }
        continue;
      }
      const createdAt = toDate(league.created_at);
      if (createdAt && createdAt.getTime() > week18LastKickoff) continue;
      const outcome = await completeOnePickemSeason({ league, season, seasonGames });
      if (outcome) completed.push(outcome);
    } catch (error) {
      console.error("pick'em season completion failed for league %s:", league.id, error.message);
    }
  }
  return completed;
}

module.exports = {
  REG_SEASON_WEEKS,
  WEEK_ROLLOVER_GRACE_HOURS,
  WEEK_SPAN_DAYS,
  FINALIZATION_GRACE_HOURS,
  // pure
  deriveNflWeek,
  weekBoundsFromKickoffs,
  pickemSeasonComplete,
  pickemChampions,
  seasonHasClosed,
  seasonOverMessage,
  // I/O
  getSeasonWeekBounds,
  resolveNflSeasonPointer,
  syncPickemOnlyWeeks,
  completePickemSeasons,
};
