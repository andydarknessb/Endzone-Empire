/**
 * #1856: the called-shot routes (POST and DELETE /api/team/lineup/called-shot),
 * the advice's `calledShot` payload and pin, and the rule that a lineup save
 * and the void of the shot it contradicts commit or roll back together (ADR
 * 0058). The pool is the shared fake: every statement
 * lands in `fake.calls`; `world.calledRow` is the one lineup_overrides row the
 * handlers serve, written by the INSERT and cleared by the DELETE.
 */
const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { signToken } = require('../modules/auth');
const lineupService = require('../services/lineup.service');
const projectionService = require('../services/projection.service');
const model = require('../services/projectionModel');
const { createFakePool } = require('./helpers/fakePool');
const teamRouter = require('../routes/team.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'called-shot-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);
const auth = () => ({ Authorization: `Bearer ${signToken({ id: 7, username: 'member' })}` });

const ROSTER_SLOTS = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }];
const LEAGUE = { id: 3, current_season: 2026, current_week: 6, best_ball: false, scoring_rules: null };

const lineupEntry = (id, position, slot, nflTeam = 'BUF') => ({
  id, name: `p${id}`, position, nfl_team: nflTeam, slot, injury_status: null, locked: false, onBye: false, bye_week: null,
});
const projectionFor = (playerId, median) => ({
  playerId, modelVersion: model.MODEL_VERSION, mean: median,
  p10: median - 6, p25: median - 3, median, p75: median + 3, p90: median + 6,
  activeProbability: 1, confidence: 'medium', sampleSize: 5,
  factors: { opponent: { available: true, pointsContribution: 0.8, opponentTeam: 'NYJ' } },
});

// A starter (1, RB slot) the Forecast would replace with bench player 3.
const clearEdge = [[1, projectionFor(1, 6)], [3, projectionFor(3, 18)]];
const tossUp = [[1, projectionFor(1, 10)], [3, projectionFor(3, 10.5)]];

const joinedRow = (over = {}) => ({
  id: 41, team_id: 10, season: 2026, week: 6, slot: 'RB',
  starter_player_id: 1, benched_player_id: 3,
  starter_point_estimate: '6.00', benched_point_estimate: '18.00', probability: '0.9200', verdict: 'start',
  declared_at: '2026-10-08T12:00:00.000Z', outcome: 'pending',
  starter_points_actual: null, benched_points_actual: null, resolved_at: null,
  starter_name: 'p1', starter_nfl_team: 'BUF', benched_name: 'p3', benched_nfl_team: 'BUF',
  ...over,
});

function mountWorld(t, {
  projections = clearEdge,
  entries = [lineupEntry(1, 'RB', 'RB'), lineupEntry(3, 'RB', 'BENCH')],
  calledRow = null,
  kickedOff = [],
  league = LEAGUE,
  team = { id: 10 },
  settled = false,
  actualStats = [],
  extra = [],
} = {}) {
  const world = { calledRow };
  const fake = createFakePool([
    ...extra,
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [league] })],
    [/^SELECT "id" FROM "teams"/, () => ({ rows: team ? [team] : [] })],
    [/^SELECT "id", "nfl_team" FROM "players"/, (text, params) => ({
      rows: entries.filter((e) => params[0].includes(e.id)).map((e) => ({ id: e.id, nfl_team: e.nfl_team })),
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: kickedOff.map((nfl_team) => ({ nfl_team })) })],
    [/^SELECT .*FROM "lineup_overrides"/, () => ({ rows: world.calledRow ? [world.calledRow] : [] })],
    [/^DELETE FROM "lineup_overrides" WHERE "league_id"/, () => { world.calledRow = null; return { rows: [] }; }],
    [/^DELETE FROM "lineup_overrides" WHERE "id"/, () => { world.calledRow = null; return { rows: [] }; }],
    [/^INSERT INTO "lineup_overrides"/, (text, params) => {
      world.calledRow = joinedRow({
        slot: params[4], starter_player_id: params[5], benched_player_id: params[6],
        starter_point_estimate: String(params[7]), benched_point_estimate: String(params[8]),
        probability: String(params[9]), verdict: params[10], declared_at: params[11],
      });
      return { rows: [] };
    }],
    [/^UPDATE "lineup_overrides"/, (text, params) => {
      if (/SET "outcome" = \$1/.test(text)) {
        world.calledRow = {
          ...world.calledRow, outcome: params[0], starter_points_actual: params[1], benched_points_actual: params[2],
          resolved_at: new Date().toISOString(),
        };
      } else {
        world.calledRow = { ...world.calledRow, outcome: 'void', resolved_at: new Date().toISOString() };
      }
      return { rows: [] };
    }],
    [/FROM "matchups"/, () => ({ rows: [{ n: settled ? 1 : 1, all_final: settled }] })],
    [/FROM "player_stats"/, () => ({ rows: actualStats })],
    [/FROM "nfl_games"/, () => ({ rows: entries.map((e) => ({ nfl_team: e.nfl_team, opponent: 'NYJ' })) })],
  ]).install(t);
  t.mock.method(lineupService, 'getLineup', async () => ({
    leagueId: 3, teamId: 10, season: 2026, week: 6, currentWeek: 6,
    rosterSlots: ROSTER_SLOTS, benchSlots: 5, irSlots: 1, entries,
  }));
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => projectionService.toWeeklyProjectionResult({
    season: options.season, week: options.week, modelVersion: model.MODEL_VERSION, scoringHash: 'abc',
    generatedAt: '2026-10-08T12:00:00.000Z', inputCutoff: '2026-10-11T17:00:00.000Z',
    sourceCoverage: {}, projections: new Map(projections),
  }));
  t.mock.method(projectionService, 'getPositionDefense', async () => new Map());
  return { fake, world };
}

const declare = (body) => request(app).post('/api/team/lineup/called-shot').set(auth()).send({ leagueId: 3, ...body });
const withdraw = (query = 'leagueId=3') => request(app).delete(`/api/team/lineup/called-shot?${query}`).set(auth());

test('declare stores the pair with the numbers as they stand and answers the standing shot (#1856)', async (t) => {
  const { fake, world } = mountWorld(t);
  const response = await declare({ starterId: 1, benchedId: 3 });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  const shot = response.body.calledShot;
  assert.equal(shot.status, 'pending');
  assert.equal(shot.canWithdraw, true);
  assert.equal(shot.slot, 'RB');
  assert.equal(shot.starter.playerId, 1);
  assert.equal(shot.starter.projection, 6);
  assert.equal(shot.benched.playerId, 3);
  assert.equal(shot.benched.projection, 18);
  assert.ok(shot.probability > 0.6);
  assert.equal(world.calledRow.verdict, 'strong');
  const [insert] = fake.matching(/^INSERT INTO "lineup_overrides"/);
  assert.equal(insert.via, 'client');
  fake.assertClean();
});

test('declare replaces the team\'s existing called shot in the same transaction (#1856)', async (t) => {
  const { fake, world } = mountWorld(t, {
    calledRow: joinedRow({ starter_player_id: 9, benched_player_id: 8 }),
  });
  const response = await declare({ starterId: 1, benchedId: 3 });

  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(world.calledRow.starter_player_id, 1);
  const order = fake.calls.map((c) => c.text.split(' ').slice(0, 3).join(' '));
  const del = order.findIndex((s) => s === 'DELETE FROM "lineup_overrides"');
  const ins = order.findIndex((s) => s === 'INSERT INTO "lineup_overrides"');
  assert.ok(del > order.indexOf('BEGIN') && ins > del && ins < order.indexOf('COMMIT'));
  fake.assertClean();
});

test('declare can re-call the pair an open shot already holds (#1856)', async (t) => {
  // The advice is asked with the open shot ignored, so its own pair is still a suggestion.
  const { world } = mountWorld(t, { calledRow: joinedRow() });
  const response = await declare({ starterId: 1, benchedId: 3 });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(world.calledRow.starter_player_id, 1);
});

test('declare refuses a tossup pair with a reason and stores nothing (#1856)', async (t) => {
  const { fake } = mountWorld(t, { projections: tossUp });
  const response = await declare({ starterId: 1, benchedId: 3 });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /too close to call/);
  assert.equal(fake.matching(/^INSERT INTO "lineup_overrides"/).length, 0);
});

test('declare refuses a pair the advice does not name (#1856)', async (t) => {
  const { fake } = mountWorld(t, {
    entries: [lineupEntry(1, 'RB', 'RB'), lineupEntry(3, 'RB', 'BENCH'), lineupEntry(4, 'RB', 'BENCH')],
    projections: [...clearEdge, [4, projectionFor(4, 2)]],
  });
  const response = await declare({ starterId: 1, benchedId: 4 });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /does not name that pair/);
  assert.equal(fake.matching(/^INSERT INTO "lineup_overrides"/).length, 0);
});

test('declare refuses once either player has locked (#1856)', async (t) => {
  const { fake } = mountWorld(t, { kickedOff: ['BUF'] });
  const response = await declare({ starterId: 1, benchedId: 3 });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /locked|started/);
  assert.equal(fake.matching(/^INSERT INTO "lineup_overrides"/).length, 0);
});

test('declare refuses a week that is not the current week (#1856)', async (t) => {
  mountWorld(t);
  const response = await declare({ starterId: 1, benchedId: 3, week: 7 });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /current week/);
});

test('declare refuses a caller who manages no team in the league (#1856)', async (t) => {
  mountWorld(t, { team: null });
  const response = await declare({ starterId: 1, benchedId: 3 });
  assert.equal(response.status, 403);
});

test('declare validates its body (#1856)', async (t) => {
  mountWorld(t);
  assert.equal((await declare({ starterId: 1 })).status, 400);
  assert.equal((await declare({ starterId: 1, benchedId: 1 })).status, 400);
  assert.equal((await request(app).post('/api/team/lineup/called-shot').set(auth()).send({ starterId: 1, benchedId: 3 })).status, 400);
});

test('withdraw removes the open shot while neither player has locked (#1856)', async (t) => {
  const { fake, world } = mountWorld(t, { calledRow: joinedRow() });
  const response = await withdraw();
  assert.equal(response.status, 200);
  assert.equal(world.calledRow, null);
  assert.equal(fake.matching(/^DELETE FROM "lineup_overrides" WHERE "id"/).length, 1);
});

test('withdraw is refused after the first of the two players locks (#1856)', async (t) => {
  const { world } = mountWorld(t, { calledRow: joinedRow(), kickedOff: ['BUF'] });
  const response = await withdraw();
  assert.equal(response.status, 409);
  assert.match(response.body.error, /locked|started/);
  assert.ok(world.calledRow, 'the shot stays');
});

test('withdraw answers 404 when no open shot exists or it already resolved (#1856)', async (t) => {
  mountWorld(t);
  assert.equal((await withdraw()).status, 404);
  const { world } = mountWorld(t, { calledRow: joinedRow({ outcome: 'hit' }) });
  assert.equal((await withdraw()).status, 404);
  assert.ok(world.calledRow);
});

test('the advice carries an open shot and pins its pair out of the suggestions and the plan (#1856)', async (t) => {
  mountWorld(t, { calledRow: joinedRow() });
  const response = await request(app).get('/api/team/lineup/advice?leagueId=3').set(auth());
  assert.equal(response.status, 200);
  assert.equal(response.body.calledShot.status, 'pending');
  assert.equal(response.body.calledShot.starter.playerId, 1);
  assert.equal(response.body.calledShot.benched.projection, 18);
  assert.deepEqual(response.body.suggestions, []);
  assert.deepEqual(response.body.movePlan, []);
});

test('the advice reports the shot as locked once either player has kicked off (#1856)', async (t) => {
  mountWorld(t, { calledRow: joinedRow(), kickedOff: ['BUF'] });
  const response = await request(app).get('/api/team/lineup/advice?leagueId=3').set(auth());
  assert.equal(response.body.calledShot.status, 'locked');
  assert.equal(response.body.calledShot.canWithdraw, false);
});

test('the advice carries a stored hit as resolved and never rewrites it (#1860)', async (t) => {
  const { fake, world } = mountWorld(t, {
    calledRow: joinedRow({
      outcome: 'hit', starter_points_actual: '20.00', benched_points_actual: '2.00',
      resolved_at: '2026-10-13T15:00:00.000Z',
    }),
    kickedOff: ['BUF'],
  });
  const response = await request(app).get('/api/team/lineup/advice?leagueId=3').set(auth());
  const shot = response.body.calledShot;
  assert.equal(shot.status, 'resolved');
  assert.equal(shot.outcome, 'hit');
  assert.ok(shot.starter.points > shot.benched.points);
  assert.equal(world.calledRow.outcome, 'hit');
  assert.equal(fake.matching(/^UPDATE "lineup_overrides"/).length, 0);
});

test('the advice leaves a pending shot pending when the week\'s matchups are all final (#1860, ruling on #1879)', async (t) => {
  const { world } = mountWorld(t, {
    calledRow: joinedRow(), settled: true, kickedOff: ['BUF'],
    actualStats: [
      { player_id: 1, stats: { rushingYards: 100 } },
      { player_id: 3, stats: { rushingYards: 20 } },
    ],
  });
  const response = await request(app).get('/api/team/lineup/advice?leagueId=3').set(auth());
  assert.equal(response.body.calledShot.status, 'locked');
  assert.equal(response.body.calledShot.outcome, null);
  assert.equal(world.calledRow.outcome, 'pending');
});

test('the advice still answers when the shot read fails (#1856)', async (t) => {
  t.mock.method(console, 'error', () => {});
  mountWorld(t, {
    extra: [[/^SELECT .*FROM "lineup_overrides"/, () => { throw new Error('relation "lineup_overrides" does not exist'); }]],
  });
  const response = await request(app).get('/api/team/lineup/advice?leagueId=3').set(auth());
  assert.equal(response.status, 200);
  assert.equal(response.body.calledShot, null);
  assert.equal(response.body.suggestions.length, 1);
});

// A saved lineup and the shot path -------------------------------------------

function mountSaveWorld(t, { calledRow = null, failOn = null, kickedOff = [] } = {}) {
  const entries = [
    { player_id: 1, name: 'p1', position: 'RB', nfl_team: 'BUF', injury_status: null, slot: 'RB', ir_attested: false },
    { player_id: 3, name: 'p3', position: 'RB', nfl_team: 'BUF', injury_status: null, slot: 'BENCH', ir_attested: false },
  ];
  const world = { calledRow, slots: new Map(entries.map((e) => [e.player_id, e.slot])) };
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{
      id: 3, current_season: 2026, current_week: 6, roster_slots: ROSTER_SLOTS, bench_slots: 5, ir_slots: 1,
    }] })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: 10 }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({ rows: entries.map(({ player_id, position }) => ({ player_id, position })) })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({ rows: entries.map(({ player_id }) => ({ player_id })) })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((e) => ({ ...e, slot: world.slots.get(e.player_id) })) })],
    [/^SELECT "players"\."position"/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: kickedOff.map((nfl_team) => ({ nfl_team })) })],
    [/^UPDATE "lineup_entries" SET "slot"/, (text, params) => { world.slots.set(params[4], params[0]); return { rows: [] }; }],
    [/^UPDATE "lineup_entries"/, () => ({ rows: [] })],
    [/^SELECT .*FROM "lineup_overrides"/, () => {
      if (failOn === 'read') throw new Error('relation "lineup_overrides" does not exist');
      return { rows: world.calledRow ? [world.calledRow] : [] };
    }],
    [/^UPDATE "lineup_overrides"/, () => {
      if (failOn === 'void') throw new Error('deadlock detected');
      world.calledRow = { ...world.calledRow, outcome: 'void' };
      return { rows: [] };
    }],
  ]).install(t);
  return { fake, world };
}

const saveSwap = () => request(app).put('/api/team/lineup').set(auth()).send({
  leagueId: 3, week: 6, moves: [{ playerId: 3, slot: 'RB' }, { playerId: 1, slot: 'BENCH' }],
});

// ADR 0058: the shot is read and voided on the save's own client, so a failure
// in either refuses the save and rolls the lineup UPDATEs back with it. The
// harness records effects only, so the proof is the statement order: the slot
// UPDATEs, then a ROLLBACK, and no COMMIT. Voiding after the COMMIT (the
// #1856 rule), or on the pool, turns these red.
for (const failOn of ['void', 'read']) {
  test(`a failing shot ${failOn} refuses the save and rolls the lineup UPDATEs back (ADR 0058)`, async (t) => {
    t.mock.method(console, 'error', () => {});
    const { fake } = mountSaveWorld(t, { calledRow: joinedRow(), failOn });
    const response = await saveSwap();
    assert.equal(response.status, 500, JSON.stringify(response.body));
    const texts = fake.calls.map((call) => call.text);
    assert.ok(texts.includes('ROLLBACK'), 'the transaction rolled back');
    assert.ok(!texts.includes('COMMIT'), 'nothing committed');
    if (failOn === 'void') {
      const rollbackAt = texts.indexOf('ROLLBACK');
      assert.ok(texts.findIndex((text) => /^UPDATE "lineup_entries" SET "slot"/.test(text)) < rollbackAt,
        'the slot UPDATEs were issued inside the transaction that rolled back');
    }
    fake.assertClean();
  });
}

test('a saved lineup that contradicts the open shot voids it in the save\'s own transaction (ADR 0058)', async (t) => {
  const { world, fake } = mountSaveWorld(t, { calledRow: joinedRow() });
  const response = await saveSwap();
  assert.equal(response.status, 200);
  assert.equal(world.calledRow.outcome, 'void');
  assert.equal(response.body.calledShotVoided, true);
  assert.equal(response.body.undoable, false);
  assert.deepEqual(response.body.irreversible, ['called_shot']);
  const texts = fake.calls.map((call) => call.text);
  const voidAt = texts.findIndex((text) => /^UPDATE "lineup_overrides" SET "outcome" = 'void'/.test(text));
  assert.equal(fake.calls[voidAt].via, 'client');
  assert.ok(voidAt > texts.indexOf('BEGIN') && voidAt < texts.indexOf('COMMIT'), 'void sits between BEGIN and COMMIT');
});

test('two declares racing for one team-week: the loser is told to try again, not a 500 (#1856)', async (t) => {
  t.mock.method(console, 'error', () => {});
  mountWorld(t, {
    extra: [[/^INSERT INTO "lineup_overrides"/, () => {
      const error = new Error('duplicate key value violates unique constraint');
      error.code = '23505';
      throw error;
    }]],
  });
  const response = await declare({ starterId: 1, benchedId: 3 });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /same moment/);
});

test('declare will not replace a shot that has locked: the miss in progress stays on the record (#1856)', async (t) => {
  const { world, fake } = mountWorld(t, {
    calledRow: joinedRow({ starter_player_id: 9, benched_player_id: 8, starter_nfl_team: 'NYJ' }),
    kickedOff: ['NYJ'],
  });
  const response = await declare({ starterId: 1, benchedId: 3 });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /has locked/);
  assert.equal(world.calledRow.starter_player_id, 9);
  assert.equal(fake.matching(/^DELETE FROM "lineup_overrides"/).length, 0);
});

test('declare will not replace a resolved hit or miss, but does replace a voided row (#1856)', async (t) => {
  const settled = mountWorld(t, { calledRow: joinedRow({ outcome: 'miss', starter_player_id: 9, benched_player_id: 8 }) });
  assert.equal((await declare({ starterId: 1, benchedId: 3 })).status, 409);
  assert.equal(settled.world.calledRow.outcome, 'miss');

  const voided = mountWorld(t, { calledRow: joinedRow({ outcome: 'void', starter_player_id: 9, benched_player_id: 8 }) });
  const response = await declare({ starterId: 1, benchedId: 3 });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(voided.world.calledRow.starter_player_id, 1);
});

test('a lineup save does not void a shot once one of its players has locked (#1856)', async (t) => {
  const { world } = mountSaveWorld(t, { calledRow: joinedRow({ starter_nfl_team: 'NYJ' }), kickedOff: ['NYJ'] });
  const response = await saveSwap();
  assert.equal(response.status, 200);
  assert.equal(world.calledRow.outcome, 'pending');
  assert.equal(response.body.calledShotVoided, false);
});

test('a lineup save with no open shot answers calledShotVoided false (#1969)', async (t) => {
  mountSaveWorld(t);
  const response = await saveSwap();
  assert.equal(response.status, 200);
  assert.equal(response.body.calledShotVoided, false);
});
