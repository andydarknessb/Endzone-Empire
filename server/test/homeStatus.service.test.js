const { test } = require('node:test');
const assert = require('node:assert/strict');
const homeStatus = require('../services/homeStatus.service');

/**
 * homeStatus.service: the builders the digest, the Home to-do list and the
 * league status cards share. Pure over rows, so every case here is a fixture
 * in and an answer out; the routes that batch the reads have their own
 * supertest suites.
 */

const slots = (spec) => Object.entries(spec).map(([key, count]) => ({ key, count }));
const entry = (slot, name, extra = {}) => ({ slot, name, onBye: false, injury_status: null, ...extra });

// --- extracted from the digest (behaviour pinned before anything is added) --

test('leagueLineupProblems checks a standard league in full against its roster slots', () => {
  const problems = homeStatus.leagueLineupProblems({
    entries: [entry('QB', 'Quarterback', { onBye: true })],
    rosterSlots: slots({ QB: 1, RB: 1 }),
    bestBall: false,
  });
  assert.deepEqual(problems, ['1 empty RB slot', 'Quarterback (QB) is on bye']);
});

test('leagueLineupProblems gives a best-ball league only its unresolved IR stashes', () => {
  const problems = homeStatus.leagueLineupProblems({
    entries: [
      entry('QB', 'Benched By Optimizer', { injury_status: 'O' }),
      entry('IR', 'Healthy Stash', { injury_status: 'Q', ir_attested: false }),
    ],
    rosterSlots: slots({ QB: 1, RB: 2 }),
    bestBall: true,
  });
  assert.deepEqual(problems, ['Healthy Stash (IR) is no longer IR-eligible (questionable)']);
});

test('lineupEntryFromRow reads the digest query row into the builder shape', () => {
  assert.deepEqual(
    homeStatus.lineupEntryFromRow({ slot: 'RB', name: 'Runner', on_bye: true, injury_status: 'Q', ir_attested: false, extra: 1 }),
    { slot: 'RB', name: 'Runner', onBye: true, injury_status: 'Q', ir_attested: false }
  );
});

test('openGameKeys drops games at or past kickoff; missingPicks drops the ones already picked', () => {
  const now = new Date('2026-10-04T17:00:00.000Z');
  const slate = [
    { gameKey: 'BUF|MIA', kickoffAt: '2026-10-04T16:59:00.000Z' },
    { gameKey: 'DAL|NYG', kickoffAt: '2026-10-04T17:00:00.000Z' }, // locks inclusively
    { gameKey: 'KC|LV', kickoffAt: '2026-10-04T20:25:00.000Z' },
    { gameKey: 'GB|MIN', kickoffAt: '2026-10-05T00:20:00.000Z' },
  ];
  const open = homeStatus.openGameKeys(slate, now);
  assert.deepEqual(open, ['KC|LV', 'GB|MIN']);
  const made = homeStatus.picksMadeByUser([
    { user_id: 7, team_pair: 'KC|LV' },
    { user_id: 7, team_pair: 'BUF|MIA' },
    { user_id: 8, team_pair: 'GB|MIN' },
  ]);
  assert.deepEqual(homeStatus.missingPicks(open, made.get(7)), ['GB|MIN']);
  assert.deepEqual(homeStatus.missingPicks(open, made.get(9)), ['KC|LV', 'GB|MIN']);
});
