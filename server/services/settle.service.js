const { leagueWrite } = require('../modules/leagueWrite');
const seasonSvc = require('./season.service');
const matchupScoring = require('./matchupScoring.service');
const settleFollowUpSvc = require('./settleFollowUp.service');
const correction = require('./correction.service');
const { notifyLeague, logTransaction } = require('./activity.service');
const { notifyCommissioners } = require('./leagueRole.service');
const { seasonOperationsAvailable, SEASON_BEFORE_DRAFT_MESSAGE } = require('./leaguePhase');

/**
 * The Settle module (ADR 0070; CONTEXT.md, Advance week, Stat correction, Score of
 * record). Every Score of record moves through one of the three League writes here,
 * each one leagueWrite: the League row is locked first, the body runs on the held
 * client, and only after the commit does the announcement, the lineup seed and the
 * Settle follow-up run, each contained.
 */

// Advance week's Settle follow-up runs after commit and is never awaited, so it is
// tracked here: API shutdown waits on these before it ends the pool (#2756).
const followUpsInFlight = new Set();

function trackFollowUp(run) {
  followUpsInFlight.add(run);
  const forget = () => followUpsInFlight.delete(run);
  run.then(forget, forget);
  return run;
}

const FOLLOW_UP_DRAIN_MS = 30 * 1000;

/** Resolves once every tracked follow-up settles, or at the limit, whichever is first. */
async function drainFollowUps(timeoutMs = FOLLOW_UP_DRAIN_MS) {
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  await Promise.race([Promise.allSettled([...followUpsInFlight]), limit]);
  clearTimeout(timer);
}

/**
 * Advance week's Settle pass. Returns `{ scored, advance, followUp }`; `followUp` is
 * never awaited here (display data, never worth failing the advance over).
 */
async function settleWeek({ leagueId, expectedWeek }) {
  let followUp;
  const { scored, outcome } = await leagueWrite({ leagueId, label: 'season' }, async ({ client, league, afterCommit }) => {
    if (!league) throw new seasonSvc.SeasonError(404, 'league not found');
    if (!seasonOperationsAvailable(league)) throw new seasonSvc.SeasonError(409, SEASON_BEFORE_DRAFT_MESSAGE);
    if (league.season_status === 'complete') throw new seasonSvc.SeasonError(409, 'season is complete');
    const { current_season: season, current_week: week } = league;
    // The caller scored expectedWeek; a replay arrives after the league has moved on.
    if (expectedWeek != null && Number(expectedWeek) !== Number(week)) {
      throw new seasonSvc.SeasonError(409, `week ${expectedWeek} was already advanced`);
    }

    // Before the matchups are read: the playoff winners below come from these scores.
    const settled = await matchupScoring.scoreMatchupsInTransaction(client, { leagueId, season, week, settle: true });

    const weekMatchups = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
      [leagueId, season, week]
    );
    if (weekMatchups.rows.length === 0) {
      throw new seasonSvc.SeasonError(409, `no matchups exist for week ${week}; generate the schedule first`);
    }
    await client.query(
      `UPDATE "matchups" SET "final" = true WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
      [leagueId, season, week]
    );

    const allMatchups = await client.query(
      `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2`,
      [leagueId, season]
    );
    const teamsResult = await client.query(
      `SELECT "id", "name", "owner_id" FROM "teams" WHERE "league_id" = $1`,
      [leagueId]
    );
    const teams = teamsResult.rows;
    const nextWeek = week + 1;
    let outcome = { advancedTo: nextWeek, seasonStatus: league.season_status };

    // Waiver priority resets to reverse standings every time a week is finalized
    // (the Tuesday morning): same transaction as the matchups' `final` flip.
    await seasonSvc.resetWaiverPriorities(client, {
      leagueId,
      standings: seasonSvc.computeStandings(teams, allMatchups.rows),
    });

    if (league.season_status === 'regular' && week >= league.regular_season_weeks) {
      // Seed the playoff bracket from final standings
      const standings = seasonSvc.computeStandings(teams, allMatchups.rows);
      const brackets = seasonSvc.buildOpeningBrackets({
        standings,
        playoffTeams: league.playoff_teams,
        consolationEnabled: league.playoff_consolation,
      });
      // Seeds are fixed here (#2547): later rounds, the bye check and the
      // standings route read these rows, never the live standings again.
      const seeded = standings.slice(0, Math.min(Number(league.playoff_teams) || 0, standings.length));
      if (seeded.length > 0) {
        await client.query(
          `INSERT INTO "playoff_seeds" ("league_id", "season", "team_id", "seed")
           SELECT $1, $2, "s"."team_id", "s"."seed"
           FROM unnest($3::int[], $4::int[]) AS "s"("team_id", "seed")`,
          [leagueId, season, seeded.map((s) => s.teamId), seeded.map((s) => s.rank)]
        );
      }
      // Consolation seeds, when the field has any, are fixed in the same step (#2744).
      if (brackets.consolationSeeds.length > 0) {
        await client.query(
          `INSERT INTO "consolation_seeds" ("league_id", "season", "team_id", "seed")
           SELECT $1, $2, "s"."team_id", "s"."seed"
           FROM unnest($3::int[], $4::int[]) AS "s"("team_id", "seed")`,
          [
            leagueId,
            season,
            brackets.consolationSeeds.map((s) => s.teamId),
            brackets.consolationSeeds.map((s) => s.seed),
          ]
        );
      }
      for (const game of brackets.playoff.games) {
        await client.query(
          `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id",
                                   "is_playoff", "playoff_round")
           VALUES ($1, $2, $3, $4, $5, true, 1)`,
          [leagueId, season, nextWeek, game.home, game.away]
        );
      }
      if (league.playoff_consolation) {
        for (const game of brackets.consolation.games) {
          await client.query(
            `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id",
                                     "is_playoff", "playoff_round", "is_consolation")
             VALUES ($1, $2, $3, $4, $5, true, 1, true)`,
            [leagueId, season, nextWeek, game.home, game.away]
          );
        }
      }
      await client.query(
        `UPDATE "leagues" SET "season_status" = 'playoffs', "current_week" = $1, "updated_at" = now()
         WHERE "id" = $2`,
        [nextWeek, leagueId]
      );
      await notifyLeague(client, {
        leagueId,
        type: 'season',
        message: 'The regular season is over. Playoffs start this week!',
      });
      outcome = { advancedTo: nextWeek, seasonStatus: 'playoffs', playoffRound: 1 };
    } else if (league.season_status === 'playoffs') {
      const thisRound = weekMatchups.rows.filter((m) => m.is_playoff && !m.is_consolation);
      const roundNumber = thisRound[0] ? thisRound[0].playoff_round : null;
      // Byes: a seeded team that is out of this round and has no earlier playoff game
      // skips round one. Who played is structural; no score decides it (#2742).
      const storedSeeds = await client.query(
        `SELECT "team_id", "seed" FROM "playoff_seeds"
         WHERE "league_id" = $1 AND "season" = $2 ORDER BY "seed"`,
        [leagueId, season]
      );
      // shortcut: a League already in its playoffs before playoff_seeds shipped has
      // no rows and derives seeds from live standings, drop when those seasons end.
      const seedOf = storedSeeds.rows.length > 0
        ? new Map(storedSeeds.rows.map((r) => [r.team_id, r.seed]))
        : new Map(
          seasonSvc.computeStandings(teams, allMatchups.rows)
            .slice(0, league.playoff_teams)
            .map((s, i) => [s.teamId, i + 1])
        );
      const { winners, advancing } = bracketAdvancing({
        games: thisRound, seedOf, matchups: allMatchups.rows, week, consolation: false,
      });

      if (advancing.length <= 1) {
        const champion = teams.find((t) => t.id === winners[0]);
        await client.query(
          `UPDATE "leagues" SET "season_status" = 'complete', "current_week" = $1, "updated_at" = now()
           WHERE "id" = $2`,
          [nextWeek, leagueId]
        );
        await notifyLeague(client, {
          leagueId,
          type: 'season',
          message: `${champion ? champion.name : 'A champion'} has won the league championship!`,
          data: { championTeamId: winners[0] },
        });
        outcome = { advancedTo: nextWeek, seasonStatus: 'complete', championTeamId: winners[0] };
      } else {
        const entrants = advancing.map((teamId) => ({ teamId, seed: seedOf.get(teamId) || 99 }));
        for (const game of seasonSvc.pairBySeed(entrants).games) {
          await client.query(
            `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id",
                                     "is_playoff", "playoff_round")
             VALUES ($1, $2, $3, $4, $5, true, $6)`,
            [leagueId, season, nextWeek, game.home, game.away, (roundNumber || 1) + 1]
          );
        }
        await client.query(
          `UPDATE "leagues" SET "current_week" = $1, "updated_at" = now() WHERE "id" = $2`,
          [nextWeek, leagueId]
        );
        outcome = { advancedTo: nextWeek, seasonStatus: 'playoffs', playoffRound: (roundNumber || 1) + 1 };
      }

      // The Consolation bracket plays its own rounds beside the championship and never
      // decides it. Its field is capped at the championship's rounds (buildOpeningBrackets),
      // so its final is never after the championship final: the season still completes above.
      const consolationGames = league.playoff_consolation
        ? weekMatchups.rows.filter((m) => m.is_consolation)
        : [];
      if (consolationGames.length > 0) {
        const storedConsolation = await client.query(
          `SELECT "team_id", "seed" FROM "consolation_seeds"
           WHERE "league_id" = $1 AND "season" = $2 ORDER BY "seed"`,
          [leagueId, season]
        );
        const consolationSeedOf = new Map(storedConsolation.rows.map((r) => [r.team_id, r.seed]));
        // shortcut: a League already in its playoffs before consolation_seeds shipped has no
        // rows and plays no consolation round past the first, drop when those seasons end.
        const consolation = bracketAdvancing({
          games: consolationGames, seedOf: consolationSeedOf, matchups: allMatchups.rows, week, consolation: true,
        });
        if (consolationSeedOf.size > 0 && consolation.advancing.length > 1) {
          const consolationRound = consolationGames[0].playoff_round + 1;
          const entrants = consolation.advancing.map((teamId) => ({ teamId, seed: consolationSeedOf.get(teamId) }));
          for (const game of seasonSvc.pairBySeed(entrants).games) {
            await client.query(
              `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id",
                                       "is_playoff", "playoff_round", "is_consolation")
               VALUES ($1, $2, $3, $4, $5, true, $6, true)`,
              [leagueId, season, nextWeek, game.home, game.away, consolationRound]
            );
          }
        }
      }
    } else {
      // Plain regular-season week: schedule already exists, just move forward
      await client.query(
        `UPDATE "leagues" SET "current_week" = $1, "updated_at" = now() WHERE "id" = $2`,
        [nextWeek, leagueId]
      );
    }

    // After the commit, each contained: the announcement, then the lineup seed, then
    // the follow-up, started and not awaited (ADR 0054, ticket 2686).
    if (settled) afterCommit(() => matchupScoring.announceScored({ leagueId, season, week, ...settled }));
    afterCommit(() => seasonSvc.materializeNewWeekLineups({ leagueId, season, week: nextWeek, league }));
    afterCommit(() => {
      followUp = trackFollowUp(settleFollowUpSvc.settleFollowUp({
        leagueId,
        season,
        week, // the week just finalized
        mode: 'advance',
        // The one decider of season completion (ADR 0054).
        ...(outcome.seasonStatus === 'complete' && { seasonComplete: true }),
      }).catch((err) => {
        console.error('settle follow-up failed for league %s week %s:', leagueId, week, err.message);
      }));
    });
    return { scored: settled?.scored, outcome };
  });
  return { scored, advance: outcome, followUp };
}

/**
 * A Stat correction: re-score one league week and record any changes. The League is
 * locked first, then the week's Matchups; the re-score, the log entry, the notices
 * and the commissioner alerts commit together. After the commit: the announcement,
 * then the Settle follow-up (mode 'correction') when a final week changed.
 */
async function correctWeek({ leagueId, season, week }) {
  // Read in the catch below: once the transaction has rolled the scores back,
  // the server log is the only trace of what the correction would have done.
  let changes = [];
  let committed;
  try {
    committed = await leagueWrite({ leagueId, label: 'correction' }, async ({ client, afterCommit }) => {
      const before = await client.query(
        `SELECT "id", "week", "final", "is_playoff", "home_score", "away_score"
         FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3
         FOR UPDATE`,
        [leagueId, season, week]
      );
      if (before.rows.length === 0) return false;

      // The re-score runs on THIS transaction, so it commits with the log and
      // notices below or not at all (#2602).
      const scoring = await matchupScoring.scoreMatchupsInTransaction(client, { leagueId, season, week });

      const after = await client.query(
        `SELECT "id", "home_score", "away_score" FROM "matchups"
         WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
        [leagueId, season, week]
      );
      changes = correction.diffMatchupScores(before.rows, after.rows);
      afterCommit(() => matchupScoring.announceScored({ leagueId, season, week, ...scoring }));
      if (changes.some((c) => c.final)) {
        afterCommit(() => settleFollowUpSvc.settleFollowUp({ leagueId, season, week, mode: 'correction' }));
      }
      if (changes.length === 0) return true;

      await logTransaction(client, {
        leagueId,
        type: 'stat_correction',
        detail: { season, week, changes },
      });
      await notifyLeague(client, {
        leagueId,
        type: 'stat_correction',
        message: `Week ${week} scores were updated after an NFL stat correction.`,
        data: { season, week, matchupIds: changes.map((c) => c.matchupId) },
      });

      const playoffFlips = changes.filter((c) => c.final && c.isPlayoff && c.winnerFlipped);
      // A final regular-season result moved. Records can change, but the
      // seeds were fixed at bracket creation (#2547), so mid-playoffs the
      // commissioners are told nothing in the bracket moved.
      const seededChanges = changes.filter((c) => c.final && !c.isPlayoff);
      if (playoffFlips.length > 0 || seededChanges.length > 0) {
        const ownerResult = await client.query(
          `SELECT "owner_id", "season_status" FROM "leagues" WHERE "id" = $1`,
          [leagueId]
        );
        const league = ownerResult.rows[0];
        // Every commissioner, not the creator alone (#188).
        if (league && playoffFlips.length > 0) {
          await notifyCommissioners(client, {
            leagueId,
            ownerId: league.owner_id,
            type: 'stat_correction',
            message:
              `A stat correction flipped the result of ${playoffFlips.length} settled playoff ` +
              `matchup(s) in week ${week}. Later rounds were NOT changed automatically. ` +
              `Review the bracket with your commissioner tools.`,
            data: { season, week, matchupIds: playoffFlips.map((c) => c.matchupId) },
          });
        }
        // Only a bracket with stored seeds is locked; a League already in its
        // playoffs before seeds were stored still derives them from standings.
        const locked = league && league.season_status === 'playoffs' && seededChanges.length > 0 &&
          (await client.query(
            `SELECT 1 FROM "playoff_seeds" WHERE "league_id" = $1 AND "season" = $2 LIMIT 1`,
            [leagueId, season]
          )).rows.length > 0;
        if (locked) {
          await notifyCommissioners(client, {
            leagueId,
            ownerId: league.owner_id,
            type: 'stat_correction',
            message:
              `A stat correction changed ${seededChanges.length} final regular-season ` +
              `matchup(s) in week ${week}. Records may have moved, but the playoff seeds are locked: ` +
              `the bracket, the byes and the seed order did not change.`,
            data: { season, week, matchupIds: seededChanges.map((c) => c.matchupId) },
          });
        }
      }
      return true;
    });
  } catch (error) {
    // Every write rolled back with the failed statement, so no score moved and
    // the next run's "before" read still holds the old scores: the correction
    // is safe to retry. The change set the rollback discarded goes to the log.
    console.error(
      'stat correction: league %s week %s rolled back, nothing committed:',
      leagueId,
      week,
      JSON.stringify(changes)
    );
    throw error;
  }

  if (!committed) return { leagueId, changes: [] };
  return { leagueId, changes };
}

/**
 * The Commissioner's live re-score of one week. A final week's Score of record moves
 * only through a stat correction (CONTEXT.md, Score of record), so the refusal is
 * checked under the League lock, not on an unlocked read.
 */
async function rescoreLive({ leagueId, season, week }) {
  return leagueWrite({ leagueId, label: 'scoring' }, async ({ client, afterCommit }) => {
    const final = await client.query(
      `SELECT 1 FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "final" = true LIMIT 1`,
      [leagueId, season, week]
    );
    if (final.rows[0]) {
      throw new seasonSvc.SeasonError(
        409,
        `Week ${week} is final. Its scores change only through a stat correction or a manual score correction.`
      );
    }
    const scoring = await matchupScoring.scoreMatchupsInTransaction(client, { leagueId, season, week });
    afterCommit(() => matchupScoring.announceScored({ leagueId, season, week, ...scoring }));
    return { scored: scoring.scored };
  });
}

/**
 * One bracket's next round (#2744). `winners` are the settled games' winners;
 * `advancing` adds the byes: a seeded Team out of this round with no earlier game in
 * the same bracket. Who played is structural; no score decides it (#2742).
 */
function bracketAdvancing({ games, seedOf, matchups, week, consolation }) {
  const winners = games.map((m) =>
    Number(m.home_score) >= Number(m.away_score) ? m.home_team_id : m.away_team_id
  );
  const playedIds = new Set(games.flatMap((m) => [m.home_team_id, m.away_team_id]));
  const byeTeams = [...seedOf.keys()]
    .filter((id) => !playedIds.has(id) && !playedEarlierPlayoff(matchups, id, week, consolation));
  return { winners, advancing: [...new Set([...winners, ...byeTeams])] };
}

/**
 * Did this team play a playoff game in the given bracket (`consolation` picks which)
 * before `week`? Reads who played, never the scores: a Stat correction flips a
 * finished round's score but never who reached the next one (CONTEXT.md, Stat
 * correction, Playoff seed).
 */
function playedEarlierPlayoff(matchups, teamId, week, consolation = false) {
  return matchups.some((m) =>
    m.is_playoff && Boolean(m.is_consolation) === consolation && m.week < week &&
    (m.home_team_id === teamId || m.away_team_id === teamId)
  );
}

module.exports = { settleWeek, correctWeek, rescoreLive, trackFollowUp, drainFollowUps, FOLLOW_UP_DRAIN_MS };
