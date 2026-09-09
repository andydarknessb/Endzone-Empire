const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { tenureHandlers, tenure } = require('./helpers/tenureFakes');
const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
const { scoreMatchups } = require('../services/scoring.service');
const { weekHindsight } = require('../services/decision.service');

/*
 * #954 acceptance criterion 3 (as replaced by the pl-endzone ruling): drive the
 * SETTLE PASS and weekHindsight over the SAME fixture world and assert an
 * identical total - the one observable that must not move now that both readers
 * price through the shared counted-roster module.
 *
 * criterion 3 as originally written wanted a settled week re-read out of the
 * database; that database is production and no agent may query it, and there is
 * no fixture-mode entry point, so it could only be faked or skipped. This runs
 * the real code path end to end from fake-pool fixtures instead, the same way
 * hindsightScoreOfRecord.test.js:501 already proves it for one best-ball world.
 * Here it is proven for the STANDARD settle branch (which
 * hindsightScoreOfRecord asserts only against a seeded score, never a live
 * settle run) and again for best ball, over worlds this file settles itself.
 *
 * scoreMatchups emits through getDraftRoomBroadcast(), which throws with no
 * broadcast registered (#765); register a recording one around every test.
 */
registerRecordingBroadcast();

const SEASON = 2026;
const WEEK = 8;
const LEAGUE_ID = 5;
const TEAM_A = 10; // home
const TEAM_B = 20; // away, the team under test

const HELD_ALL_SEASON = new Date('2026-08-01T00:00:00.000Z');
const KICKOFF = new Date('2026-10-25T17:00:00.000Z');

const SCHEDULE = { Chiefs: KICKOFF, Eagles: KICKOFF, Bills: KICKOFF, Ravens: KICKOFF };

const ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
];

/**
 * A settled world serving BOTH readers over one set of rows and tenures. Each
 * population handler reproduces what its real query does, reading the behaviour
 * out of the emitted statement rather than hard-coding one answer:
 *   - The standard settle read reproduces the SLOT drop (BENCH and IR, the
 *     `slot NOT IN (...)` filter its SQL has always carried; a slot filter, not
 *     a join), AND the player_stats JOIN (#1010): it reads whether the statement
 *     inner- or left-joins player_stats and, on an INNER join, drops a statless
 *     starter (a `players` entry with `stats: null`, modelling a lineup row with
 *     no matching player_stats row) exactly as the database would.
 *   - The best-ball and hindsight reads select every slot and left-join.
 * After #1010 both settle branches left-join, so neither carries join drift any
 * more; the standard handler still models EITHER join so this file's #1010 case
 * can gate the fix (restore the INNER join and the statless starter drops).
 *
 * `populations` records, per teamId, the player ids each reader's population
 * read handed back. The readers discard countedRoster's `counted` array, so the
 * scoring population is not on the wire; this capture is the weaker of the two
 * evidences the ruling names (the emitted statement plus the returned rows), and
 * it is a real gate: on the standard settle read it depends on the join text the
 * production query emits at scoring.service.js:1920.
 */
function settledWorld({ bestBall, players, lineupEntries, tenures }) {
  const populations = { settleStandard: new Map(), hindsight: new Map() };
  const league = {
    id: LEAGUE_ID, current_season: SEASON, current_week: WEEK + 1,
    best_ball: bestBall, roster_slots: ROSTER_SLOTS, bench_slots: 5, ir_slots: 1,
    scoring_rules: null, owner_id: 101,
  };
  const matchups = [{
    id: 90, league_id: LEAGUE_ID, season: SEASON, week: WEEK,
    home_team_id: TEAM_A, away_team_id: TEAM_B, final: true, home_score: 0, away_score: 0,
  }];
  const rowsFor = (teamId) => lineupEntries.filter((e) => e.team_id === teamId);
  const shape = (e, withPositionName) => {
    const p = players.get(e.player_id);
    return withPositionName
      ? { player_id: e.player_id, name: p.name, position: p.position, nfl_team: p.nfl_team, slot: e.slot, stats: p.stats }
      : { player_id: e.player_id, slot: e.slot, position: p.position, nfl_team: p.nfl_team, stats: p.stats };
  };
  const handlers = [
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [league] })],
    [/^SELECT 1 FROM "teams" WHERE "id" = \$1 AND "league_id" = \$2/, (text, [teamId]) => ({
      rows: [TEAM_A, TEAM_B].includes(teamId) ? [{ '?column?': 1 }] : [],
    })],
    [/^SELECT COUNT\(\*\)::int AS "n", BOOL_AND\("final"\) AS "all_final" FROM "matchups"/,
      (text, [leagueId, season, week]) => {
        const rows = matchups.filter((m) => m.league_id === leagueId && m.season === season && m.week === week);
        return { rows: [{ n: rows.length, all_final: rows.length > 0 && rows.every((m) => m.final) }] };
      }],
    ...tenureHandlers({ schedule: SCHEDULE, tenures, heldSince: null }),
    // weekHindsight's read: every slot, LEFT JOIN, carries name + position.
    [/^SELECT "lineup_entries"\."player_id", "players"\."name", "players"\."position"/,
      (text, [teamId]) => {
        const rows = rowsFor(teamId).map((e) => shape(e, true));
        populations.hindsight.set(teamId, rows.map((r) => r.player_id));
        return { rows };
      }],
    // Best-ball settle read: every slot, LEFT JOIN, carries position.
    [/^SELECT "lineup_entries"\."player_id", "lineup_entries"\."slot"/,
      (text, [teamId]) => ({ rows: rowsFor(teamId).map((e) => shape(e, false)) })],
    // Standard settle read: the real SQL selects ONLY player_id, nfl_team and
    // stats - no slot, no position - and drops BENCH and IR in the statement
    // itself. Return exactly those columns (so the rows countedRoster prices on
    // this branch are genuinely slot-less and position-less, as in production),
    // and read the drop clause out of the statement to answer the real
    // population rather than a canned one (the scoreOfRecordTenure.test.js
    // pattern).
    [/^SELECT "lineup_entries"\."player_id", "players"\."nfl_team", "player_stats"\."stats"/,
      (text, [teamId]) => {
        const dropsBench = /"slot" NOT IN \('BENCH', 'IR'\)/.test(text);
        // player_stats JOIN drift (#1010): an INNER join drops a starter with no
        // player_stats row (modelled here as `stats: null`, meaning the join
        // found no match); a LEFT join keeps him and he prices at 0. Read the
        // join out of the statement, the same way the drop clause above is read,
        // so this population answers the production SQL rather than a canned set.
        const leftJoinsStats = /LEFT JOIN "player_stats"/.test(text);
        const rows = rowsFor(teamId)
          .filter((e) => !dropsBench || (e.slot !== 'BENCH' && e.slot !== 'IR'))
          .filter((e) => leftJoinsStats || players.get(e.player_id).stats != null)
          .map((e) => {
            const p = players.get(e.player_id);
            return { player_id: e.player_id, nfl_team: p.nfl_team, stats: p.stats };
          });
        populations.settleStandard.set(teamId, rows.map((r) => r.player_id));
        return { rows };
      }],
    [/^SELECT \* FROM "matchups"/, (text, [leagueId, season, week]) => ({
      rows: matchups
        .filter((m) => m.league_id === leagueId && m.season === season
          && (week === undefined || m.week === week))
        .map((m) => ({ ...m })),
    })],
    [/^UPDATE "matchups" SET "home_score"/, (text, [homeScore, awayScore, id]) => {
      const m = matchups.find((x) => x.id === id);
      m.home_score = homeScore;
      m.away_score = awayScore;
      return { rows: [] };
    }],
  ];
  return { matchups, fake: createFakePool(handlers), populations };
}

const held = (teamId, playerId) => tenure(teamId, playerId, HELD_ALL_SEASON);

test('#954 standard: the settle pass and weekHindsight agree on the score of record over one fixture world', async (t) => {
  // Team B: QB 10 and RB 20 started; a 25 RB benched; a 50 RB on IR. Both
  // readers must count the two starters (30), drop the IR row, and keep the
  // bench out of the started total. Hindsight then sees 5 left on the bench
  // (the 25 RB beats the started 20), but the SCORE OF RECORD is 30 either way.
  const players = new Map([
    [1, { name: 'QB', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 250 } }], // 10
    [2, { name: 'Started RB', position: 'RB', nfl_team: 'Eagles', stats: { rushingYards: 200 } }], // 20
    [3, { name: 'Bench RB', position: 'RB', nfl_team: 'Bills', stats: { rushingYards: 250 } }], // 25
    [4, { name: 'IR RB', position: 'RB', nfl_team: 'Ravens', stats: { rushingYards: 500 } }], // 50
    [9, { name: 'Home QB', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 200 } }], // 8
  ]);
  const world = settledWorld({
    bestBall: false,
    players,
    lineupEntries: [
      { team_id: TEAM_A, player_id: 9, season: SEASON, week: WEEK, slot: 'QB' },
      { team_id: TEAM_B, player_id: 1, season: SEASON, week: WEEK, slot: 'QB' },
      { team_id: TEAM_B, player_id: 2, season: SEASON, week: WEEK, slot: 'RB' },
      { team_id: TEAM_B, player_id: 3, season: SEASON, week: WEEK, slot: 'BENCH' },
      { team_id: TEAM_B, player_id: 4, season: SEASON, week: WEEK, slot: 'IR' },
    ],
    tenures: [held(TEAM_A, 9), held(TEAM_B, 1), held(TEAM_B, 2), held(TEAM_B, 3), held(TEAM_B, 4)],
  });
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });
  const scoreOfRecord = Number(world.matchups[0].away_score);
  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  // Fixture week 8; the numbers, quoted for the PR body:
  assert.equal(scoreOfRecord, 30, 'settle counts the two starters, drops IR, ignores the bench');
  assert.equal(h.actualPoints, scoreOfRecord, 'weekHindsight actual equals the settle pass score of record');
  assert.equal(h.optimalPoints, 35, 'hindsight would have started the 25 bench RB over the 20');
  assert.equal(h.pointsLeftOnBench, 5);
});

test('#954 best ball: the settle pass and weekHindsight agree on the score of record over one fixture world', async (t) => {
  // Team B, best ball: QB 8 and RB 30 both benched (best ball has no bench),
  // a 50 RB on IR. Optimal seats QB + the 30 RB; the IR 50 is never a candidate.
  const players = new Map([
    [1, { name: 'QB', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 200 } }], // 8
    [2, { name: 'RB', position: 'RB', nfl_team: 'Eagles', stats: { rushingYards: 300 } }], // 30
    [4, { name: 'IR RB', position: 'RB', nfl_team: 'Ravens', stats: { rushingYards: 500 } }], // 50
    [9, { name: 'Home QB', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 200 } }], // 8
  ]);
  const world = settledWorld({
    bestBall: true,
    players,
    lineupEntries: [
      { team_id: TEAM_A, player_id: 9, season: SEASON, week: WEEK, slot: 'QB' },
      { team_id: TEAM_B, player_id: 1, season: SEASON, week: WEEK, slot: 'BENCH' },
      { team_id: TEAM_B, player_id: 2, season: SEASON, week: WEEK, slot: 'BENCH' },
      { team_id: TEAM_B, player_id: 4, season: SEASON, week: WEEK, slot: 'IR' },
    ],
    tenures: [held(TEAM_A, 9), held(TEAM_B, 1), held(TEAM_B, 2), held(TEAM_B, 4)],
  });
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });
  const scoreOfRecord = Number(world.matchups[0].away_score);
  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  assert.equal(scoreOfRecord, 38, 'best ball scores the optimal lineup QB 8 + RB 30; the IR 50 is excluded');
  assert.equal(h.actualPoints, scoreOfRecord, 'best-ball hindsight actual equals the settle pass score of record');
  assert.equal(h.pointsLeftOnBench, 0, 'best ball leaves nothing on the bench');
});

test('#1010 standard: a statless starter is in the counted population at zero, and both readers agree by player id', async (t) => {
  // Team B started QB 1 (10 pts) and RB 2, who has NO player_stats row for the
  // week (statless). He is a started player who scored nothing, so he belongs to
  // the week's counted roster priced at 0; the score of record is the QB's 10
  // with him or without him, which is precisely why a total-only assertion is
  // blind here. This world has NO bench and NO IR, so each reader's raw
  // population read IS its scoring population and the two are directly
  // comparable by player id.
  const players = new Map([
    [1, { name: 'QB', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 250 } }], // 10
    [2, { name: 'Statless RB', position: 'RB', nfl_team: 'Eagles', stats: null }], // 0, no player_stats row
    [9, { name: 'Home QB', position: 'QB', nfl_team: 'Chiefs', stats: { passingYards: 200 } }], // 8
  ]);
  const world = settledWorld({
    bestBall: false,
    players,
    lineupEntries: [
      { team_id: TEAM_A, player_id: 9, season: SEASON, week: WEEK, slot: 'QB' },
      { team_id: TEAM_B, player_id: 1, season: SEASON, week: WEEK, slot: 'QB' },
      { team_id: TEAM_B, player_id: 2, season: SEASON, week: WEEK, slot: 'RB' },
    ],
    tenures: [held(TEAM_A, 9), held(TEAM_B, 1), held(TEAM_B, 2)],
  });
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });
  const scoreOfRecord = Number(world.matchups[0].away_score);
  const h = await weekHindsight({ leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK });

  // The counted populations, observed as the rows each reader's population read
  // handed back for team B, sorted by player id. This is the weaker of the two
  // evidences the ruling names: the readers discard countedRoster's `counted`
  // array, so the population is not on the wire, but the standard settle capture
  // is bound to the production join text at scoring.service.js:1920.
  const settlePop = [...world.populations.settleStandard.get(TEAM_B)].sort((a, b) => a - b);
  const hindsightPop = [...world.populations.hindsight.get(TEAM_B)].sort((a, b) => a - b);

  // POPULATION, not total. RED-TELL: restoring `JOIN "player_stats"` (the INNER
  // join) at scoring.service.js:1920 drops the statless RB (id 2) from settlePop
  // and turns the equality below red. The score-of-record assertion further down
  // stays green through that mutation, which is why it cannot be the gate.
  assert.deepEqual(settlePop, [1, 2], 'settle pass counts the QB and the statless RB');
  assert.deepEqual(hindsightPop, [1, 2], 'weekHindsight counts the QB and the statless RB');
  assert.deepEqual(settlePop, hindsightPop, 'both readers agree on the counted population by player id');
  assert.ok(
    settlePop.includes(2) && hindsightPop.includes(2),
    'the statless starter is in both counted populations',
  );

  // At zero, and the score of record is unchanged by his presence: 10 is the QB
  // alone. Numbers quoted for the PR body.
  assert.equal(scoreOfRecord, 10, 'score of record is the QB 10; the statless RB adds 0');
  assert.equal(h.actualPoints, scoreOfRecord, 'weekHindsight actual equals the settle pass score of record');
});
