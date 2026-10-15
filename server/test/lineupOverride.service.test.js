/**
 * #1856: the called-shot service's own rules, read through the shared fake
 * pool (the routes' wiring is pinned in calledShot.route.test.js).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { loadCalledShot, loadOpenShotForSave, voidShot, declareCalledShot } = require('../services/lineupOverride.service');

const row = (over = {}) => ({
  id: 41, team_id: 10, season: 2026, week: 6, slot: 'RB',
  starter_player_id: 1, benched_player_id: 3,
  starter_point_estimate: '6.00', benched_point_estimate: '18.00', probability: '0.9200', verdict: 'start',
  declared_at: '2026-10-08T12:00:00.000Z', outcome: 'pending',
  starter_points_actual: null, benched_points_actual: null, resolved_at: null,
  starter_name: 'p1', starter_nfl_team: 'BUF', benched_name: 'p3', benched_nfl_team: 'BUF',
  ...over,
});

const shotFake = (calledRow = row(), { kickedOff = [] } = {}) => createFakePool([
  [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: calledRow ? [calledRow] : [] })],
  [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: kickedOff.map((nfl_team) => ({ nfl_team })) })],
  [/^UPDATE "lineup_overrides"/, () => ({ rows: [] })],
]);
const SAVE = { teamId: 10, season: 2026, week: 6 };

test('loadOpenShotForSave reads the open shot with its pair and whether a player has locked', async () => {
  assert.deepEqual(await loadOpenShotForSave(shotFake(), SAVE), { id: 41, starterId: 1, benchedId: 3, locked: false });
  const kicked = await loadOpenShotForSave(shotFake(row(), { kickedOff: ['BUF'] }), SAVE);
  assert.equal(kicked.locked, true);
});

test('loadOpenShotForSave is null without a pending shot', async () => {
  assert.equal(await loadOpenShotForSave(shotFake(null), SAVE), null);
  assert.equal(await loadOpenShotForSave(shotFake(row({ outcome: 'hit' })), SAVE), null);
});

test('voidShot voids one pending row by id and nothing else', async () => {
  const fake = shotFake();
  await voidShot(fake, 41);
  const [call] = fake.matching(/^UPDATE "lineup_overrides" SET "outcome" = 'void'/);
  assert.deepEqual(call.params, [41]);
  assert.match(call.text, /"outcome" = 'pending'/);
});


test('loadCalledShot carries the numbers as called and is null without a shot', async () => {
  const league = { id: 3 };
  const withShot = createFakePool([
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [row()] })],
    [/FROM "matchups"/, () => ({ rows: [{ n: 1, all_final: false }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
  ]);
  const shot = await loadCalledShot(withShot, { league, teamId: 10, season: 2026, week: 6 });
  assert.equal(shot.status, 'pending');
  assert.deepEqual(
    [shot.starter.projection, shot.benched.projection, shot.probability, shot.verdict],
    [6, 18, 0.92, 'start']
  );
  const none = createFakePool([[/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [] })]]);
  assert.equal(await loadCalledShot(none, { league, teamId: 10, season: 2026, week: 6 }), null);
});

test('loadCalledShot never writes an outcome: a pending row stays pending in a week whose matchups are all final (#1860, ruling on #1879)', async () => {
  const fake = createFakePool([
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [row()] })],
    [/FROM "matchups"/, () => ({ rows: [{ n: 1, all_final: true }] })],
    [/FROM "player_stats"/, () => ({ rows: [
      { player_id: 1, stats: { rushingYards: 100 } },
      { player_id: 3, stats: { rushingYards: 20 } },
    ] })],
    [/^UPDATE "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
  ]);
  const shot = await loadCalledShot(fake, { league: { id: 3 }, teamId: 10, season: 2026, week: 6 });
  assert.equal(fake.matching(/^UPDATE "lineup_overrides"/).length, 0);
  assert.equal(shot.status, 'pending');
  assert.equal(shot.outcome, null);
  assert.equal(shot.resolvedAt, null);
});

test('loadCalledShot reads a stored outcome as resolved with both players\' points', async () => {
  const fake = createFakePool([
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: [row({
      outcome: 'miss', starter_points_actual: '4.50', benched_points_actual: '12.00',
      resolved_at: '2026-10-13T15:00:00.000Z',
    })] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
  ]);
  const shot = await loadCalledShot(fake, { league: { id: 3 }, teamId: 10, season: 2026, week: 6 });
  assert.equal(shot.status, 'resolved');
  assert.equal(shot.outcome, 'miss');
  assert.deepEqual([shot.starter.points, shot.benched.points], [4.5, 12]);
  assert.equal(shot.canWithdraw, false);
});

test('declareCalledShot refuses a malformed pair before touching the database', async () => {
  for (const pair of [{}, { starterId: 1 }, { starterId: 1, benchedId: 1 }, { starterId: '1', benchedId: 2 }]) {
    await assert.rejects(
      declareCalledShot({ leagueId: 3, userId: 7, ...pair, loadAdvice: async () => assert.fail('no advice') }),
      (error) => error.statusCode === 400
    );
  }
});

// #1857: a called shot is the league's to see once both players have locked.
const { loadPublicCalledShot } = require('../services/lineupOverride.service');

const KICKOFF = '2026-10-11T17:00:00.000Z';
const AFTER = new Date('2026-10-11T18:00:00.000Z');
const BEFORE = new Date('2026-10-11T12:00:00.000Z');
const publicFake = ({ calledRow = row(), games = [{ nfl_team: 'BUF', kickoff_at: KICKOFF }] } = {}) => createFakePool([
  [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: calledRow ? [calledRow] : [] })],
  [/^SELECT "nfl_team" FROM "nfl_games"/, (text, params) => ({
    rows: games.filter((g) => new Date(g.kickoff_at) <= params[2]),
  })],
  [/FROM "player_stats"/, () => ({ rows: [
    { player_id: 1, stats: { rushingYards: 114 } },
    { player_id: 3, stats: { rushingYards: 62 } },
  ] })],
]);
const publicArgs = { league: { id: 3 }, teamId: 10, season: 2026, week: 6 };

test('loadPublicCalledShot carries nothing before both players have locked', async () => {
  assert.equal(await loadPublicCalledShot(publicFake({ games: [] }), { ...publicArgs, now: AFTER }), null);
  assert.equal(await loadPublicCalledShot(publicFake(), { ...publicArgs, now: BEFORE }), null);
  const oneLocked = publicFake({
    calledRow: row({ benched_nfl_team: 'KC' }),
    games: [{ nfl_team: 'BUF', kickoff_at: KICKOFF }, { nfl_team: 'KC', kickoff_at: '2026-10-11T20:00:00.000Z' }],
  });
  assert.equal(await loadPublicCalledShot(oneLocked, { ...publicArgs, now: AFTER }), null);
});

test('loadPublicCalledShot carries nothing for a team with no called shot', async () => {
  assert.equal(await loadPublicCalledShot(publicFake({ calledRow: null }), { ...publicArgs, now: AFTER }), null);
});

test('loadPublicCalledShot reads only called rows, so a captured Override never shows', async () => {
  const fake = publicFake();
  await loadPublicCalledShot(fake, { ...publicArgs, now: AFTER });
  const sql = fake.matching(/^SELECT .*FROM "lineup_overrides"/)[0].text;
  assert.match(sql, /"lineup_overrides"\."called"/);
});

test('loadPublicCalledShot carries the pair and both players\' current points once both locked', async () => {
  const shot = await loadPublicCalledShot(publicFake(), { ...publicArgs, now: AFTER });
  assert.deepEqual(shot, {
    starter: { playerId: 1, name: 'p1', points: 11.4 },
    benched: { playerId: 3, name: 'p3', points: 6.2 },
    outcome: null,
  });
});

test('loadPublicCalledShot carries the judged points and outcome when final, and never what was not judged', async () => {
  const hit = row({ outcome: 'hit', starter_points_actual: '11.40', benched_points_actual: '6.20' });
  const shot = await loadPublicCalledShot(publicFake({ calledRow: hit }), { ...publicArgs, now: AFTER });
  assert.deepEqual([shot.outcome, shot.starter.points, shot.benched.points], ['hit', 11.4, 6.2]);
  const voided = row({ outcome: 'void', starter_points_actual: null, benched_points_actual: null });
  assert.equal((await loadPublicCalledShot(publicFake({ calledRow: voided }), { ...publicArgs, now: AFTER })).outcome, 'void');
});

test('loadCalledShot gives the calling manager live points once both players have locked (#1857)', async () => {
  const shot = await loadCalledShot(publicFake(), { ...publicArgs, now: AFTER });
  assert.equal(shot.bothLocked, true);
  assert.deepEqual([shot.starter.points, shot.benched.points], [11.4, 6.2]);
  const early = await loadCalledShot(publicFake(), { ...publicArgs, now: BEFORE });
  assert.equal(early.bothLocked, false);
  assert.equal(early.starter.points, null);
});

// #1862: the Override capture and the season record.
const { captureOverrides, loadSeasonRecord } = require('../services/lineupOverride.service');

const T = new Date('2026-10-11T17:00:00.000Z'); // BUF kicks off
const TICK = new Date('2026-10-11T17:03:00.000Z'); // the tick that first sees it
const suggestion = (starter, benched, probabilityBetter, verdict = 'start') => ({
  slot: 'RB',
  current: { playerId: starter, projection: 6 },
  suggested: { playerId: benched, projection: 18 },
  probabilityBetter,
  verdict,
});

// A stateful world: the INSERT handler enforces the pair key the way the real
// unique key does (the real-Postgres file pins the key itself).
function captureWorld({ leagues = [{ id: 3, current_season: 2026, current_week: 6 }], games, rows = [] } = {}) {
  const world = { rows };
  world.fake = createFakePool([
    [/^SELECT "id", "current_season", "current_week" FROM "leagues"/, () => ({ rows: leagues })],
    [/^SELECT "nfl_team", "kickoff_at" FROM "nfl_games"/, (text, params) => ({
      rows: (games || [{ nfl_team: 'BUF', kickoff_at: T }]).filter((g) => new Date(g.kickoff_at) <= params[2] && new Date(g.kickoff_at) > params[3]),
    })],
    [/^SELECT "id", "owner_id" FROM "teams"/, (text, params) => ({ rows: params[0] === 3 ? [{ id: 10, owner_id: 7 }] : [{ id: 20, owner_id: 8 }] })],
    [/^SELECT "id", "nfl_team" FROM "players"/, () => ({ rows: [
      { id: 1, nfl_team: 'BUF' }, { id: 3, nfl_team: 'KC' }, { id: 5, nfl_team: 'KC' }, { id: 6, nfl_team: 'KC' },
    ] })],
    [/^INSERT INTO "lineup_overrides"/, (text, params) => {
      const [leagueId, teamId, season, week, slot, starter, benched, , , , , capturedAt] = params;
      const key = [leagueId, season, week, teamId, slot, starter, benched].join(':');
      const existing = world.rows.find((r) => r.key === key);
      if (!existing) world.rows.push({ key, called: false, starter, benched, captured_at: capturedAt });
      else if (existing.called && existing.captured_at === existing.declared_at) existing.captured_at = capturedAt;
      return { rows: [] };
    }],
  ]);
  return world;
}
const adviceOf = (suggestions) => async () => ({ season: 2026, week: 6, suggestions });

test('capture writes one row per pair above the tossup line with a locking player, as of a minute before kickoff', async () => {
  const world = captureWorld();
  const asked = [];
  await captureOverrides({
    seen: new Map(),
    db: world.fake,
    now: TICK,
    loadAdvice: async (args) => {
      asked.push(args);
      return { season: 2026, week: 6, suggestions: [
        suggestion(1, 3, 0.92), // BUF starter locking: captured
        suggestion(1, 5, 0.55, 'tossup'), // too close to call: never
        suggestion(1, 6, null), // no probability: never
        suggestion(5, 6, 0.95), // neither player is on a kicking-off team: never
      ] };
    },
  });
  assert.deepEqual(asked, [{ leagueId: 3, userId: 7, week: 6, ignoreCalledShot: true, now: new Date('2026-10-11T16:59:00.000Z') }]);
  const inserts = world.fake.matching(/^INSERT INTO "lineup_overrides"/);
  assert.equal(inserts.length, 1);
  assert.match(inserts[0].text, /, false, /);
  assert.deepEqual(inserts[0].params.slice(0, 11), [3, 10, 2026, 6, 'RB', 1, 3, 6, 18, 0.92, 'start']);
});

test('a strong suggestion is still above the tossup line: captured, and eligible for a Called shot (#1909)', async () => {
  const world = captureWorld();
  await captureOverrides({ seen: new Map(), db: world.fake, now: TICK, loadAdvice: adviceOf([suggestion(1, 3, 0.85, 'strong')]) });
  const inserts = world.fake.matching(/^INSERT INTO "lineup_overrides"/);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].params[10], 'strong');
});

test('capture takes a pair whose benched player is the one locking', async () => {
  const world = captureWorld({ games: [{ nfl_team: 'KC', kickoff_at: T }] });
  await captureOverrides({ seen: new Map(), db: world.fake, now: TICK, loadAdvice: adviceOf([suggestion(1, 3, 0.9)]) });
  assert.equal(world.rows.length, 1);
});

test('a second tick writes nothing new, and a pair matching the called row updates it instead', async () => {
  const calledKey = '3:2026:6:10:RB:1:3';
  const declared = new Date('2026-10-09T12:00:00.000Z');
  const world = captureWorld({ rows: [{ key: calledKey, called: true, starter: 1, benched: 3, declared_at: declared, captured_at: declared }] });
  const loadAdvice = adviceOf([suggestion(1, 3, 0.92), suggestion(1, 5, 0.9)]);
  const seen = new Map();
  await captureOverrides({ seen, db: world.fake, now: TICK, loadAdvice });
  assert.equal(world.rows.length, 2, 'the called pair is not duplicated; the other is added');
  assert.deepEqual(world.rows.find((r) => r.key === calledKey).captured_at, TICK);
  await captureOverrides({ seen, db: world.fake, now: new Date(TICK.getTime() + 5 * 60000), loadAdvice });
  assert.equal(world.rows.length, 2);
  assert.deepEqual(world.rows.find((r) => r.key === calledKey).captured_at, TICK, 'and the called row is not touched again');
});

test('capture asks nothing of a league with no kickoff in the lookback window', async () => {
  const world = captureWorld();
  const late = new Date(T.getTime() + 3 * 3600 * 1000);
  await captureOverrides({ seen: new Map(), db: world.fake, now: late, loadAdvice: async () => assert.fail('no advice') });
  assert.equal(world.fake.matching(/^INSERT/).length, 0);
});

test('a failing league is logged and never stops the next one; the next tick retries it', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const world = captureWorld({ leagues: [
    { id: 3, current_season: 2026, current_week: 6 }, { id: 4, current_season: 2026, current_week: 6 },
  ] });
  const seen = new Map();
  let failing = true;
  const loadAdvice = async ({ leagueId }) => {
    if (leagueId === 3 && failing) throw new Error('projection read failed');
    return { season: 2026, week: 6, suggestions: [suggestion(1, 3, 0.92)] };
  };
  await captureOverrides({ seen, db: world.fake, now: TICK, loadAdvice }); // does not throw
  assert.equal(world.rows.length, 1, "league 4's pair was written");
  assert.deepEqual(errors.mock.calls[0].arguments.slice(1), [3, 'projection read failed']);
  failing = false;
  await captureOverrides({ seen, db: world.fake, now: new Date(TICK.getTime() + 5 * 60000), loadAdvice });
  assert.equal(world.rows.length, 2, "league 3's pair was written on the next tick");
});

const recordFake = (rows) => createFakePool([[/^SELECT "called", "outcome" FROM "lineup_overrides"/, () => ({ rows })]]);

test('loadSeasonRecord sums resolved Overrides and Called shots apart, with the current hit streak', async () => {
  const record = await loadSeasonRecord(recordFake([
    { called: false, outcome: 'hit' }, { called: false, outcome: 'hit' }, { called: false, outcome: 'miss' },
    { called: true, outcome: 'miss' }, { called: true, outcome: 'hit' }, { called: true, outcome: 'hit' },
  ]), { leagueId: 3, teamId: 10, season: 2026 });
  assert.deepEqual(record, {
    overrides: { hits: 2, misses: 1 },
    calledShots: { hits: 2, resolved: 3, streak: 2 },
  });
});

test('loadSeasonRecord is null on a side with nothing resolved', async () => {
  assert.deepEqual(await loadSeasonRecord(recordFake([]), { leagueId: 3, teamId: 10, season: 2026 }), { overrides: null, calledShots: null });
  const onlyCalled = await loadSeasonRecord(recordFake([{ called: true, outcome: 'miss' }]), { leagueId: 3, teamId: 10, season: 2026 });
  assert.deepEqual(onlyCalled, { overrides: null, calledShots: { hits: 0, resolved: 1, streak: 0 } });
});

test('f1: a kickoff is captured once, so a later tick whose advice names a new pair inserts nothing', async () => {
  const world = captureWorld();
  const seen = new Map();
  await captureOverrides({ seen, db: world.fake, now: TICK, loadAdvice: adviceOf([suggestion(1, 3, 0.92)]) });
  assert.equal(world.rows.length, 1);
  // The manager changes his lineup after the kickoff: the next tick's advice names a different pair.
  const changed = async () => assert.fail('a captured kickoff is not asked again');
  await captureOverrides({ seen, db: world.fake, now: new Date(TICK.getTime() + 5 * 60000), loadAdvice: changed });
  assert.equal(world.fake.matching(/^INSERT INTO "lineup_overrides"/).length, 1);
  assert.equal(world.rows.length, 1);
});

test('the called row moves its capture time at the first kickoff only, not again at a later one the same week', async () => {
  const declared = new Date('2026-10-09T12:00:00.000Z');
  const world = captureWorld({
    games: [{ nfl_team: 'BUF', kickoff_at: T }, { nfl_team: 'KC', kickoff_at: new Date(T.getTime() + 3 * 3600000) }],
    rows: [{ key: '3:2026:6:10:RB:1:3', called: true, starter: 1, benched: 3, declared_at: declared, captured_at: declared }],
  });
  const seen = new Map();
  const loadAdvice = adviceOf([suggestion(1, 3, 0.92)]);
  await captureOverrides({ seen, db: world.fake, now: TICK, loadAdvice }); // BUF kicks off
  await captureOverrides({ seen, db: world.fake, now: new Date(T.getTime() + 3 * 3600000 + 180000), loadAdvice }); // KC, same pair
  assert.deepEqual(world.rows[0].captured_at, TICK);
  assert.equal(world.rows.length, 1);
});
