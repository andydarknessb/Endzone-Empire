const { test } = require('node:test');
const assert = require('node:assert/strict');
const draftService = require('../services/draft.service');
const { autoPick, compareAutopickCandidates } = require('../services/autopick.service');
const { installAutopickPool } = require('./helpers/autopickFixtures');
const draftEvents = require('../modules/draftEvents');
const ioRegistry = require('../modules/io');

test('autoPick: an empty queue chooses a no-ADP player with points over a no-ADP player with neither', async (t) => {
  const withPoints = { id: 2, name: 'Has Points', adp: null, queue_rank: null, last_season_points: '50.0' };
  const withNeither = { id: 3, name: 'Has Neither', adp: null, queue_rank: null, last_season_points: null };
  installAutopickPool(t, { candidates: [withNeither, withPoints] }); // seeded out of order

  const picks = [];
  t.mock.method(draftService, 'draftPlayer', async ({ playerId }) => {
    picks.push(playerId);
    return { player: { id: playerId }, draftComplete: false };
  });

  const outcome = await autoPick({ leagueId: 1 });

  assert.deepEqual(picks, [2]); // picked Has Points on the first try
  assert.equal(outcome.player.id, 2);
});

test('autoPick: never reaches for a (c)-shaped player while any ADP/production candidate remains, even after a snipe', async (t) => {
  const hasAdp = { id: 1, name: 'Has ADP', adp: '5.0', queue_rank: null, last_season_points: null };
  const noAdpPoints = { id: 2, name: 'No ADP, Points', adp: null, queue_rank: null, last_season_points: '50.0' };
  const neither = { id: 3, name: 'Neither', adp: null, queue_rank: null, last_season_points: null };
  installAutopickPool(t, { candidates: [neither, noAdpPoints, hasAdp] }); // seeded out of order

  const attempts = [];
  t.mock.method(draftService, 'draftPlayer', async ({ playerId }) => {
    attempts.push(playerId);
    // The top choice (highest ADP-ranked) gets sniped; autopick must fall
    // through to the next-best candidate, never straight to the (c) player.
    if (playerId === 1) {
      const err = new Error('player is already rostered in this league');
      err.statusCode = 409;
      throw err;
    }
    return { player: { id: playerId }, draftComplete: false };
  });

  const outcome = await autoPick({ leagueId: 1 });

  assert.deepEqual(attempts, [1, 2]); // tried the ADP player, sniped, then the producer — never id 3
  assert.equal(outcome.player.id, 2);
});

test('autoPick: a queued player is chosen over best available, regardless of ADP/points', async (t) => {
  const queued = { id: 9, name: 'Queued Pick', adp: null, queue_rank: 1, last_season_points: null };
  const betterAdp = { id: 1, name: 'Better ADP', adp: '1.0', queue_rank: null, last_season_points: null };
  installAutopickPool(t, { candidates: [betterAdp, queued] });

  const picks = [];
  t.mock.method(draftService, 'draftPlayer', async ({ playerId }) => {
    picks.push(playerId);
    return { player: { id: playerId }, draftComplete: false };
  });

  await autoPick({ leagueId: 1 });

  assert.deepEqual(picks, [9]); // the team's own queue wins over best available
});

test('autoPick: id never decides order between two otherwise-tied best-available candidates', async (t) => {
  // Same ADP, same points, differing only by id/name — name must decide, not id.
  const higherId = { id: 99, name: 'Aaron', adp: '10.0', queue_rank: null, last_season_points: null };
  const lowerId = { id: 1, name: 'Zeke', adp: '10.0', queue_rank: null, last_season_points: null };
  installAutopickPool(t, { candidates: [lowerId, higherId] });

  const picks = [];
  t.mock.method(draftService, 'draftPlayer', async ({ playerId }) => {
    picks.push(playerId);
    return { player: { id: playerId }, draftComplete: false };
  });

  await autoPick({ leagueId: 1 });

  assert.deepEqual(picks, [99]); // "Aaron" (id 99) sorts before "Zeke" (id 1) by name
});

test('autoPick returns null when nothing is draftable', async (t) => {
  installAutopickPool(t, { candidates: [] });
  const outcome = await autoPick({ leagueId: 1 });
  assert.equal(outcome, null);
});

test('autoPick publishes the committed pick when the worker has no local Socket.IO server', async (t) => {
  installAutopickPool(t, {
    candidates: [{ id: 8, name: 'Worker Pick', adp: '1.0', queue_rank: null, last_season_points: null }],
  });
  t.mock.method(ioRegistry, 'getIo', () => null);
  const published = [];
  t.mock.method(draftEvents, 'publishDraftEvent', async (event) => {
    published.push(event);
  });
  const outcome = {
    leagueId: 1,
    teamId: 55,
    player: { id: 8, name: 'Worker Pick' },
    draftComplete: false,
  };
  t.mock.method(draftService, 'draftPlayer', async () => outcome);

  await autoPick({ leagueId: 1 });

  assert.deepEqual(published, [{
    leagueId: 1,
    event: 'draft:picked',
    payload: { ...outcome, auto: true },
  }]);
});

// ---- compareAutopickCandidates (pure) --------------------------------------

test('compareAutopickCandidates: a queued rank always sorts before an unqueued candidate', () => {
  const queued = { queue_rank: 3, adp: null, last_season_points: null, name: 'Q' };
  const unqueued = { queue_rank: null, adp: '1.0', last_season_points: null, name: 'U' };
  assert.ok(compareAutopickCandidates(queued, unqueued) < 0);
});

test('compareAutopickCandidates: among queued candidates, lower rank sorts first', () => {
  const first = { queue_rank: 1, adp: null, last_season_points: null, name: 'A' };
  const second = { queue_rank: 2, adp: null, last_season_points: null, name: 'B' };
  assert.ok(compareAutopickCandidates(first, second) < 0);
});

test('compareAutopickCandidates: among unqueued candidates, falls through to best-available order', () => {
  const hasAdp = { queue_rank: null, adp: '5.0', last_season_points: null, name: 'A' };
  const noAdp = { queue_rank: null, adp: null, last_season_points: '10', name: 'B' };
  assert.ok(compareAutopickCandidates(hasAdp, noAdp) < 0);
});
