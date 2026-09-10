const test = require('node:test');
const assert = require('node:assert/strict');
const liveBoxPoll = require('../modules/liveBoxPoll');
const liveBox = require('../modules/liveBox');
const scoring = require('../services/scoring.service');
const scheduler = require('../modules/scheduler');
const { createFakePool, select } = require('./helpers/fakePool');

/**
 * The engine-owned Live box poll (#1185, ADR 0035): the summary is fetched only
 * for in-progress games whose score or clock moved since the previous poll, and
 * a league is re-scored only when a player it rosters changed, at most once per
 * 60 seconds per league, with its Scoring plays accumulated (never dropped)
 * until its next run.
 */

const prior = (over = {}) => ({
  tank01_game_id: 'g1', game_status: 'in_progress', current_score_home: 7, current_score_away: 3,
  quarter: 'Q2', time_remaining: '8:42', espn_event_id: '401', final_stats_synced_at: null, ...over,
});
const fresh = (over = {}) => ({
  tank01GameId: 'g1', gameStatus: 'in_progress', currentScoreHome: 7, currentScoreAway: 3,
  quarter: 'Q2', timeRemaining: '8:42', espnEventId: '401', ...over,
});

// --- changedGames (pure) -----------------------------------------------------

test('changedGames: identical score and clock -> nothing to fetch', () => {
  const out = liveBoxPoll.changedGames(new Map([['g1', prior()]]), [fresh()]);
  assert.deepEqual(out, []);
});

test('changedGames: a clock change fetches the game again; so does a score change', () => {
  assert.deepEqual(
    liveBoxPoll.changedGames(new Map([['g1', prior()]]), [fresh({ timeRemaining: '8:10' })]),
    [{ gameId: 'g1', espnEventId: '401', status: 'in_progress' }]
  );
  assert.equal(liveBoxPoll.changedGames(new Map([['g1', prior()]]), [fresh({ currentScoreHome: 14 })]).length, 1);
  assert.equal(liveBoxPoll.changedGames(new Map([['g1', prior()]]), [fresh({ quarter: 'Q3' })]).length, 1);
});

test('changedGames: a game never seen before is fetched; scheduled and final games are not', () => {
  assert.equal(liveBoxPoll.changedGames(new Map(), [fresh()]).length, 1);
  assert.deepEqual(liveBoxPoll.changedGames(new Map(), [fresh({ gameStatus: 'scheduled' })]), []);
  assert.deepEqual(liveBoxPoll.changedGames(new Map([['g1', prior()]]), [fresh({ gameStatus: 'final', currentScoreHome: 21 })]), []);
});

test('changedGames: a Tank01 clock row without an ESPN id keeps the stored espn_event_id', () => {
  const out = liveBoxPoll.changedGames(new Map([['g1', prior()]]), [fresh({ espnEventId: null, timeRemaining: '7:00' })]);
  assert.equal(out[0].espnEventId, '401');
});

test('changedGames: a game whose Final box has landed is never fetched, whatever moved', () => {
  const out = liveBoxPoll.changedGames(
    new Map([['g1', prior({ final_stats_synced_at: new Date() })]]),
    [fresh({ timeRemaining: '0:30' })]
  );
  assert.deepEqual(out, []);
});

// --- re-score gate (60 s per league, plays accumulate) -----------------------

test('rescoreGate: a league is due immediately the first time and not again inside 60 s; plays ride the next run', () => {
  const gate = liveBoxPoll.createRescoreGate({ floorMs: 60_000 });
  gate.collect([1, 2], [{ type: 'rushing' }]);
  let due = gate.due(1_000);
  assert.deepEqual(due.map((d) => d.leagueId), [1, 2]);
  assert.deepEqual(due[0].plays, [{ type: 'rushing' }]);
  gate.markRan(1, 1_000);
  gate.markRan(2, 1_000);

  gate.collect([1], [{ type: 'passing' }]);
  assert.deepEqual(gate.due(21_000), [], 'twenty seconds later league 1 is inside its floor');
  gate.collect([1], [{ type: 'fieldGoal' }]);
  due = gate.due(61_000);
  assert.deepEqual(due.map((d) => d.leagueId), [1], 'past the floor, only the league with pending work runs');
  assert.deepEqual(due[0].plays, [{ type: 'passing' }, { type: 'fieldGoal' }], 'both passes’ plays ride one broadcast');
  gate.markRan(1, 61_000);
  assert.deepEqual(gate.due(200_000), [], 'nothing pending, nothing runs');
});

// --- pollChangedGames: fetch once per changed game, apply, re-score rostering leagues ----

function pollWorld(t, { fetch, leaguesByPlayer }) {
  liveBox.__resetLiveBoxState();
  liveBoxPoll.__resetPollState();
  const fake = createFakePool([
    [select('players'), () => ({ rows: [
      { id: 12, external_id: '4430878', name: 'JSN', position: 'WR', nfl_team: 'SEA' },
      { id: 13, external_id: '4431452', name: 'Drake Maye', position: 'QB', nfl_team: 'NE' },
    ] })],
    [/FROM "player_stats"/, () => ({ rows: [] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/INTO "player_stats"/, () => ({ rows: [] })],
    // Leagues rostering the changed players this week.
    [/FROM "team_players"/, (text, params) => ({ rows: leaguesByPlayer(params[0]) })],
  ]);
  fake.install(t);
  t.mock.method(liveBox, 'fetchLiveBox', fetch);
  const scored = [];
  t.mock.method(scoring, 'scoreMatchups', async ({ leagueId, plays }) => { scored.push({ leagueId, plays }); return { scored: [] }; });
  t.mock.method(scheduler, 'alertCloseMatchups', async () => {});
  t.after(() => { liveBox.__resetLiveBoxState(); liveBoxPoll.__resetPollState(); });
  return { fake, scored };
}

const jsnBox = (tds) => ({
  liveBox: { gameId: 'g1', source: 'espn', isFinal: false, players: [{ externalId: '4430878', stats: { receptions: 8, receivingTDs: tds } }], teamDefense: {}, scoreSummaryLines: [] },
  source: 'espn',
  skipped: false,
});

test('pollChangedGames: each changed game is fetched once, only rostering leagues are re-scored', async (t) => {
  const fetches = [];
  const w = pollWorld(t, {
    fetch: async (args) => { fetches.push(args.gameId); return jsnBox(1); },
    leaguesByPlayer: (ids) => (ids.includes(12) ? [{ league_id: 1 }] : []),
  });
  const out = await liveBoxPoll.pollChangedGames({
    season: 2026, week: 1, now: 1_000,
    games: [{ gameId: 'g1', espnEventId: '401', status: 'in_progress' }],
    finalSyncedGameIds: new Set(),
  });
  assert.deepEqual(fetches, ['g1']);
  assert.deepEqual(out.changedPlayerIds, [12]);
  assert.deepEqual(w.scored.map((s) => s.leagueId), [1], 'league A rosters JSN; league B (not returned) is not re-scored');
  assert.equal(w.scored[0].plays.length, 1, 'the TD rode the emit');
});

test('pollChangedGames: two passes 20 s apart run a league once and carry both passes’ plays into the next run', async (t) => {
  let tds = 1;
  const w = pollWorld(t, {
    fetch: async () => jsnBox(tds),
    leaguesByPlayer: () => [{ league_id: 1 }],
  });
  const game = { gameId: 'g1', espnEventId: '401', status: 'in_progress' };
  await liveBoxPoll.pollChangedGames({ season: 2026, week: 1, now: 1_000, games: [game], finalSyncedGameIds: new Set() });
  tds = 2;
  await liveBoxPoll.pollChangedGames({ season: 2026, week: 1, now: 21_000, games: [game], finalSyncedGameIds: new Set() });
  assert.equal(w.scored.length, 1, 'inside the floor the second pass does not re-score');
  tds = 3;
  await liveBoxPoll.pollChangedGames({ season: 2026, week: 1, now: 41_000, games: [game], finalSyncedGameIds: new Set() });
  assert.equal(w.scored.length, 1);
  // A quiet tick past the floor flushes the pending run with every play since.
  await liveBoxPoll.pollChangedGames({ season: 2026, week: 1, now: 62_000, games: [], finalSyncedGameIds: new Set() });
  assert.equal(w.scored.length, 2);
  assert.equal(w.scored[1].plays.length, 2, 'the second and third TDs both ride the one broadcast');
});

test('pollChangedGames: a skipped fetch (below the failure threshold, or cadence) applies nothing', async (t) => {
  const w = pollWorld(t, {
    fetch: async () => ({ liveBox: null, source: 'espn', skipped: true }),
    leaguesByPlayer: () => [{ league_id: 1 }],
  });
  const out = await liveBoxPoll.pollChangedGames({ season: 2026, week: 1, now: 1_000, games: [{ gameId: 'g1', espnEventId: '401', status: 'in_progress' }], finalSyncedGameIds: new Set() });
  assert.deepEqual(out.changedPlayerIds, []);
  assert.deepEqual(w.scored, []);
});
