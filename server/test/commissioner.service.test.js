'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const commissioner = require('../services/commissioner.service');
const settleFollowUpSvc = require('../services/settleFollowUp.service');

// The commissioner tools run through the League write (ADR 0070). Every League
// write takes the League-row lock as the first statement after BEGIN, including
// the League-wide Roster lock toggle, which took no lock before this change.

const LEAGUE_ID = 1;
const USER_ID = 7;
const LOCK = /^(?:(?:SELECT \* FROM "leagues" WHERE "id" = \$1 FOR NO KEY UPDATE|UPDATE "leagues" SET "board_version" = "board_version" \+ 1 WHERE "id" = \$1 RETURNING \*)|UPDATE "leagues" SET "board_version" = "board_version" \+ 1 WHERE "id" = \$1 RETURNING \*)$/;
const COMMISSIONER_CHECK = /^SELECT \*, .* AS "is_commissioner" FROM "leagues" WHERE "id" = \$1$/;

test('setTransactionsLocked takes the League lock before its commissioner check and its write', async (t) => {
  const fake = createFakePool([
    [LOCK, () => ({ rows: [{ id: LEAGUE_ID }] }), 'client'],
    [COMMISSIONER_CHECK, () => ({ rows: [{ id: LEAGUE_ID, is_commissioner: true }] }), 'client'],
    [/^UPDATE "leagues" SET "transactions_locked"/, () => ({ rows: [] }), 'client'],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] }), 'client'],
  ]).install(t);

  await commissioner.setTransactionsLocked({ leagueId: LEAGUE_ID, userId: USER_ID, locked: true });

  const texts = fake.calls.map((c) => c.text);
  assert.equal(texts[0], 'BEGIN', 'the write opens its transaction first');
  assert.match(texts[1], LOCK, 'the League row is locked before the commissioner check');
  assert.match(texts[2], COMMISSIONER_CHECK, 'the commissioner check reads the row the write holds');
  fake.assertClean();
});

test('adjustMatchupScore queues the correction follow-up after its commit (#2750)', async (t) => {
  // 2026-11-10 is a Tuesday: the correction window that lets a score change for last week.
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T12:00:00.000Z') });
  const fake = createFakePool([
    [LOCK, () => ({ rows: [{ id: LEAGUE_ID }] }), 'client'],
    [COMMISSIONER_CHECK, () => ({ rows: [{ id: LEAGUE_ID, current_season: 2026, current_week: 9, is_commissioner: true }] }), 'client'],
    [/^SELECT "season", "week" FROM "matchups"/, () => ({ rows: [{ season: 2026, week: 8 }] }), 'client'],
    [/^UPDATE "matchups" SET "home_score"/, () => ({ rows: [{ id: 77, home_score: 50, away_score: 40 }] }), 'client'],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] }), 'client'],
  ]).install(t);
  const followUps = [];
  t.mock.method(settleFollowUpSvc, 'settleFollowUp', async (args) => {
    followUps.push({ ...args, committed: fake.calls.some((c) => c.text === 'COMMIT') });
  });

  await commissioner.adjustMatchupScore({
    leagueId: LEAGUE_ID, userId: USER_ID, matchupId: 77, homeScore: 50, awayScore: 40,
  });

  assert.deepEqual(followUps, [
    { leagueId: LEAGUE_ID, season: 2026, week: 8, mode: 'correction', committed: true },
  ], 'one correction follow-up, for the matchup week, and only once the commit has landed');
  fake.assertClean();
});
