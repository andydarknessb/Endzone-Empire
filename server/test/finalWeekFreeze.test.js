const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const {
  materializeLineup,
  benchAcquiredPlayer,
} = require('../services/lineup.service');
const { scoreMatchups } = require('../services/scoring.service');
const { correctLeagueWeek } = require('../services/correction.service');
const { finalizeWeekAndAdvance } = require('../services/season.service');

/**
 * Issue #106: a final week's `lineup_entries` are the record of the week as
 * played, not a working lineup. Rows used to keep arriving in a finished week
 * because `materializeLineup` never looked at `matchups.final`, so the next
 * re-score (a stat correction, or a manual `/score` call) silently paid a
 * team for a player it did not own while the games were played.
 *
 * These are the issue's own reproduction, once per scoring path, because the
 * two paths fail differently:
 * - best ball counts EVERY row for the week regardless of slot, so a
 *   defaulted BENCH row is enough;
 * - standard counts only non-BENCH/IR rows, but `materializeLineup` copies
 *   the slot forward from the team's latest earlier week, so a player who
 *   started for this team back then arrives in the finished week as a
 *   starter.
 *
 * The world below is a small stateful fake: `lineup_entries`, `team_players`
 * and `matchups` are real mutable arrays, so an insert made by
 * `benchAcquiredPlayer` is visible to the re-score that follows it. Without
 * that the "score is unchanged" assertion would pass vacuously; the two
 * `control` tests below flip finality on the SAME fixture and prove the
 * acquired player really does move the score when the week is still live.
 */

const SEASON = 2026;
const LEAGUE_ID = 5;
const TEAM_A = 10;
const TEAM_B = 20;
const QB_A = 1; // Team A's quarterback, 8.0 points in week 8
const QB_B = 3; // Team B's quarterback, 10.0 points in week 8
const ACQUIRED = 4; // "P": 30.0 points in week 8, acquired AFTER the games

const ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
];

const WEEK_8_STATS = new Map([
  [QB_A, { passingYards: 200 }], // 8.0
  [QB_B, { passingYards: 250 }], // 10.0
  [ACQUIRED, { rushingYards: 300 }], // 30.0
]);

/**
 * @param bestBall            league.best_ball
 * @param week8Final          is week 8's matchup final?
 * @param priorWeekEntries    team B's week-7 rows (the copy-forward source)
 * @param matchups            override the schedule entirely (bye / pre-schedule)
 */
function createWorld({
  bestBall = false,
  week8Final = true,
  priorWeekEntries = [],
  matchups,
  currentWeek = 8,
} = {}) {
  const state = {
    league: {
      id: LEAGUE_ID,
      current_season: SEASON,
      current_week: currentWeek,
      best_ball: bestBall,
      roster_slots: ROSTER_SLOTS,
      bench_slots: 5,
      ir_slots: 1,
      scoring_rules: null,
      season_status: 'regular',
      regular_season_weeks: 14,
      playoff_teams: 4,
      playoff_consolation: false,
      owner_id: 101,
    },
    teams: [
      { id: TEAM_A, name: 'Team A', owner_id: 101 },
      { id: TEAM_B, name: 'Team B', owner_id: 102 },
    ],
    positions: new Map([[QB_A, 'QB'], [QB_B, 'QB'], [ACQUIRED, 'RB']]),
    teamPlayers: [
      { team_id: TEAM_A, player_id: QB_A },
      { team_id: TEAM_B, player_id: QB_B },
    ],
    lineupEntries: [
      ...priorWeekEntries,
      { team_id: TEAM_A, player_id: QB_A, season: SEASON, week: 8, slot: 'QB', ir_attested: false },
      { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: 8, slot: 'QB', ir_attested: false },
    ],
    matchups: matchups || [{
      id: 90,
      league_id: LEAGUE_ID,
      season: SEASON,
      week: 8,
      home_team_id: TEAM_A,
      away_team_id: TEAM_B,
      final: week8Final,
      home_score: 0,
      away_score: 0,
      is_playoff: false,
      is_consolation: false,
      playoff_round: null,
    }],
    transactions: [],
    notifications: [],
  };

  const entriesFor = (teamId, season, week) =>
    state.lineupEntries.filter((e) => e.team_id === teamId && e.season === season && e.week === week);
  const rostered = (teamId, playerId) =>
    state.teamPlayers.some((tp) => tp.team_id === teamId && tp.player_id === playerId);

  // A scoring query joins team_players only on a LIVE week; the join's absence
  // from the SQL text is exactly what makes a final week score from rows alone.
  const scoringRows = (text, teamId, week) => {
    const joinsRoster = /"team_players"/.test(text);
    return entriesFor(teamId, SEASON, week)
      .filter((e) => !joinsRoster || rostered(teamId, e.player_id));
  };

  const handlers = [
    // --- the finality probe (must precede the generic matchups matcher) ----
    [/^SELECT 1 FROM "matchups".*"final" = true/, (text, [leagueId, season, week, teamId]) => ({
      rows: state.matchups
        .filter((m) => m.league_id === leagueId && m.season === season && m.week === week
          && m.final && (m.home_team_id === teamId || m.away_team_id === teamId))
        .slice(0, 1)
        .map(() => ({ frozen: 1 })),
    })],

    // --- materializeLineup -------------------------------------------------
    [/^SELECT "team_players"\."player_id"/, (text, [teamId]) => ({
      rows: state.teamPlayers
        .filter((tp) => tp.team_id === teamId)
        .map((tp) => ({ player_id: tp.player_id, position: state.positions.get(tp.player_id) })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, (text, [teamId, season, week]) => ({
      rows: entriesFor(teamId, season, week).map((e) => ({ player_id: e.player_id })),
    })],
    [/^SELECT "player_id", "slot", "ir_attested" FROM "lineup_entries"/, (text, [teamId, season, week]) => {
      const earlier = state.lineupEntries
        .filter((e) => e.team_id === teamId && e.season === season && e.week < week);
      if (earlier.length === 0) return { rows: [] };
      const maxWeek = Math.max(...earlier.map((e) => e.week));
      return {
        rows: earlier
          .filter((e) => e.week === maxWeek)
          .map(({ player_id, slot, ir_attested }) => ({ player_id, slot, ir_attested })),
      };
    }],
    [/^INSERT INTO "lineup_entries"/, (text, [, teamId, playerId, season, week, slot, irAttested]) => {
      const clash = entriesFor(teamId, season, week).some((e) => e.player_id === playerId);
      if (!clash) {
        state.lineupEntries.push({
          team_id: teamId, player_id: playerId, season, week, slot, ir_attested: irAttested,
        });
      }
      return { rows: [] };
    }],
    [/^UPDATE "lineup_entries"/, (text, [teamId, playerId, season, fromWeek, toSlot, matchSlot]) => {
      for (const entry of state.lineupEntries) {
        if (entry.team_id === teamId && entry.player_id === playerId
            && entry.season === season && entry.week >= fromWeek && entry.slot === matchSlot) {
          entry.slot = toSlot;
          entry.ir_attested = false;
        }
      }
      return { rows: [] };
    }],

    // --- scoreMatchups -----------------------------------------------------
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ ...state.league }] })],
    [/^SELECT \* FROM "matchups"/, (text, params) => {
      const [leagueId, season, week] = params;
      return {
        rows: state.matchups
          .filter((m) => m.league_id === leagueId && m.season === season
            && (week === undefined || m.week === week))
          .map((m) => ({ ...m })),
      };
    }],
    [/^SELECT "lineup_entries"\."player_id", "lineup_entries"\."slot"/, (text, [teamId, season, week]) => ({
      rows: scoringRows(text, teamId, week).map((e) => ({
        player_id: e.player_id,
        slot: e.slot,
        position: state.positions.get(e.player_id),
        stats: week === 8 ? WEEK_8_STATS.get(e.player_id) || null : null,
      })),
    })],
    [/^SELECT "player_stats"\."stats"/, (text, [teamId, season, week]) => ({
      rows: scoringRows(text, teamId, week)
        .filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR')
        .map((e) => (week === 8 ? WEEK_8_STATS.get(e.player_id) : null))
        .filter(Boolean) // an inner JOIN on player_stats drops a statless row
        .map((stats) => ({ stats })),
    })],
    [/^UPDATE "matchups" SET "home_score"/, (text, [homeScore, awayScore, id]) => {
      const matchup = state.matchups.find((m) => m.id === id);
      matchup.home_score = homeScore;
      matchup.away_score = awayScore;
      return { rows: [] };
    }],

    // --- correctLeagueWeek -------------------------------------------------
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
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({
      rows: state.teams.map((t) => ({ owner_id: t.owner_id })),
    })],
    [/^SELECT "owner_id" FROM "leagues"/, () => ({ rows: [{ owner_id: state.league.owner_id }] })],

    // --- finalizeWeekAndAdvance -------------------------------------------
    [/^SELECT "id", "name", "owner_id" FROM "teams"/, () => ({
      rows: state.teams.map((t) => ({ ...t })),
    })],
    [/^UPDATE "matchups" SET "final"/, (text, [leagueId, season, week]) => {
      for (const m of state.matchups) {
        if (m.league_id === leagueId && m.season === season && m.week === week) m.final = true;
      }
      return { rows: [] };
    }],
    [/^UPDATE "leagues" SET "current_week"/, (text, [nextWeek]) => {
      state.league.current_week = nextWeek;
      return { rows: [] };
    }],
  ];

  return { state, fake: createFakePool(handlers), entriesFor };
}

/** The issue's step 3/4: team B wins P on waivers and the acquisition benches him. */
async function acquire(fake, state, { teamId = TEAM_B, playerId = ACQUIRED } = {}) {
  state.teamPlayers.push({ team_id: teamId, player_id: playerId });
  const client = await fake.connect();
  await benchAcquiredPlayer(client, { league: state.league, teamId, playerId });
  client.release();
}

/**
 * The issue's step 4, second half: something reads a week that is already
 * closed. Any of getLineup (a manager opening last week's lineup), the two
 * matchup routes, decision.service or the digest reminder lands here, so the
 * seam itself is driven rather than one arbitrary caller.
 */
async function touchWeek(fake, week, teamId = TEAM_B) {
  const client = await fake.connect();
  await materializeLineup(client, { leagueId: LEAGUE_ID, teamId, season: SEASON, week });
  client.release();
}

const awayScoreOf = (state) => Number(state.matchups.find((m) => m.id === 90).away_score);

// --- the two regression tests ------------------------------------------------

/**
 * Both follow the same reachable sequence. `matchups.final` has exactly one
 * writer, season.service's finalizeWeekAndAdvance, and it advances
 * current_week in the same transaction, so a FINAL week is always a PAST
 * week: the freeze can only ever be exercised by something reaching back to
 * a week that is already closed, never by the current week's own traffic.
 *
 *   1. week 8 is played and scored, team B fields its QB alone -> 10
 *   2. the commissioner advances; week 8 goes final, current_week becomes 9
 *   3. team B wins P on waivers; the acquisition benches him in week 9
 *   4. something reads week 8 (a manager opening last week, the matchup
 *      routes, decision.service, the digest) and reaches materializeLineup
 *   5. a stat correction, or a manual score call, re-scores week 8
 *
 * Step 4 is where the rows used to arrive and step 5 is where they used to
 * get paid. Both tests assert the score across step 5 and then the mechanism
 * at step 4, so a failure names the harm before it names the cause.
 */

test('#106 best ball: a player acquired after a final week never joins its re-score', async (t) => {
  const world = createWorld({ bestBall: true, week8Final: false });
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  const asPlayed = awayScoreOf(world.state);
  assert.equal(asPlayed, 10, 'baseline: team B played week 8 with its QB alone');

  await finalizeWeekAndAdvance({ leagueId: LEAGUE_ID });
  assert.equal(world.state.matchups[0].final, true, 'week 8 is closed');
  assert.equal(world.state.league.current_week, 9, 'and the league has moved on');

  await acquire(world.fake, world.state);
  await touchWeek(world.fake, 8);

  // Path 1: the stat-correction re-score.
  const correction = await correctLeagueWeek({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  assert.equal(awayScoreOf(world.state), asPlayed, 'a correction must not move a settled score');
  assert.deepEqual(correction.changes, [], 'and must not report one');

  // Path 2: the manual POST /league/:id/score path.
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  assert.equal(awayScoreOf(world.state), asPlayed, 'a manual re-score must not move it either');

  // The mechanism: no week-8 row was ever created for him. Any row at all is
  // enough in best ball, where every row for the week is a candidate.
  assert.deepEqual(
    world.entriesFor(TEAM_B, SEASON, 8).map((e) => e.player_id),
    [QB_B],
    'nothing may materialize into a final week'
  );
  // ...and #97 / PR #102 still holds for the week that IS live.
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, 9).find((e) => e.player_id === ACQUIRED).slot,
    'BENCH',
    'the acquisition still benches him in the new current week'
  );
  assert.deepEqual(world.state.transactions, [], 'no stat_correction should have been logged');
  world.fake.assertClean();
});

test('#106 standard: a copied-forward starting slot cannot re-score a final week', async (t) => {
  // P started at RB for team B in week 7 and was dropped. When he is
  // re-acquired after week 8 has closed, materializeLineup's copy-forward
  // would hand him week 7's RB slot - a STARTING slot, which is what a
  // standard league counts. Best ball needs no such help, which is why the
  // two leagues need separate tests.
  const world = createWorld({
    bestBall: false,
    week8Final: false,
    priorWeekEntries: [
      { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: 7, slot: 'QB', ir_attested: false },
      { team_id: TEAM_B, player_id: ACQUIRED, season: SEASON, week: 7, slot: 'RB', ir_attested: false },
    ],
  });
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  const asPlayed = awayScoreOf(world.state);
  assert.equal(asPlayed, 10);

  await finalizeWeekAndAdvance({ leagueId: LEAGUE_ID });
  assert.equal(world.state.matchups[0].final, true);
  assert.equal(world.state.league.current_week, 9);

  await acquire(world.fake, world.state);
  await touchWeek(world.fake, 8);

  const correction = await correctLeagueWeek({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  assert.equal(awayScoreOf(world.state), asPlayed, 'a correction must not move a settled score');
  assert.deepEqual(correction.changes, [], 'and must not report one');

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  assert.equal(awayScoreOf(world.state), asPlayed, 'a manual re-score must not move it either');

  assert.deepEqual(
    world.entriesFor(TEAM_B, SEASON, 8).map((e) => e.player_id),
    [QB_B],
    'the copy-forward must not reach into a final week'
  );
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, 9).find((e) => e.player_id === ACQUIRED).slot,
    'BENCH',
    'the acquisition still benches him in the new current week'
  );
  assert.deepEqual(world.state.transactions, []);
  world.fake.assertClean();
});

// --- the controls: the fixtures above are genuinely live ---------------------

/**
 * A "the score did not change" assertion is worthless if the fixture could
 * never have changed it. Each control is the matching regression test with
 * ONE variable flipped - week 8 is never closed - and each asserts the score
 * DOES move to 40. So the pair proves the guard is what holds the score
 * still, not the fixture's inertia.
 *
 * The roster grows and week 8 is touched directly here, with no acquisition
 * plumbing in between, so the only thing under test is materializeLineup's
 * behaviour on a week that is or is not final.
 */

test('#106 control: touching a LIVE best-ball week does move its score', async (t) => {
  const world = createWorld({ bestBall: true, week8Final: false });
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  assert.equal(awayScoreOf(world.state), 10);

  world.state.teamPlayers.push({ team_id: TEAM_B, player_id: ACQUIRED });
  await touchWeek(world.fake, 8);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });

  assert.equal(
    world.entriesFor(TEAM_B, SEASON, 8).find((e) => e.player_id === ACQUIRED).slot,
    'BENCH',
    'he arrives on the bench, which best ball counts anyway'
  );
  assert.equal(awayScoreOf(world.state), 40, 'a live week still materializes and still counts him');
  world.fake.assertClean();
});

test('#106 control: touching a LIVE standard week does move its score', async (t) => {
  const world = createWorld({
    bestBall: false,
    week8Final: false,
    priorWeekEntries: [
      { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: 7, slot: 'QB', ir_attested: false },
      { team_id: TEAM_B, player_id: ACQUIRED, season: SEASON, week: 7, slot: 'RB', ir_attested: false },
    ],
  });
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });
  assert.equal(awayScoreOf(world.state), 10);

  world.state.teamPlayers.push({ team_id: TEAM_B, player_id: ACQUIRED });
  await touchWeek(world.fake, 8);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: 8 });

  // This is the standard-league mechanism the issue calls out, shown working:
  // the copy-forward hands him week 7's RB slot, and RB is not BENCH/IR.
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, 8).find((e) => e.player_id === ACQUIRED).slot,
    'RB',
    'the slot is copied forward from week 7, so he arrives as a STARTER'
  );
  assert.equal(awayScoreOf(world.state), 40, 'the copied-forward RB slot is honoured while the week is live');
  world.fake.assertClean();
});

// --- the probe asks the right question ---------------------------------------

test('#106 the finality probe asks about THIS team, and only about a final matchup', async (t) => {
  // The world's handler answers the probe from its params, so on its own it
  // would keep passing even if the production predicates were wrong (relaxing
  // the home-or-away clause to `$4 IS NOT NULL`, or dropping `final`, leaves
  // every other test in this file green). Pin the statement itself so the two
  // edge-case tests below are backed by the SQL they claim to be about.
  const world = createWorld({ week8Final: false });
  world.fake.install(t);

  await touchWeek(world.fake, 8);

  const [probe] = world.fake.matching(/^SELECT 1 FROM "matchups"/);
  assert.ok(probe, 'materializeLineup must ask whether the week is closed');
  assert.match(probe.text, /"final" = true/, 'only a FINAL matchup freezes a week');
  assert.match(
    probe.text,
    /\("home_team_id" = \$4 OR "away_team_id" = \$4\)/,
    'the team is matched on either side of its OWN game, not on the week as a whole'
  );
  assert.deepEqual(probe.params, [LEAGUE_ID, SEASON, 8, TEAM_B], 'league, season, week, team');
  world.fake.assertClean();
});

// --- the edge case that makes a naive implementation wrong -------------------

test('#106 a week with no matchup row at all still materializes', async (t) => {
  const world = createWorld({ matchups: [] });
  world.fake.install(t);

  await acquire(world.fake, world.state);

  assert.deepEqual(
    world.entriesFor(TEAM_B, SEASON, 8).map((e) => e.player_id).sort(),
    [QB_B, ACQUIRED].sort(),
    'no schedule yet is not finality'
  );
  world.fake.assertClean();
});

test('#106 a team on a bye in a final week still materializes', async (t) => {
  // Week 8 is final for the two OTHER teams; team B has no matchup row.
  const world = createWorld({
    matchups: [{
      id: 91,
      league_id: LEAGUE_ID,
      season: SEASON,
      week: 8,
      home_team_id: 30,
      away_team_id: 40,
      final: true,
      home_score: 0,
      away_score: 0,
      is_playoff: false,
      is_consolation: false,
      playoff_round: null,
    }],
  });
  world.fake.install(t);

  await acquire(world.fake, world.state);

  assert.ok(
    world.entriesFor(TEAM_B, SEASON, 8).some((e) => e.player_id === ACQUIRED),
    "another matchup's finality must not freeze a team that did not play"
  );
  world.fake.assertClean();
});

test('#106 a non-final matchup still materializes', async (t) => {
  const world = createWorld({ week8Final: false });
  world.fake.install(t);

  const client = await world.fake.connect();
  world.state.teamPlayers.push({ team_id: TEAM_B, player_id: ACQUIRED });
  await materializeLineup(client, {
    leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: 8,
  });
  client.release();

  assert.ok(world.entriesFor(TEAM_B, SEASON, 8).some((e) => e.player_id === ACQUIRED));
  world.fake.assertClean();
});

// --- #97 / PR #102 bench-on-acquisition survives the freeze ------------------

test('#106 after finalizeWeekAndAdvance the acquired player is on the new week bench', async (t) => {
  const world = createWorld({ bestBall: false, week8Final: false });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  // Week 8 is live at acquisition time, so he lands on its bench as #97 wants.
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, 8).find((e) => e.player_id === ACQUIRED).slot,
    'BENCH'
  );

  const outcome = await finalizeWeekAndAdvance({ leagueId: LEAGUE_ID });
  assert.equal(outcome.advancedTo, 9);
  assert.equal(world.state.league.current_week, 9);
  assert.equal(world.state.matchups[0].final, true);

  // First touch of the new current week: he must still be there, on the bench.
  const client = await world.fake.connect();
  await materializeLineup(client, {
    leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: 9,
  });
  client.release();

  const week9 = world.entriesFor(TEAM_B, SEASON, 9);
  assert.deepEqual(week9.map((e) => e.player_id).sort(), [QB_B, ACQUIRED].sort());
  assert.equal(week9.find((e) => e.player_id === ACQUIRED).slot, 'BENCH');
  world.fake.assertClean();
});

test('#106 a frozen week is not a copy-forward source that benches the roster', async (t) => {
  // benchAcquiredPlayer materializes the current week first so it is never a
  // lone row that the next copy-forward reads as its source. The freeze makes
  // that step a no-op for a final week, so check the property it protects
  // still holds: week 9's source is week 8, which is complete AS PLAYED, and
  // only the newly acquired player - who has no week-8 row - defaults to the
  // bench. Everyone else keeps the slot they actually played.
  const world = createWorld({
    bestBall: false,
    week8Final: false,
    priorWeekEntries: [
      { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: 7, slot: 'QB', ir_attested: false },
    ],
  });
  world.fake.install(t);

  await finalizeWeekAndAdvance({ leagueId: LEAGUE_ID });
  await acquire(world.fake, world.state);
  await touchWeek(world.fake, 8);
  await touchWeek(world.fake, 9);

  assert.equal(world.entriesFor(TEAM_B, SEASON, 8).length, 1, 'week 8 stays frozen');
  const week9 = world.entriesFor(TEAM_B, SEASON, 9);
  assert.deepEqual(week9.map((e) => e.player_id).sort(), [QB_B, ACQUIRED].sort());
  assert.equal(week9.find((e) => e.player_id === QB_B).slot, 'QB', 'the QB kept his slot');
  assert.equal(week9.find((e) => e.player_id === ACQUIRED).slot, 'BENCH');
  world.fake.assertClean();
});
