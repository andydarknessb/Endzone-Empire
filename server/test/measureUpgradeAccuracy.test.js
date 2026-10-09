const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, measureUpgradeAccuracy } = require('../scripts/measure-upgrade-accuracy');

// One RB slot and a bench: the Upgrade is the candidate's number over the
// starter he beats, so every expected value below is a subtraction.
const RB1 = [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }];

// The week input: the stored lineup without the acquired player. `projection`
// is what the stored run said, `actual` what the player scored as played.
const starter = (projection, actual = projection) => ({
  playerId: 1, name: 'Starter', position: 'RB', slot: 'RB', projection, actual, unavailable: null, kickedOff: false,
});

const acquisition = (overrides) => ({
  playerId: 99, position: 'RB', rosterSlots: RB1, ...overrides,
});

test('(a) a candidate who had kicked off before the claim is a false promise under the old rule only', () => {
  // Week 4: his game was played before the claim, so the old rule still prices
  // him at 15 against the starter's 10 (+5). His first playable week is 5,
  // where he projects 8 and adds nothing; he scores 6 and still adds nothing.
  const result = measureUpgradeAccuracy([acquisition({
    acquiredWeek: 4,
    firstPlayableWeek: 5,
    weeks: {
      4: { roster: [starter(10)], predicted: 15, actual: 20 },
      5: { roster: [starter(10)], predicted: 8, actual: 6 },
    },
  })]);
  assert.equal(result.old.positive, 1);
  assert.equal(result.old.falsePromises, 1);
  assert.equal(result.old.falsePromiseShare, 1);
  assert.equal(result.new.positive, 0);
  assert.equal(result.new.falsePromises, 0);
  assert.equal(result.new.falsePromiseShare, null);
});

test('(b) a candidate who realized exactly his prediction contributes zero error to both rules', () => {
  const result = measureUpgradeAccuracy([acquisition({
    acquiredWeek: 6,
    firstPlayableWeek: 6,
    weeks: { 6: { roster: [starter(10)], predicted: 14, actual: 14 } },
  })]);
  assert.equal(result.count, 1);
  assert.equal(result.old.mae, 0);
  assert.equal(result.new.mae, 0);
});

test('(c) the mean absolute error over three acquisitions is the hand-computed value', () => {
  const result = measureUpgradeAccuracy([
    // old = new = 15 - 10 = 5; realized 12 - 9 = 3; error 2 under both rules.
    acquisition({
      acquiredWeek: 3,
      firstPlayableWeek: 3,
      weeks: { 3: { roster: [starter(10, 9)], predicted: 15, actual: 12 } },
    }),
    // old = new = 9 - 8 = 1; realized 10 - 11 < 0 so 0; error 1, a false promise.
    acquisition({
      acquiredWeek: 4,
      firstPlayableWeek: 4,
      weeks: { 4: { roster: [starter(8, 11)], predicted: 9, actual: 10 } },
    }),
    // old: week 5, 20 - 10 = 10. new: week 6, 13 - 10 = 3. realized 16 - 10 = 6.
    // error 4 under the old rule, 3 under the new.
    acquisition({
      acquiredWeek: 5,
      firstPlayableWeek: 6,
      weeks: {
        5: { roster: [starter(10)], predicted: 20, actual: 0 },
        6: { roster: [starter(10)], predicted: 13, actual: 16 },
      },
    }),
  ]);
  assert.equal(result.count, 3);
  assert.equal(result.old.mae, 2.33); // (2 + 1 + 4) / 3
  assert.equal(result.new.mae, 2); // (2 + 1 + 3) / 3
  assert.equal(result.old.falsePromises, 1);
  assert.equal(result.old.positive, 3);
  assert.equal(result.new.falsePromises, 1);
  assert.equal(result.new.positive, 3);
});

test('a candidate with no playable week left realizes nothing and the new rule promises nothing', () => {
  const result = measureUpgradeAccuracy([acquisition({
    acquiredWeek: 17,
    firstPlayableWeek: null,
    weeks: { 17: { roster: [starter(10)], predicted: 15, actual: 0 } },
  })]);
  assert.equal(result.old.mae, 5);
  assert.equal(result.old.falsePromises, 1);
  assert.equal(result.new.mae, 0);
  assert.equal(result.new.positive, 0);
});

test('an empty input reports no error and no share rather than NaN', () => {
  const result = measureUpgradeAccuracy([]);
  assert.deepEqual(result, {
    count: 0,
    old: { mae: null, positive: 0, falsePromises: 0, falsePromiseShare: null },
    new: { mae: null, positive: 0, falsePromises: 0, falsePromiseShare: null },
  });
});

test('parseArgs reads league, season and the week range, and refuses a missing league', () => {
  assert.deepEqual(
    parseArgs(['--league', '7', '--season', '2026', '--from-week', '2', '--to-week', '5']),
    { help: false, league: 7, season: 2026, fromWeek: 2, toWeek: 5 }
  );
  assert.equal(parseArgs(['--help']).help, true);
  assert.throws(() => parseArgs(['--season', '2026']), /--league/);
  assert.throws(() => parseArgs(['--league', 'x', '--season', '2026']), /--league/);
});
