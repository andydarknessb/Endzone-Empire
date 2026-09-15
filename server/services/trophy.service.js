const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
const { lockTwoKeyXact } = require('../modules/advisoryLock');
const { computeStandings } = require('./season.service');
const { notify } = require('./activity.service');
const { LEAGUE_PHASE, deriveLeaguePhase } = require('./leaguePhase');

/**
 * Trophies: automatic awards written after weekly scoring (and, once the
 * season completes, the season-level set). Awarding is idempotent — the
 * trophies table's UNIQUE(league_id, season, week, team_id, type) plus
 * ON CONFLICT DO NOTHING means re-running an advance-week (or a stat
 * correction re-triggering the pipeline) never duplicates an award.
 */

/** Pure: longest consecutive-'W' run in an ordered result list ('W'|'L'|'T'). */
function longestWinStreak(results) {
  let best = 0;
  let run = 0;
  for (const r of results) {
    run = r === 'W' ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Pure: the comeback team — among playoff qualifiers, the one with the worst
 * midpoint record (they climbed from furthest back). Only counts as a
 * comeback if they were actually under .500 at the midpoint; returns null
 * otherwise. standingsAtMidpoint: computeStandings rows; qualifierIds: Set.
 */
function comebackTeam(standingsAtMidpoint, qualifierIds) {
  let worst = null;
  for (const row of standingsAtMidpoint) {
    if (!qualifierIds.has(row.teamId)) continue;
    if (!worst || row.winPct < worst.winPct) worst = row;
  }
  return worst && worst.winPct < 0.5 ? worst : null;
}

/** Insert one trophy; returns true when newly awarded (false = already existed). */
async function award(client, { leagueId, teamId, season, week, type, label, data }) {
  const result = await client.query(
    `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ("league_id", "season", "week", "team_id", "type") DO NOTHING
     RETURNING "id"`,
    [leagueId, teamId, season, week, type, label, JSON.stringify(data || {})]
  );
  return Boolean(result.rows[0]);
}

/** Notify a team's owner about a new trophy. */
async function notifyOwner(client, { leagueId, teamId, label }) {
  const owner = await client.query(`SELECT "owner_id" FROM "teams" WHERE "id" = $1`, [teamId]);
  if (!owner.rows[0]) return;
  await notify(client, {
    userId: owner.rows[0].owner_id,
    leagueId,
    type: 'trophy',
    message: `Trophy earned: ${label}`,
  });
}

/**
 * Award everything due after a week finalizes: the weekly high score, and —
 * once the league's season is complete — the season-level set (champion,
 * longest win streak, biggest comeback, best draft grade).
 */
async function awardWeeklyTrophies({ leagueId, season, week }) {
  const leagueResult = await pool.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId]);
  const league = leagueResult.rows[0];
  if (!league) return [];

  // withTransaction owns connect/BEGIN/COMMIT-or-guarded-ROLLBACK and the
  // release rule (ADR 0033). The league lookup and its early return run on the
  // ambient pool, before the transaction exists. Nothing here throws a refusal
  // and there is no catch-side mapping; the post-commit owner notifications are
  // best-effort and stay after the call, driven by what work returns.
  const awarded = await withTransaction(
    pool,
    async (client) => {
    const awarded = [];

    // Weekly high score
    const weekMatchups = await client.query(
      `SELECT * FROM "matchups"
       WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "final" = true`,
      [leagueId, season, week]
    );
    let high = null;
    for (const m of weekMatchups.rows) {
      for (const side of [
        { teamId: m.home_team_id, points: Number(m.home_score) },
        { teamId: m.away_team_id, points: Number(m.away_score) },
      ]) {
        if (!high || side.points > high.points) high = side;
      }
    }
    if (high) {
      const label = 'Top Scorer';
      if (
        await award(client, {
          leagueId, teamId: high.teamId, season, week,
          type: 'top_scorer', label, data: { points: high.points },
        })
      ) {
        awarded.push({ type: 'top_scorer', teamId: high.teamId, label });
      }
    }

    if (deriveLeaguePhase(league) === LEAGUE_PHASE.COMPLETE) {
      const all = await client.query(
        `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, season]
      );
      const teams = await client.query(
        `SELECT "id", "name" FROM "teams" WHERE "league_id" = $1`,
        [leagueId]
      );
      const matchups = all.rows;

      // Champion — league_history is authoritative (season rollover writes
      // it); fall back to the last decided playoff matchup when the trophy
      // run happens before rollover.
      let championTeamId = null;
      const history = await client.query(
        `SELECT "champion_team_id" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, season]
      );
      if (history.rows[0] && history.rows[0].champion_team_id) {
        championTeamId = history.rows[0].champion_team_id;
      } else {
        const playoffFinals = matchups
          .filter((m) => m.is_playoff && !m.is_consolation && m.final)
          .sort((a, b) => b.week - a.week);
        const last = playoffFinals[0];
        if (last) {
          championTeamId =
            Number(last.home_score) >= Number(last.away_score)
              ? last.home_team_id
              : last.away_team_id;
        }
      }
      if (championTeamId) {
        const label = `${season} League Champion`;
        if (
          await award(client, {
            leagueId, teamId: championTeamId, season, week: 0,
            type: 'champion', label, data: {},
          })
        ) {
          awarded.push({ type: 'champion', teamId: championTeamId, label });
        }
      }

      // Longest win streak across regular-season finals
      const regular = matchups
        .filter((m) => m.final && !m.is_playoff)
        .sort((a, b) => a.week - b.week);
      const resultsByTeam = new Map(teams.rows.map((t) => [t.id, []]));
      for (const m of regular) {
        const hs = Number(m.home_score);
        const as = Number(m.away_score);
        const homeResult = hs > as ? 'W' : hs < as ? 'L' : 'T';
        const awayResult = homeResult === 'W' ? 'L' : homeResult === 'L' ? 'W' : 'T';
        if (resultsByTeam.has(m.home_team_id)) resultsByTeam.get(m.home_team_id).push(homeResult);
        if (resultsByTeam.has(m.away_team_id)) resultsByTeam.get(m.away_team_id).push(awayResult);
      }
      let bestStreak = null;
      for (const [teamId, results] of resultsByTeam) {
        const length = longestWinStreak(results);
        if (length > 1 && (!bestStreak || length > bestStreak.length)) {
          bestStreak = { teamId, length };
        }
      }
      if (bestStreak) {
        const label = `Longest Win Streak (${bestStreak.length})`;
        if (
          await award(client, {
            leagueId, teamId: bestStreak.teamId, season, week: 0,
            type: 'win_streak', label, data: { length: bestStreak.length },
          })
        ) {
          awarded.push({ type: 'win_streak', teamId: bestStreak.teamId, label });
        }
      }

      // Biggest comeback: worst midpoint record among playoff qualifiers
      const midWeek = Math.floor(league.regular_season_weeks / 2);
      const midStandings = computeStandings(
        teams.rows,
        regular.filter((m) => m.week <= midWeek)
      );
      const qualifierIds = new Set(
        matchups
          .filter((m) => m.is_playoff && !m.is_consolation)
          .flatMap((m) => [m.home_team_id, m.away_team_id])
      );
      const comeback = comebackTeam(midStandings, qualifierIds);
      if (comeback) {
        const label = 'Biggest Comeback';
        if (
          await award(client, {
            leagueId, teamId: comeback.teamId, season, week: 0,
            type: 'comeback', label,
            data: { midpointWinPct: comeback.winPct },
          })
        ) {
          awarded.push({ type: 'comeback', teamId: comeback.teamId, label });
        }
      }

      // Best draft grade (only when grades were computed for this season)
      const grades = await client.query(
        `SELECT "data" FROM "league_analytics"
         WHERE "league_id" = $1 AND "season" = $2 AND "type" = 'draft_grades'`,
        [leagueId, season]
      );
      const gradeRows = grades.rows[0] && grades.rows[0].data.grades;
      if (Array.isArray(gradeRows) && gradeRows.length > 0) {
        const top = gradeRows.find((g) => g.rank === 1) || gradeRows[0];
        const label = `Best Draft (${top.grade})`;
        if (
          await award(client, {
            leagueId, teamId: top.teamId, season, week: 0,
            type: 'draft_grade', label, data: { grade: top.grade },
          })
        ) {
          awarded.push({ type: 'draft_grade', teamId: top.teamId, label });
        }
      }
    }

    return awarded;
    },
    { label: 'trophies' }
  );

  await notifyAwardedOwners({ leagueId, awarded });
  return awarded;
}

/**
 * Notifications AFTER the commit, each best-effort: a notify failure must
 * never roll back an award — the awarding passes run once per week or once
 * per season, so a rolled-back trophy would be lost for good.
 */
async function notifyAwardedOwners({ leagueId, awarded }) {
  for (const trophyAwarded of awarded || []) {
    try {
      await notifyOwner(pool, {
        leagueId,
        teamId: trophyAwarded.teamId,
        label: trophyAwarded.label,
      });
    } catch (err) {
      console.error('trophy notification failed (%s):', trophyAwarded.type, err.message);
    }
  }
}

/**
 * Reconcile the weekly high score ('top_scorer') trophy for one week after a
 * stat correction changes that week's scores (#1411). Re-running
 * `awardWeeklyTrophies`'s ON CONFLICT DO NOTHING insert is safe when the
 * leader is unchanged, but wrong two ways once a correction moves things: if
 * the high score moves to a different team, the original recipient would
 * keep a stale trophy AND the new leader would get a second one (the unique
 * key includes team_id, so DO NOTHING never touches the old row); if the
 * leader is unchanged but their total moved, the stored `data.points` goes
 * stale forever, since nothing re-runs this insert once it has one row.
 *
 * Deliberately narrow: never calls `awardWeeklyTrophies` and never touches
 * any season-level trophy. A league whose season completes on the very
 * correction pass that moved this week's leader still gets its season-level
 * set only from the normal advance-week/season-complete path, not from here.
 *
 * Post-reconcile: exactly one team holds `top_scorer` for (league, season,
 * week), and its `data.points` equals the corrected high score.
 *   - the current holder is still (tied for) the week's high score: kept as
 *     is - an exact tie never moves a trophy away from whoever already holds
 *     it (formal-001 f1). Its `data` is UPDATEd in place if its points moved
 *     (merged, not replaced, so an unrelated future field on this award type
 *     survives a reconcile); no notification (not a new award). Any OTHER
 *     row for the week (a stale former leader, or a duplicate from a past
 *     race) is DELETEd.
 *   - no current holder is (tied for) the week's high score: whichever
 *     holder existed is DELETEd and the new leader - the tied team with the
 *     lowest team_id when more than one ties for it, matching the retired
 *     `award_weekly_trophies` SQL engine's `ORDER BY points DESC, team_id ASC`
 *     (2026-07-20-weekly-trophy-engine.sql) - is awarded fresh, through
 *     `award()` so it notifies the same way a first award does (best-effort,
 *     post-commit, via `notifyAwardedOwners`); the previous recipient gets no
 *     notification.
 *   - no prior trophy for the week (an edge case, not the normal path): the
 *     lowest-team_id tied leader is awarded, same as a first award.
 *
 * Hardened past what an insert-only award needs (risk review, #1411,
 * formal-001):
 *   - A team's week score is its single highest matchup-appearance side
 *     value (a team can legally appear twice - the unique key on `matchups`
 *     is only per home_team_id), matching `awardWeeklyTrophies`' own
 *     definition exactly (formal-001 f2) - summing appearances, as an
 *     earlier revision did, double-counts a team that appears twice and can
 *     move or misprice a trophy off a number that was never anyone's score.
 *   - The tie itself never reshuffles an already-correct incumbent
 *     (formal-001 f1): the DELETE only ever removes a row whose own team is
 *     NOT tied for the current high, never a tied incumbent picked against by
 *     an arbitrary tiebreak. `awardWeeklyTrophies` breaks a first-award tie
 *     by unstable scan order (whichever side its unordered loop saw last), so
 *     the incumbent a tie already produced can be either team; reconciling by
 *     team_id ASC regardless of who already holds it would delete a trophy
 *     that is still correctly held any time the incumbent isn't the lower id.
 *   - A blocking advisory lock on the same (league, season*100+week) key the
 *     SQL engine documents serializes this against another concurrent
 *     reconcile for the same week: without it, two reconciles racing the
 *     same DELETE/award pair could interleave. Taken through
 *     `modules/advisoryLock.js`'s `lockTwoKeyXact` rather than a raw query
 *     here - ADR 0036/#1206 (`check:hand-rolled-sync-run`) confines every
 *     `pg_advisory_xact_lock` call to that module and a short, documented
 *     list of sync-job files.
 */
async function reconcileWeeklyHighScoreTrophy({ leagueId, season, week }) {
  const awarded = await withTransaction(
    pool,
    async (client) => {
      await lockTwoKeyXact(client, leagueId, (season * 100) + week);

      const weekMatchups = await client.query(
        `SELECT * FROM "matchups"
         WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "final" = true`,
        [leagueId, season, week]
      );
      // Per team, the single highest side value across its appearances this
      // week - the same definition `awardWeeklyTrophies`' flat running-max
      // scan uses (formal-001 f2), never a sum across appearances.
      const pointsByTeam = new Map();
      for (const m of weekMatchups.rows) {
        for (const side of [
          { teamId: Number(m.home_team_id), points: Number(m.home_score) },
          { teamId: Number(m.away_team_id), points: Number(m.away_score) },
        ]) {
          const prev = pointsByTeam.get(side.teamId);
          if (prev === undefined || side.points > prev) pointsByTeam.set(side.teamId, side.points);
        }
      }
      if (pointsByTeam.size === 0) return [];
      const maxPoints = Math.max(...pointsByTeam.values());

      const label = 'Top Scorer';
      const existing = await client.query(
        `SELECT "id", "team_id", "data" FROM "trophies"
         WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "type" = 'top_scorer'
         ORDER BY "team_id"`,
        [leagueId, season, week]
      );

      // Prefer stability on a tie (formal-001 f1): a current holder whose
      // own score is still (tied for) the week's high stays put, no matter
      // how a fresh tiebreak over every tied team would resolve it -
      // awardWeeklyTrophies' own first-award tiebreak is scan-order, not
      // team_id, so the incumbent a tie produced is not reliably the lowest
      // team_id, and demoting them for one would DELETE a trophy that is
      // still correctly held. (The `ORDER BY "team_id"` above only matters
      // for a residual state this reconcile should never itself produce -
      // more than one row already tied for the week's high - so `find`
      // deterministically keeps the lowest team_id of those rather than
      // whichever the heap happened to return first; risk re-review nit.)
      const incumbent = existing.rows.find((row) => pointsByTeam.get(Number(row.team_id)) === maxPoints);

      const stale = existing.rows.filter((row) => row !== incumbent);
      for (const row of stale) {
        await client.query(`DELETE FROM "trophies" WHERE "id" = $1`, [row.id]);
      }

      if (incumbent) {
        const storedPoints = incumbent.data && incumbent.data.points;
        if (Number(storedPoints) !== maxPoints) {
          await client.query(
            `UPDATE "trophies" SET "data" = "data" || $2::jsonb WHERE "id" = $1`,
            [incumbent.id, JSON.stringify({ points: maxPoints })]
          );
        }
        return [];
      }

      // No existing holder is among this week's tied leaders (a genuine
      // overtake, or no prior trophy at all): award the lowest team_id among
      // them, matching the retired SQL engine's deterministic tiebreak.
      let winnerTeamId = null;
      for (const [teamId, points] of pointsByTeam) {
        if (points === maxPoints && (winnerTeamId === null || teamId < winnerTeamId)) winnerTeamId = teamId;
      }
      if (
        await award(client, {
          leagueId, teamId: winnerTeamId, season, week,
          type: 'top_scorer', label, data: { points: maxPoints },
        })
      ) {
        return [{ type: 'top_scorer', teamId: winnerTeamId, label }];
      }
      return [];
    },
    { label: 'trophy-reconcile' }
  );

  await notifyAwardedOwners({ leagueId, awarded });
  return awarded;
}

/**
 * Pick'em champion(s) for a pick'em-only league, written on the caller's
 * transaction client as the season completes. Deliberately multi-recipient:
 * a tie on (points, correct) makes co-champions, and the trophies unique key
 * includes team_id for exactly this, so there is no singular-champion DELETE
 * here (contrast rolloverSeason's fantasy champion). Idempotent through
 * award()'s ON CONFLICT DO NOTHING. Champion snapshots already carry the
 * historical Team id resolved by the transaction-consistent standings read.
 * Missing Team identity is therefore an invalid declaration rather than a
 * trophy mapping to skip. Owner notifications are the caller's, post-commit
 * (notifyAwardedOwners).
 *
 * @param {object} input
 * @param {object} input.client    transaction client
 * @param {number} input.leagueId
 * @param {number} input.season
 * @param {Array}  input.champions declared snapshots: `[{ teamId, points, correct }]`
 * @param {string} input.mode      the league's pick'em scoring mode
 * @param {number} [input.declaredChampionCount] complete historical winner count when
 *   only currently existing Teams are being projected
 * @returns {Array} `[{ type, teamId, label }]` newly awarded
 */
async function awardPickemChampions({
  client, leagueId, season, champions, mode, declaredChampionCount,
}) {
  const winners = champions || [];
  if (winners.length === 0) return [];
  const championCount = declaredChampionCount ?? winners.length;
  const label = `${season} Pick'em ${championCount > 1 ? 'Co-Champion' : 'Champion'}`;
  const awarded = [];
  for (const winner of winners) {
    const teamId = winner.teamId;
    if (!teamId) throw new Error("Pick'em champion is missing historical Team identity");
    const newlyAwarded = await award(client, {
      leagueId, teamId, season, week: 0,
      type: 'pickem_champion', label,
      data: { points: winner.points, correct: winner.correct, mode },
    });
    if (newlyAwarded) awarded.push({ type: 'pickem_champion', teamId, label });
  }
  return awarded;
}

/**
 * Rebuild the recipient-facing Pick'em champion trophies from an audited
 * result. Historical Team snapshots remain authoritative; a Team that no
 * longer exists simply has no live trophy projection.
 */
async function reconcilePickemChampionTrophies({ client, leagueId, season, champions, mode }) {
  await client.query(
    `DELETE FROM "trophies"
      WHERE "league_id" = $1 AND "season" = $2 AND "week" = 0
        AND "type" = 'pickem_champion'`,
    [leagueId, season]
  );
  const snapshots = champions || [];
  if (snapshots.length === 0) return [];
  const teams = await client.query(
    `SELECT "id" FROM "teams" WHERE "league_id" = $1 AND "id" = ANY($2::int[])`,
    [leagueId, snapshots.map((champion) => champion.teamId)]
  );
  const currentTeamIds = new Set(teams.rows.map((row) => Number(row.id)));
  return awardPickemChampions({
    client,
    leagueId,
    season,
    champions: snapshots.filter((champion) => currentTeamIds.has(Number(champion.teamId))),
    mode,
    declaredChampionCount: snapshots.length,
  });
}

/** All trophies a team has earned, newest first. */
async function getTeamTrophies({ teamId }) {
  const result = await pool.query(
    `SELECT "trophies".*, "teams"."name" AS "team_name"
     FROM "trophies" JOIN "teams" ON "teams"."id" = "trophies"."team_id"
     WHERE "team_id" = $1 ORDER BY "awarded_at" DESC`,
    [teamId]
  );
  return result.rows;
}

/** A league's trophies (optionally one season), newest first. */
async function getLeagueTrophies({ leagueId, season }) {
  const params = [leagueId];
  let where = `"trophies"."league_id" = $1`;
  if (season != null) {
    params.push(season);
    where += ` AND "trophies"."season" = $2`;
  }
  const result = await pool.query(
    `SELECT "trophies".*, "teams"."name" AS "team_name"
     FROM "trophies" JOIN "teams" ON "teams"."id" = "trophies"."team_id"
     WHERE ${where} ORDER BY "awarded_at" DESC`,
    params
  );
  return result.rows;
}

module.exports = {
  longestWinStreak,
  comebackTeam,
  awardWeeklyTrophies,
  reconcileWeeklyHighScoreTrophy,
  awardPickemChampions,
  reconcilePickemChampionTrophies,
  notifyAwardedOwners,
  getTeamTrophies,
  getLeagueTrophies,
};
