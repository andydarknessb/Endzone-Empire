const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { tenureHandlers, tenure } = require('./helpers/tenureFakes');
const { scoreMatchups } = require('../services/scoring.service');
const { correctLeagueWeek } = require('../services/correction.service');

/**
 * The Score of record counts a week's lineup entries as played and excludes a
 * player no tenure of that team covered at his game's kickoff (#228).
 *
 * WHY THIS IS A TENURE QUESTION AND NOT A ROSTER ONE. Every earlier attempt
 * answered it from mutable present state - `team_players.created_at`, or the
 * presence of a roster row at all - and each failed the same way: a
 * post-kickoff pickup who is LATER CUT loses the row the rule was reading, so
 * the rule stops firing and his points come back on the next correction
 * sweep. `correction.service` re-scores final weeks on every scheduled
 * correction day, so that is not a corner case, it is a clock. The idempotence
 * test below is that exact sequence and it is the reason this ticket exists.
 *
 * THE FIXTURE ANSWERS FROM REAL TIMESTAMPS, and it reads the COMPARISON
 * OPERATORS OUT OF THE EMITTED SQL rather than hard-coding them. That matters
 * more than it looks. A fake that dispatches on SQL text and replies from a
 * canned array reports on which handler matched, not on what the code did:
 * mutate the predicate and a different fake answers, so a red proves routing
 * changed and a green proves nothing at all. Here, flipping `<=` to `<` in the
 * production statement flips what this fixture computes, so the boundary case
 * fails on the SCORE - a semantic failure that means what it says.
 *
 * Every tenure is seeded explicitly. The fakes do not run triggers (ADR 0006),
 * so a tenure exists here only because a test put it there.
 */

const SEASON = 2026;
const WEEK = 8;
const LEAGUE_ID = 5;
const TEAM_A = 10;
const TEAM_B = 20;

// Two kickoffs, so "his game" is a real per-player question rather than one
// instant shared by the whole week.
const THU_KICKOFF = new Date('2026-10-22T00:20:00Z');
const SUN_KICKOFF = new Date('2026-10-25T17:00:00Z');
const BEFORE_THU = new Date('2026-10-20T12:00:00Z');
const BETWEEN = new Date('2026-10-23T12:00:00Z'); // after Thursday, before Sunday
const AFTER_SUN = new Date('2026-10-26T12:00:00Z');

const SUN_TEAM = 'SUNT';
const THU_TEAM = 'THUT';
const BYE_TEAM = 'BYET'; // deliberately absent from the schedule

// Points are rushing yards / 10, so a score reads as a sum of who counted.
const POINTS = new Map([
  [1, 200], [2, 300], [3, 400], [4, 500],
  [5, 600], [6, 700], [7, 800], [9, 100],
]);

const OPPONENT_PLAYER = 9; // team B's only starter, 10.0, never in question
const OPPONENT_POINTS = 10;

/**
 * @param tenures  [{ teamId, playerId, acquiredAt, releasedAt }]
 * @param starters player ids on team A's week-8 card, all in a starting slot
 * @param teams    player id -> nfl_team (defaults to the Sunday team)
 * @param slots    player id -> lineup slot, defaulting to a starting RB. Only
 *                 the best-ball case needs it: a BENCH row is a candidate
 *                 there, where the standard population never sees one.
 * @param bestBall the league's `best_ball`. The two populations select through
 *                 different SQL and apply the SAME exclusion through separate
 *                 code, so a case here does not cover the other branch.
 */
function createWorld({
  tenures = [], starters = [], teams = {}, slots = {}, bestBall = false,
} = {}) {
  const state = {
    // Mutable: the idempotence case closes one of these mid-test, the way a
    // drop's trigger would.
    tenures: [
      /*
       * THE OPPONENT'S TENURE, SEEDED RATHER THAN ASSUMED (#261). This suite
       * passes no `heldSince`, so a (team, player) with no tenure row is held
       * at no kickoff at all - and team B's starter had none. The away side
       * therefore scored 0 in every case here while the comment on
       * OPPONENT_PLAYER called him "never in question", which is the shape the
       * tenure-fakes header warns about: an unasked question answered with an
       * empty set. A zero from an empty population and a zero from correct
       * exclusion are the same zero, so the away side demonstrated nothing and
       * would have stayed silent had the exclusion begun firing on everyone.
       *
       * He is acquired before the week's first kickoff and never released, so
       * he counts under any correct reading of the predicate, and the away
       * score is asserted at its real value in the case table below.
       */
      tenure(TEAM_B, OPPONENT_PLAYER, BEFORE_THU),
      ...tenures.map((t) => ({ ...t })),
    ],
    teamPlayers: [
      ...starters.map((id) => ({ team_id: TEAM_A, player_id: id })),
      { team_id: TEAM_B, player_id: OPPONENT_PLAYER },
    ],
    lineupEntries: [
      ...starters.map((id) => ({ team_id: TEAM_A, player_id: id, week: WEEK, slot: slots[id] || 'RB' })),
      { team_id: TEAM_B, player_id: OPPONENT_PLAYER, week: WEEK, slot: 'RB' },
    ],
    matchups: [{
      id: 90,
      league_id: LEAGUE_ID,
      season: SEASON,
      week: WEEK,
      home_team_id: TEAM_A,
      away_team_id: TEAM_B,
      final: true,
      home_score: 0,
      away_score: 0,
      is_playoff: false,
    }],
    schedule: [
      { nfl_team: SUN_TEAM, kickoff_at: SUN_KICKOFF },
      { nfl_team: THU_TEAM, kickoff_at: THU_KICKOFF },
    ],
    transactions: [],
    notifications: [],
  };

  const nflTeamOf = (playerId) => teams[playerId] || SUN_TEAM;

  const handlers = [
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: LEAGUE_ID,
        current_season: SEASON,
        current_week: WEEK,
        best_ball: bestBall,
        roster_slots: [{ key: 'RB', label: 'RB', count: 8, eligiblePositions: ['RB'] }],
        bench_slots: 5,
        ir_slots: 1,
        scoring_rules: null,
        season_status: 'regular',
        regular_season_weeks: 14,
        playoff_teams: 4,
        owner_id: 101,
      }],
    })],
    [/^SELECT \* FROM "matchups"/, (text, [leagueId, season, week]) => ({
      rows: state.matchups
        .filter((m) => m.league_id === leagueId && m.season === season && m.week === week)
        .map((m) => ({ ...m })),
    })],

    /*
     * The week's schedule and the tenure predicate, from the SHARED helper -
     * the same one the removal and freeze suites use. This suite is the one
     * that exercises the predicate directly, so it seeds every tenure
     * explicitly and passes no `heldSince`: nothing here is held unless a
     * case says so.
     */
    ...tenureHandlers({
      schedule: Object.fromEntries(state.schedule.map((g) => [g.nfl_team, g.kickoff_at])),
      tenures: state.tenures,
    }),

    /*
     * The final population: rows alone, no team_players join.
     *
     * Matched on the TABLE rather than on the column list, deliberately, so
     * that this one handler answers whatever shape the population query
     * currently has. That is what makes a failure here mean something: before
     * the tenure read existed, the population selected only `player_stats`.`stats`
     * and could not name the player at all, so it summed every starter and the
     * post-kickoff pickup counted. This fixture answers that statement and the
     * one that replaced it identically, so the test fails on the SCORE either
     * way rather than on "no handler matched", which would only have told us
     * the SQL changed.
     */
    [/FROM "lineup_entries"/, (text, [teamId, , week]) => {
      /*
       * THE SLOT FILTER IS READ OUT OF THE STATEMENT, for the same reason the
       * tenure handler reads its comparison operators out of one. The two
       * populations disagree about the bench: the standard path excludes it in
       * SQL (`slot NOT IN ('BENCH', 'IR')`), and best ball selects every row
       * and drops only IR in JS, because there every active player is a
       * candidate.
       *
       * A handler that ignored the clause would answer both populations with
       * the bench included, and a bench case would then score the same on
       * either branch - so a best-ball fixture could not tell "bench rows are
       * candidates" from "the fake never filtered". It could only be caught by
       * the SQL-text guard below, which reports WHICH STATEMENT WAS EMITTED
       * rather than what the code decided, and is the weaker evidence of the
       * two (see the tenure-fakes header). Lifting the clause instead keeps
       * the failure behavioural: run the best-ball case on the standard branch
       * and the SCORE moves.
       */
      const excludesBench = /"slot" NOT IN \('BENCH', 'IR'\)/.test(text);
      return {
        rows: state.lineupEntries
          .filter((e) => e.team_id === teamId && e.week === week)
          .filter((e) => !excludesBench || (e.slot !== 'BENCH' && e.slot !== 'IR'))
          .map((e) => ({
            player_id: e.player_id,
            slot: e.slot,
            // Best ball also selects `players`.`position`, to fill slots
            // optimally. Everyone here is an RB, so the optimal lineup is
            // "every candidate that survives the exclusion" and the score
            // reads as a sum of who counted, exactly as on the standard path.
            position: 'RB',
            nfl_team: nflTeamOf(e.player_id),
            stats: { rushingYards: POINTS.get(e.player_id) || 0 },
          })),
      };
    }],
    [/^UPDATE "matchups" SET "home_score"/, (text, [home, away, id]) => {
      const m = state.matchups.find((x) => x.id === id);
      m.home_score = home;
      m.away_score = away;
      return { rows: [] };
    }],

    // correctLeagueWeek's before/after snapshots and its announcement path.
    [/^SELECT "id", "week", "final", "is_playoff"/, (text, [leagueId, season, week]) => ({
      rows: state.matchups
        .filter((m) => m.league_id === leagueId && m.season === season && m.week === week)
        .map(({ id, week: w, final, is_playoff, home_score, away_score }) =>
          ({ id, week: w, final, is_playoff, home_score, away_score })),
    })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, (text, [leagueId, season, week]) => ({
      rows: state.matchups
        .filter((m) => m.league_id === leagueId && m.season === season && m.week === week)
        .map(({ id, home_score, away_score }) => ({ id, home_score, away_score })),
    })],
    [/^INSERT INTO "transactions"/, (text, params) => {
      state.transactions.push(params);
      return { rows: [] };
    }],
    [/^INSERT INTO "notifications"/, (text, params) => {
      state.notifications.push(params);
      return { rows: [] };
    }],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }, { owner_id: 102 }] })],
    [/^SELECT "owner_id" FROM "leagues"/, () => ({ rows: [{ owner_id: 101 }] })],
  ];

  const fake = createFakePool(handlers);
  return { fake, state };
}

/** Team A's settled score after scoring the final week once. */
async function scoreTeamA(fake, t) {
  fake.install(t);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });
  return null;
}

/** A tenure of the team under test, so the cases below read as one line each. */
const held = (playerId, acquiredAt, releasedAt = null) =>
  tenure(TEAM_A, playerId, acquiredAt, releasedAt);

// ---------------------------------------------------------------------------
// The #190 case table, one row per test, answered entirely from tenures.
// ---------------------------------------------------------------------------

const CASES = [
  {
    name: 'held since before kickoff counts',
    tenures: [held(1, BEFORE_THU)],
    starters: [1],
    expected: 20,
  },
  {
    name: 'a fresh post-kickoff pickup is excluded',
    tenures: [held(2, AFTER_SUN)],
    starters: [2],
    expected: 0,
  },
  {
    name: 'held at kickoff, dropped after the game, re-added: counts',
    // Two tenures. The first covers kickoff, which is the whole question.
    tenures: [held(3, BEFORE_THU, AFTER_SUN), held(3, AFTER_SUN)],
    starters: [3],
    expected: 40,
  },
  {
    name: 'dropped BEFORE kickoff and re-added after is excluded',
    tenures: [held(4, BEFORE_THU, BETWEEN), held(4, AFTER_SUN)],
    starters: [4],
    teams: { 4: SUN_TEAM },
    expected: 0,
  },
  {
    name: 'a Thursday player dropped and re-added after his game counts',
    // His game kicked off Thursday; the drop and return both happen after it.
    tenures: [held(5, BEFORE_THU, BETWEEN), held(5, AFTER_SUN)],
    starters: [5],
    teams: { 5: THU_TEAM },
    expected: 60,
  },
  {
    name: 'acquired after kickoff, dropped, re-added is still excluded',
    tenures: [held(6, AFTER_SUN, AFTER_SUN), held(6, AFTER_SUN)],
    starters: [6],
    expected: 0,
  },
  {
    name: 'a player with no game row that week is never excluded (bye or unsynced)',
    // No tenure covers any kickoff because he HAS no kickoff. The absence of
    // a schedule row must not be read as an absence of entitlement.
    tenures: [held(7, AFTER_SUN)],
    starters: [7],
    teams: { 7: BYE_TEAM },
    expected: 80,
  },
];

for (const kase of CASES) {
  test(`#190 case table: ${kase.name}`, async (t) => {
    const { fake, state } = createWorld(kase);
    await scoreTeamA(fake, t);
    assert.equal(state.matchups[0].home_score, kase.expected);
    assert.equal(
      state.matchups[0].away_score,
      OPPONENT_POINTS,
      'the opponent is held all week, so only team A varies across the table'
    );
    fake.assertClean();
  });
}

test('#229: held at kickoff, dropped before ANY lineup row for the week existed, then re-added: counts', async (t) => {
  // The case no timestamp proxy could reach. Under the old rules the week's
  // lineup rows were materialized only AFTER the drop, so every proxy that
  // compared a lineup row's age against a roster row's age concluded he was
  // never here. Tenures do not care when the card was written down.
  const { fake, state } = createWorld({
    tenures: [held(1, BEFORE_THU, BETWEEN), held(1, AFTER_SUN)],
    starters: [1],
    teams: { 1: THU_TEAM },
  });
  await scoreTeamA(fake, t);
  assert.equal(state.matchups[0].home_score, 20, 'his Thursday points are his');
  fake.assertClean();
});

test('the boundary: a tenure that began exactly AT kickoff counts', async (t) => {
  // Pins `acquired_at <= kickoff` rather than `<`. The fixture reads the
  // operator out of the emitted SQL, so flipping it in production flips this
  // score rather than merely re-routing which fake replied.
  const { fake, state } = createWorld({
    tenures: [held(1, SUN_KICKOFF)],
    starters: [1],
  });
  await scoreTeamA(fake, t);
  assert.equal(state.matchups[0].home_score, 20);
  fake.assertClean();
});

test('the boundary: a tenure that ended exactly AT kickoff does NOT count', async (t) => {
  // Pins `released_at > kickoff` rather than `>=`.
  const { fake, state } = createWorld({
    tenures: [held(1, BEFORE_THU, SUN_KICKOFF)],
    starters: [1],
  });
  await scoreTeamA(fake, t);
  assert.equal(state.matchups[0].home_score, 0);
  fake.assertClean();
});

test('the scoring service carries no nfl_games join of its own, so #227 has one place to fix', async (t) => {
  // The exclusion needs a kickoff, and the temptation is to join `nfl_games`
  // straight into the population query. That would give the schedule two
  // readers with two spellings of how a player finds his game, and #227 (DEF
  // units, whose stored team does not match the schedule's) would then have to
  // be fixed in both or silently work in one.
  const { fake } = createWorld({
    tenures: [held(1, BEFORE_THU)],
    starters: [1],
  });
  fake.install(t);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  for (const call of fake.matching(/FROM "lineup_entries"/)) {
    assert.doesNotMatch(call.text, /nfl_games/, 'the population query joins no schedule');
  }
  // And every schedule read that DOES happen is the shared one, byte for
  // byte, rather than a second spelling that happens to agree today.
  const scheduleReads = fake.matching(/FROM "nfl_games"/);
  assert.ok(scheduleReads.length > 0, 'the kickoff question is asked of the schedule at all');
  for (const call of scheduleReads) {
    assert.equal(
      call.text,
      'SELECT "nfl_team", "kickoff_at" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2'
    );
  }
  fake.assertClean();
});

test('the settled score survives the excluded pickup being CUT (idempotence, #190)', async (t) => {
  // The sequence that killed every roster-reading rule, and the reason the
  // fact is recorded rather than inferred:
  //   1. a week is finalized holding a post-kickoff pickup's lineup row;
  //   2. the pickup is dropped - his roster row is GONE, his tenure CLOSED;
  //   3. a scheduled stat correction re-scores the final week.
  // A rule that reads the current roster cannot fire at step 3, because there
  // is nothing left to read. A rule that reads tenures is unmoved.
  const { fake, state } = createWorld({
    tenures: [held(1, BEFORE_THU), held(2, AFTER_SUN)],
    starters: [1, 2],
  });
  fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });
  const settled = state.matchups[0].home_score;
  assert.equal(settled, 20, 'the post-kickoff pickup did not count toward the score of record');

  // Cut him. The roster row goes; the tenure closes but REMAINS.
  state.teamPlayers = state.teamPlayers.filter((tp) => tp.player_id !== 2);
  const tenure = state.tenures.find((x) => x.playerId === 2);
  tenure.releasedAt = AFTER_SUN;

  const outcome = await correctLeagueWeek({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  assert.equal(state.matchups[0].home_score, settled, 're-scoring after the cut returns the same score');
  assert.deepEqual(outcome.changes, [], 'and reports no change, so nothing is announced to the league');
  fake.assertClean();
});

test('#261 the week schedule is read ONCE per scoring pass, not once per team', async (t) => {
  // `scoreMatchups` asked the schedule once per team per matchup, so a
  // 12-team league re-read identical rows twelve times per pass and ~170
  // times per season-long correction sweep. The memo is scoped to the pass
  // because the schedule is only stable within one: a longer-lived cache
  // would go stale the moment a sync-schedule run landed between passes.
  //
  // The count is the point, but it is asserted NEXT TO the scores on
  // purpose. A cache that returned one team's answer to another team's
  // question would also read once, and would be a scoring bug rather than an
  // optimisation - so the two teams here must still get DIFFERENT answers:
  // team A's post-kickoff pickup is excluded, team B's starter is not.
  const { fake, state } = createWorld({
    tenures: [held(1, BEFORE_THU), held(2, AFTER_SUN)],
    starters: [1, 2],
  });
  fake.install(t);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  assert.equal(
    fake.matching(/FROM "nfl_games"/).length,
    1,
    'one schedule read for the whole pass, where there was one per team'
  );
  assert.equal(state.matchups[0].home_score, 20, 'the pickup is still excluded');
  assert.equal(state.matchups[0].away_score, OPPONENT_POINTS, 'and the opponent still counts');
  fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * Best ball: the other population, the same exclusion                 *
 * ------------------------------------------------------------------ */

/**
 * WHY THIS CASE IS HERE AND NOT IN THE SETTLE SUITE, which is not what #261
 * assumed. The ticket says the best-ball final path has no exclusion case at
 * all because every tenure test runs `best_ball: false`. That premise is
 * wrong: `settleScoreOfRecord.test.js` holds thirteen best-ball worlds, and
 * gutting the best-ball filter to `r.rows` fails eight tests there - every
 * one of them a best-ball world, so that branch is not merely covered, it is
 * the only thing that mutation can break.
 *
 * What that same mutation does NOT break is a single test in THIS file: all
 * twelve stay green with the best-ball filter deleted outright. This suite
 * had no best-ball world at all, and that is the real gap.
 *
 * It is a different gap from the settle suite's, because this suite scores a
 * COLD FINAL WEEK. Its matchup is `final: true` from the start and is scored
 * by calling `scoreMatchups` with no `settle`, in a process that never ran an
 * advance. The settle suite's best-ball finals all reach finality through
 * `advanceWeek` in the same process, so they pin the exclusion at the end of
 * a sequence. Here FINALITY ALONE selects the as-played population, which is
 * the path `correction.service` takes on every sweep over an old week.
 */
test('#261 best ball: a post-kickoff pickup is excluded from a COLD final week', async (t) => {
  // Three candidates, and ONE expected score that only one reading produces:
  //
  //   player 1  RB starter, held before kickoff   20.0  counts
  //   player 3  BENCH,      held before kickoff   40.0  counts (best ball has
  //                                                     no bench: every
  //                                                     non-IR row is a
  //                                                     candidate)
  //   player 2  BENCH,      acquired after kickoff 30.0 EXCLUDED
  //
  // 60.0 pins all three claims at once, which is what stops this being
  // another zero that any number of causes could produce:
  //   90.0 would mean the exclusion never ran and the pickup counted;
  //   20.0 would mean bench rows are not candidates, so the pickup's absence
  //        proved nothing about tenure;
  //   60.0 is reachable only if bench rows ARE candidates AND the post-kickoff
  //        one was dropped by the tenure predicate.
  //
  // Both wrong readings are REACHABLE, which is what makes listing them worth
  // anything. Verified by running each: deleting the best-ball held-rows
  // filter scores 90.0, and flipping this world to `bestBall: false` scores
  // 20.0. That second one only became a real check when the population
  // handler above started lifting the bench clause out of the statement -
  // before that it answered both branches with the bench included, 20.0 was
  // unreachable, and this list was describing an intent rather than a fixture.
  const { fake, state } = createWorld({
    bestBall: true,
    starters: [1, 2, 3],
    slots: { 2: 'BENCH', 3: 'BENCH' },
    tenures: [held(1, BEFORE_THU), held(3, BEFORE_THU), held(2, AFTER_SUN)],
  });
  fake.install(t);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  assert.equal(
    state.matchups[0].home_score,
    60,
    'the held starter and the held bench candidate count; the post-kickoff pickup does not'
  );
  assert.equal(state.matchups[0].away_score, OPPONENT_POINTS, 'and the opponent is untouched');

  // The branch guard. Without it this test would keep passing if `best_ball`
  // stopped being read at all, and would then be a second standard-path case
  // wearing a best-ball name - the failure this whole ticket is about.
  const populationReads = fake.matching(/FROM "lineup_entries"/);
  assert.ok(populationReads.length > 0, 'the population was read');
  for (const call of populationReads) {
    assert.match(
      call.text,
      /"players"\."position"/,
      'the BEST-BALL population ran: only it selects position, to fill slots optimally'
    );
  }
  fake.assertClean();
});
