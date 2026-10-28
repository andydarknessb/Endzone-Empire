const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const projectionService = require('../services/projection.service');
const lineupService = require('../services/lineup.service');
const { upgradesFor, upgradeOver } = require('../services/upgrade.service');

const slots = (...specs) => specs.map(([key, count, eligiblePositions]) => ({ key, label: key, count, eligiblePositions }));
const RB1 = slots(['RB', 1, ['RB']]);

// ---------------------------------------------------------------------------
// upgradeOver: pure, a stub run and no pool. `players` maps id to the run's
// number and, optionally, its Start verdict.
// ---------------------------------------------------------------------------

const AVAILABLE = { outcome: 'recommendable', reason: null, numberTrusted: true };
const stubRun = (players) => ({
  pointsFor: (id) => (players[id] ? players[id].points : null),
  startVerdictFor: (id) => (players[id] && players[id].verdict) || AVAILABLE,
});
const row = (playerId, position, slot, extra = {}) => ({
  playerId, name: `p${playerId}`, position, slot, kickedOff: false, ...extra,
});
const OUT = { outcome: 'unavailable', reason: 'out', numberTrusted: false };
const BACKUP = { outcome: 'not_recommended', reason: 'backup', numberTrusted: false };
const BASELINE = { outcome: 'not_recommended', reason: 'position_baseline', numberTrusted: false };
const DOUBTFUL = { outcome: 'not_recommended', reason: 'doubtful', numberTrusted: true };

test('upgradeOver: an Unavailable starter counts as zero, so a healthy bench player fills his slot and is netted out', () => {
  // The engine keeps the Out starter's full 20; counted at 20 he would hide every Upgrade.
  const roster = [row(1, 'RB', 'RB'), row(2, 'RB', 'BENCH')];
  const run = (candidate) => stubRun({ 1: { points: 20, verdict: OUT }, 2: { points: 12 }, 99: { points: candidate } });
  const over = (candidate) => upgradeOver({ roster, candidate: { id: 99, position: 'RB' }, run: run(candidate), rosterSlots: RB1 });
  assert.deepEqual(over(10).upgrade, { points: 0, overPlayer: null, slot: null });
  assert.deepEqual(over(15).upgrade, {
    points: 3,
    overPlayer: { id: 2, name: 'p2', points: 12, unavailable: null },
    slot: 'RB',
  });
});

test('upgradeOver: overPlayer carries the Unavailable reason and his zeroed points', () => {
  const { upgrade } = upgradeOver({
    roster: [row(21, 'WR', 'WR')],
    candidate: { id: 99, position: 'WR' },
    run: stubRun({ 21: { points: 15, verdict: { ...OUT, reason: 'bye' } }, 99: { points: 10 } }),
    rosterSlots: slots(['WR', 1, ['WR']]),
  });
  assert.equal(upgrade.points, 10);
  assert.deepEqual(upgrade.overPlayer, { id: 21, name: 'p21', points: 0, unavailable: 'bye' });
});

test('upgradeOver: a rostered Backup quarterback is zeroed, so a starter QB keeps his Upgrade', () => {
  const { upgrade } = upgradeOver({
    roster: [row(1, 'QB', 'QB')],
    candidate: { id: 99, position: 'QB' },
    run: stubRun({ 1: { points: 15, verdict: BACKUP }, 99: { points: 12 } }),
    rosterSlots: slots(['QB', 1, ['QB']]),
  });
  assert.equal(upgrade.points, 12);
  assert.deepEqual(upgrade.overPlayer, { id: 1, name: 'p1', points: 0, unavailable: 'backup' });
});

test('upgradeOver: an Unavailable, Position-baseline or Backup candidate is refused; a Doubtful one keeps his Upgrade', () => {
  const roster = [row(1, 'RB', 'RB')];
  const over = (verdict) => upgradeOver({
    roster, candidate: { id: 99, position: 'RB' }, rosterSlots: RB1, dropPlayerId: 1,
    run: stubRun({ 1: { points: 5 }, 99: { points: 15, verdict } }),
  });
  for (const verdict of [OUT, BASELINE, BACKUP]) assert.deepEqual(over(verdict), { upgrade: null, swapNet: null });
  const doubtful = over(DOUBTFUL);
  assert.equal(doubtful.upgrade.points, 10);
  assert.equal(doubtful.swapNet, 10);
});

test('upgradeOver: a Swap net goes negative when the drop is worth more than the candidate, and is null with no drop', () => {
  const roster = [row(1, 'RB', 'RB'), row(2, 'RB', 'BENCH')];
  const run = stubRun({ 1: { points: 20 }, 2: { points: 5 }, 99: { points: 8 } });
  const args = { roster, candidate: { id: 99, position: 'RB' }, run, rosterSlots: RB1 };
  const withDrop = upgradeOver({ ...args, dropPlayerId: 1 });
  assert.equal(withDrop.swapNet, -12); // RB 8 replaces RB 20
  assert.equal(withDrop.upgrade.points, 0); // the Upgrade never takes the drop
  assert.equal(upgradeOver(args).swapNet, null);
});

test('upgradeOver: a kicked-off starter is pinned and a kicked-off bench player is no lineup candidate', () => {
  const over = (roster, points) => upgradeOver({
    roster, candidate: { id: 99, position: 'RB' }, rosterSlots: RB1, run: stubRun({ ...points, 99: { points: 20 } }),
  }).upgrade;
  assert.deepEqual(over([row(1, 'RB', 'RB', { kickedOff: true })], { 1: { points: 5 } }), { points: 0, overPlayer: null, slot: null });
  assert.equal(over([row(1, 'RB', 'RB'), row(2, 'RB', 'BENCH', { kickedOff: true })], { 1: { points: 5 }, 2: { points: 30 } }).points, 15);
});

test('upgradeOver: overPlayer on a tie does not depend on the input order of the roster', () => {
  const rbs = [row(1, 'RB', 'RB'), row(2, 'RB', 'BENCH')];
  const run = stubRun({ 1: { points: 8 }, 2: { points: 8 }, 99: { points: 12 } });
  const over = (roster) => upgradeOver({ roster, candidate: { id: 99, position: 'RB' }, run, rosterSlots: RB1 });
  assert.deepEqual(over([...rbs].reverse()), over(rbs));
});

test('upgradeOver: a gain that arrives through a FLEX chain is found, and an empty slot has no overPlayer', () => {
  const flex = slots(['RB', 1, ['RB']], ['FLEX', 1, ['RB', 'WR']]);
  const chain = upgradeOver({
    roster: [row(1, 'RB', 'RB'), row(2, 'WR', 'FLEX')],
    candidate: { id: 99, position: 'RB' },
    run: stubRun({ 1: { points: 9 }, 2: { points: 8 }, 99: { points: 20 } }),
    rosterSlots: flex,
  }).upgrade;
  assert.equal(chain.points, 12);
  assert.equal(chain.overPlayer.id, 2);

  const empty = upgradeOver({
    roster: [row(10, 'RB', 'RB')],
    candidate: { id: 99, position: 'QB' },
    run: stubRun({ 10: { points: 25 }, 99: { points: 18 } }),
    rosterSlots: slots(['RB', 1, ['RB']], ['QB', 1, ['QB']]),
  }).upgrade;
  assert.deepEqual(empty, { points: 18, overPlayer: null, slot: 'QB' });
});

// ---------------------------------------------------------------------------
// upgradesFor: the live read over a fake pool. One WR slot, one weak starter
// (999, 5 points), candidates on BUF; the league is in week 1.
// ---------------------------------------------------------------------------

const NOW = new Date('2026-09-13T12:00:00Z');
const WK1_AFTER_NOW = '2026-09-13T17:00:00Z';
const WK1_BEFORE_NOW = '2026-09-13T08:00:00Z';
const WK2 = '2026-09-20T17:00:00Z';
const TEAM = { id: 10 };
const CANDIDATE = 55;
const LEAGUE = {
  id: 3,
  current_season: 2026,
  current_week: 1,
  best_ball: false,
  regular_season_weeks: 14,
  playoff_teams: 4,
  waivers_clear_at: null,
  roster_slots: slots(['WR', 1, ['WR']]),
};
const game = (nfl_team, week, kickoff_at) => ({ nfl_team, week, kickoff_at: new Date(kickoff_at) });

function world(t, { league = LEAGUE, schedule, waiverRows = [], ownRosterRows = [], identitiesById = {}, nflTeam = 'BUF', candidates = [CANDIDATE] }) {
  createFakePool([
    [/^SELECT "nfl_team", "week", "kickoff_at" FROM "nfl_games"/, () => ({ rows: schedule })],
    [/^SELECT "player_id", "available_at" FROM "waiver_players"/, () => ({ rows: waiverRows })],
    [/^SELECT "player_id" FROM "team_players" WHERE "league_id"/, () => ({ rows: [] })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({
      rows: [{ player_id: 999, slot: 'WR', name: 'Weak Starter', position: 'WR', nfl_team: null }],
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({ rows: [] })],
    // Every players row sharing a candidate's identity: the scalar form for one id, the batch form for many.
    [/^WITH "target" AS \(/, (text, params) => (text.includes('ANY($1::int[])')
      ? { rows: params[0].flatMap((id) => (identitiesById[id] || [id]).map((identity_id) => ({ requested_id: id, identity_id }))) }
      : { rows: (identitiesById[params[0]] || [params[0]]).map((id) => ({ id })) })],
    [/^SELECT "player_id" FROM "team_players" WHERE "team_id" = \$1$/, () => ({ rows: ownRosterRows })],
    [/^SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY/, () => ({
      rows: candidates.map((id) => ({ id, position: 'WR', nfl_team: nflTeam })),
    })],
  ]).install(t);
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  const calls = [];
  t.mock.method(projectionService, 'getWeeklyProjections', async (options) => {
    calls.push(options);
    const points = (id) => (id === 999 ? 5 : (options.week === 1 ? 14 : 11));
    return projectionService.toWeeklyProjectionResult({
      projections: new Map(options.playerIds.map((id) => [id, {
        mean: points(id), median: points(id), factors: { availability: { available: true } },
      }])),
    });
  });
  return { calls, league };
}

const read = (league, ids = [CANDIDATE]) => upgradesFor({ league, team: TEAM, week: 1, candidateIds: ids, now: NOW });

test('upgradesFor: a waiver candidate is read in the week his Clear time lands in and carries it as `week`', async (t) => {
  const schedule = [game('BUF', 1, WK1_AFTER_NOW), game('BUF', 2, WK2)];
  world(t, { schedule, waiverRows: [{ player_id: CANDIDATE, available_at: new Date('2026-09-14T00:00:00Z') }] });
  const { upgrades, pointsFor } = await read(LEAGUE);
  assert.deepEqual(upgrades.get(CANDIDATE), {
    points: 6, overPlayer: { id: 999, name: 'Weak Starter', points: 5, unavailable: null }, slot: 'WR', week: 2,
  });
  assert.equal(pointsFor(CANDIDATE), 11, 'the tie-break number is his own week\'s read');
});

test('upgradesFor: a candidate on the caller\'s roster under a duplicate identity id gets null', async (t) => {
  world(t, {
    schedule: [game('BUF', 1, WK1_AFTER_NOW)],
    identitiesById: { [CANDIDATE]: [CANDIDATE, 5500] },
    ownRosterRows: [{ player_id: 5500 }],
  });
  const { upgrades } = await read(LEAGUE);
  assert.equal(upgrades.get(CANDIDATE), null);
});

test('upgradesFor: in a batch, the duplicate-identity candidate gets null and an unrelated one keeps a real Upgrade', async (t) => {
  world(t, {
    schedule: [game('BUF', 1, WK1_AFTER_NOW)],
    candidates: [CANDIDATE, 56],
    identitiesById: { [CANDIDATE]: [CANDIDATE, 5500] },
    ownRosterRows: [{ player_id: 5500 }],
  });
  const { upgrades } = await read(LEAGUE, [CANDIDATE, 56]);
  assert.equal(upgrades.get(CANDIDATE), null, 'his sibling identity row is already on the caller\'s roster');
  assert.equal(upgrades.get(56).points, 9, 'an unrelated candidate still gets his Upgrade (WR 14 over WR 5)');
});

test('upgradesFor: a best ball league gets null for every candidate', async (t) => {
  world(t, { schedule: [game('BUF', 1, WK1_AFTER_NOW)] });
  const { upgrades, swapNets } = await read({ ...LEAGUE, best_ball: true }, [CANDIDATE, 56]);
  assert.deepEqual([...upgrades], [[CANDIDATE, null], [56, null]]);
  assert.equal(swapNets.size, 0);
});

test('upgradesFor: run is the current week\'s read, one getWeeklyProjections call for it', async (t) => {
  const { calls } = world(t, { schedule: [game('BUF', 1, WK1_BEFORE_NOW), game('BUF', 2, WK2)] });
  const { upgrades, run } = await read(LEAGUE);
  assert.equal(upgrades.get(CANDIDATE).week, 2);
  assert.deepEqual(calls.map((c) => c.week), [1, 2]);
  assert.equal(calls.filter((c) => c.week === 1).length, 1);
  assert.equal(run.pointsFor(CANDIDATE), 14, 'run is week 1\'s read even when the candidate is read in week 2');
});

test('upgradesFor: a drop adds the Swap net in the candidate\'s own week', async (t) => {
  world(t, { schedule: [game('BUF', 1, WK1_AFTER_NOW)] });
  const { swapNets } = await upgradesFor({
    league: LEAGUE, team: TEAM, week: 1, candidateIds: [CANDIDATE], dropPlayerId: 999, now: NOW,
  });
  assert.deepEqual(swapNets.get(CANDIDATE), { points: 9, week: 1 }); // WR 14 replaces WR 5
});

test('upgradesFor: a candidate with No NFL team gets null: the engine still carries his old pace', async (t) => {
  world(t, { schedule: [game('BUF', 1, WK1_AFTER_NOW)], nflTeam: null });
  const { upgrades } = await read(LEAGUE);
  assert.equal(upgrades.get(CANDIDATE), null);
});
