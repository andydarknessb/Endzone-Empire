/**
 * Matchup scoring: generate a league week's round-robin pairings and score
 * every matchup for a week. Split out of scoring.service.js (#1504, spec
 * #1492) as one of the six modules the old scoring module now re-exports
 * whole.
 */
const pool = require('../modules/pool');
const clock = require('../modules/clock');
const { withTransaction } = require('../modules/withTransaction');
const { materializeLineup, rowsHeldAsPlayed } = require('./lineup.service');
const { getDraftRoomBroadcast } = require('../modules/draftRoomBroadcast');
const { seasonOperationsAvailable, SEASON_BEFORE_DRAFT_MESSAGE } = require('./leaguePhase');
const { countedRoster } = require('./countedRoster.service');
const { rulesForLeague, calculateFantasyPoints } = require('./scoringRules');

/**
 * Generate round-robin head-to-head pairings for a league week (idempotent —
 * skips if matchups already exist). Odd team counts give one team a bye.
 */
async function generateMatchups({ leagueId, season, week }) {
  // withTransaction owns connect, BEGIN, COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). The two early-out paths return a value: inside the
  // wrapper that COMMITs a read-only transaction, which is harmless and releases
  // the same locks a ROLLBACK would (#1060 Ruling 3, superseding #1055 Ruling 3
  // for this site). The 409 refusal throws, and the wrapper rolls it back.
  return withTransaction(
    pool,
    async (client) => {
      // #194: this is the third path that inserts matchups, so it carries the
      // same phase refusal as season operations' own two entry points. Read
      // through this transaction's client for the same reason they do.
      const leagueResult = await client.query(
        `SELECT "pickem_only", "draft_status", "season_status" FROM "leagues" WHERE "id" = $1`,
        [leagueId]
      );
      if (!seasonOperationsAvailable(leagueResult.rows[0])) {
        // Thrown so withTransaction rolls the (read-only) transaction back and
        // rethrows this 409 untouched.
        const err = new Error(SEASON_BEFORE_DRAFT_MESSAGE);
        err.statusCode = 409;
        throw err;
      }
      const existing = await client.query(
        `SELECT 1 FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 LIMIT 1`,
        [leagueId, season, week]
      );
      if (existing.rows[0]) {
        return { created: 0, reason: 'matchups already exist for this week' };
      }
      const teamsResult = await client.query(
        `SELECT "id" FROM "teams" WHERE "league_id" = $1 ORDER BY "id"`,
        [leagueId]
      );
      const ids = teamsResult.rows.map((r) => r.id);
      if (ids.length < 2) {
        return { created: 0, reason: 'need at least 2 teams' };
      }
      // Circle-method round robin, rotated by week for variety
      const rotation = week % Math.max(1, ids.length - 1);
      const fixed = ids[0];
      const rest = ids.slice(1);
      const rotated = rest.slice(rotation).concat(rest.slice(0, rotation));
      const order = [fixed, ...rotated];
      let created = 0;
      for (let i = 0; i < Math.floor(order.length / 2); i++) {
        const home = order[i];
        const away = order[order.length - 1 - i];
        await client.query(
          `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id")
           VALUES ($1, $2, $3, $4, $5)`,
          [leagueId, season, week, home, away]
        );
        created += 1;
      }
      return { created };
    },
    { label: 'matchups' }
  );
}

/**
 * Score every matchup for a league week: each team's score is the sum of its
 * STARTERS' fantasy points for that week (bench and IR don't count), computed
 * from raw stats under the LEAGUE'S scoring rules. Transactional per league.
 *
 * Materializing first - so a team that never touched its lineup still gets a
 * carried-forward or default-bench one - is the LIVE population's behaviour
 * and only its own. Do not read it as a property of this function: the other
 * two populations exist precisely because re-materializing a closed week is
 * what hands a post-game acquisition a row.
 *
 * THREE populations, not two. Which one a call gets is decided by the week's
 * finality and by the `settle` option, never inferred from anything else:
 *
 * - LIVE (an open week, no `settle`): materialize first, then join
 *   team_players, the CURRENT roster - a player dropped mid-week stops
 *   scoring immediately. This is the scheduler's in-flight path, the manual
 *   POST /league/:id/score route, and any re-score of a week still open.
 * - SETTLE (an open week, `settle: true`): the week AS PLAYED. No
 *   materialize and no roster join - the population is the week's existing
 *   lineup_entries rows - minus any row no tenure of this team covered at
 *   its player's kickoff (#228's `playersNotHeldAtKickoff`). Only
 *   advance-week asks for this, to compute the score of record before
 *   finalizing (#190).
 *   Consequence worth knowing: a team with NO rows for the week scores 0
 *   here, where the live path would have materialized a carried-forward
 *   lineup for it first. That is the price of not re-materializing, and
 *   re-materializing is the whole bug - it is what hands a post-game
 *   acquisition a row. In practice the week is already materialized by
 *   then: the scheduler live-scores every league whose week has had a
 *   kickoff in the last 8 hours, and that path does materialize. A week
 *   with no synced schedule and no manager who ever opened his lineup is
 *   the case that reaches 0.
 * - FINAL (`matchups.final`): the SAME population and the SAME exclusion as
 *   SETTLE. A player traded or dropped SINCE then still counts, and the
 *   lineup is never re-materialized against today's roster (#106).
 *
 * SETTLE and FINAL are deliberately one rule, and that is the resolution of
 * #190's second escalation rather than a tidy-up. They were once two: the
 * exclusion applied only while settling, on the argument that "once the week
 * is final nothing new can reach its lineup_entries anyway". True of rows
 * ARRIVING after finality; false of rows already there and excluded at settle
 * time, which is the entire population this exclusion is about. Nothing
 * deletes an excluded row, so it survived into finality, and
 * `correction.service` re-scores final weeks with no `settle` on every
 * correction sweep - so the score of record was right until the first sweep
 * after the advance and wrong afterwards, and the league was ANNOUNCED the
 * movement as a stat correction.
 *
 * What makes one rule sufficient here, where it was not before, is that the
 * exclusion reads a recorded fact rather than the current roster. That
 * argument belongs with the predicate and is made once, on `heldRows` below
 * and on `rowsHeldAsPlayed` in lineup.service, which `heldRows` delegates to.
 *
 * So do not reintroduce a `!isFinal` guard on the exclusion, and do not add a
 * second population that happens to agree with this one. Both have been tried
 * on this ticket and both reverted the score of record.
 *
 * Best-ball leagues ignore the slots owners set: the score is the OPTIMAL
 * legal lineup over that week's players (same three population rules),
 * computed server-side every time - there is no lineup to manage. Their
 * as-played population carries ONE MORE exclusion (#635, ADR 0022): a
 * candidate must also have been held at the week's LAST kickoff. Best ball
 * has no slot occupancy, so without it a player dropped after his Thursday
 * game and the replacement picked up for Sunday were both candidates, and
 * each churn cycle handed `optimalLineup` one more body than a roster seat
 * can field, never one fewer. The live path already scores the current roster, so this makes
 * the score of record agree with what the manager watched on Sunday.
 */
async function scoreMatchups({ leagueId, season, week, plays = [], settle = false }) {
  // withTransaction owns connect, BEGIN, COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). The callback returns exactly what the post-commit
  // work below needs (league, scored, openMatchups), and that work runs AFTER
  // the connection is back in the pool - never inside the transaction (#1060
  // Ruling 5).
  const { league, scored, openMatchups } = await withTransaction(pool, async (client) => {
    const leagueResult = await client.query(
      `SELECT * FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    const league = leagueResult.rows[0];
    const rules = rulesForLeague(league);
    // The counted-roster module owns the summing rule but not the pricer, so
    // scoring.service (which defines the pricer) hands it in. Keeps the module
    // free of a require back into this file.
    const price = (stats) => calculateFantasyPoints(stats, rules);
    const matchupsResult = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 FOR UPDATE`,
      [leagueId, season, week]
    );
    // The week's schedule is one answer shared by every team in this pass, so
    // it is fetched once and memoised here rather than once per team per
    // matchup (#261). Scoped to this call deliberately: the schedule is only
    // stable within one pass, so a longer-lived cache would be correct until
    // the first time a sync-schedule run landed mid-pass.
    const kickoffCache = new Map();
    /**
     * The rows that count when a week is scored AS PLAYED. A lineup row
     * counts only if a tenure of this team covered its player's kickoff
     * (#228): the week's card is the record of what was played, and a player
     * acquired after his game had already been played was not part of it
     * however he came to have a row.
     *
     * ONE exclusion, on BOTH the settle and the final population, which is
     * the point of #228 and the whole of #190's second escalation. The
     * predicate reads `roster_tenures`, a fact that is appended and closed
     * and never rewritten, so it answers the same way at settle time, at
     * finality, and after any later roster move. Every earlier attempt on
     * #190 evaluated a proxy over the CURRENT roster, and each died the same
     * death: cut the excluded pickup a week later, the proxy stops firing and
     * his points come back on the next correction sweep. Asking a tenure
     * cannot go that way - cutting him closes the tenure, it does not erase
     * the one that failed to cover kickoff.
     *
     * A LIVE week is the one population this does NOT govern. It answers a
     * different and correct question by joining the CURRENT roster, so a
     * dropped player stops scoring immediately mid-week.
     *
     * Note what is NOT here: no `nfl_games` join. The kickoff question belongs
     * to the module that owns the schedule and the lineup lock, so #227 has
     * one place to fix rather than one per consumer.
     *
     * Best ball carries a second exclusion on the same two populations
     * (#635, ADR 0022): of the rows the first kept, the ones a tenure of this
     * team still covered at the week's LAST kickoff. Same recorded fact, same
     * append-and-close argument. Never applied to a standard league, whose
     * pool is bounded by slot occupancy.
     *
     * Both live in `rowsHeldAsPlayed`, in lineup.service beside the
     * predicate, because hindsight reads the same settled week (#736) and a
     * second population here would be one more thing to keep agreeing.
     */
    const heldRows = async (rows, teamId, asPlayed) => {
      if (!asPlayed) return rows;
      return rowsHeldAsPlayed(client, { league, teamId, season, week, rows, kickoffCache });
    };

    const teamScore = async (teamId, asPlayed) => {
      if (!asPlayed) {
        await materializeLineup(client, { leagueId, teamId, season, week, league });
      }
      const currentRosterJoin = asPlayed
        ? ''
        : `JOIN "team_players" ON "team_players"."team_id" = "lineup_entries"."team_id"
           AND "team_players"."player_id" = "lineup_entries"."player_id"`;
      if (league.best_ball) {
        // Best ball: every player held through the week counts as a candidate
        // (as played: held at his own kickoff AND at the week's last, #635);
        // IR occupants remain stashed and do not participate in scoring.
        const r = await client.query(
          `SELECT "lineup_entries"."player_id", "lineup_entries"."slot",
                  "players"."position", "players"."nfl_team", "player_stats"."stats"
           FROM "lineup_entries"
           ${currentRosterJoin}
           JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
           LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
             AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
           WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
             AND "lineup_entries"."week" = $3`,
          [teamId, season, week]
        );
        // IR drop, pricing and the optimal-lineup total are the counted-roster
        // module's job now (#954); the row set (every slot, LEFT JOIN) is what
        // this branch owns.
        const rows = await heldRows(r.rows, teamId, asPlayed);
        return countedRoster({ rows, league, price }).teamScore;
      }
      const r = await client.query(
        `SELECT "lineup_entries"."player_id", "players"."nfl_team", "player_stats"."stats"
         FROM "lineup_entries"
         ${currentRosterJoin}
         JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
         LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
           AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2
           AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" NOT IN ('BENCH', 'IR')`,
        [teamId, season, week]
      );
      // Standard: the SQL already dropped BENCH and IR, so every row here is a
      // starter. The started-total sum and the rounding are the counted-roster
      // module's job now (#954).
      const rows = await heldRows(r.rows, teamId, asPlayed);
      return countedRoster({ rows, league, price }).teamScore;
    };
    const scored = [];
    for (const matchup of matchupsResult.rows) {
      // The ONE place the population is chosen. A settled week and a final
      // week are the same population - the week as played - so `settle` and
      // finality select it together rather than through two branches that
      // have to be kept agreeing (#190, #228).
      const asPlayed = settle || matchup.final;
      const homeScore = await teamScore(matchup.home_team_id, asPlayed);
      const awayScore = await teamScore(matchup.away_team_id, asPlayed);
      await client.query(
        `UPDATE "matchups" SET "home_score" = $1, "away_score" = $2 WHERE "id" = $3`,
        [homeScore, awayScore, matchup.id]
      );
      scored.push({
        matchupId: matchup.id,
        homeTeamId: matchup.home_team_id,
        awayTeamId: matchup.away_team_id,
        homeScore,
        awayScore,
      });
    }
    // Computed here, before the wrapper's COMMIT, but purely from the
    // in-memory matchup rows - the same set the old post-COMMIT filter read.
    const openMatchups = matchupsResult.rows.filter((m) => !(settle || m.final));
    return { league, scored, openMatchups };
  }, { label: 'scoring' });

  // Each side's status, expected final and players remaining ride the same
  // emit as the fresh scores, so a card can never show a new score against a
  // stale forecast or phase. The one decorator (expectedFinal.service) maps
  // them onto each `scored` entry, computed once the pass has committed AND
  // its connection is back in the pool (the producer reads on the pool;
  // holding a second connection per pass would let concurrent re-scores
  // starve it), from the stats this pass just wrote, only for matchups still
  // open (a final one's result is its score), and best-effort: a miss leaves
  // the fields null. Required lazily: expectedFinal.service reads this
  // module's rules.
  const { attachScoredExpectedFinals } = require('./expectedFinal.service');
  await attachScoredExpectedFinals(scored, { openMatchups, league, now: clock.now() });
  // Live scoring: push fresh scores to anyone watching this league, through the
  // one Draft room broadcast adapter (#765). In the API it rides `io`; in the
  // worker it rides the Redis emitter to every API instance, so the scheduled
  // tick and the daily correction pass reach the room instead of the null-`io`
  // drop that silenced them since the worker split. The adapter is registered at
  // boot in both processes and getDraftRoomBroadcast() THROWS when it is not:
  // that is post-commit (the scores are already durable), so the throw surfaces
  // a misconfigured process loudly rather than dropping the event silently.
  // `plays` (typed touchdown events) rides the same emit that carries fresh
  // scores. It's populated only on the live sync path — the stat-correction
  // path passes none — so a cutscene can never fire from a correction.
  await getDraftRoomBroadcast().scoresUpdated(leagueId, { leagueId, season, week, scored, plays });
  return { scored };
}

module.exports = {
  generateMatchups,
  scoreMatchups,
};
