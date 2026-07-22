const test = require('node:test');
const assert = require('node:assert/strict');
const { byeWeekFromPlayedWeeks, REG_SEASON_WEEKS } = require('../services/bye.service');

const fullSeason = () => new Set(Array.from({ length: REG_SEASON_WEEKS }, (_, i) => i + 1));

test('byeWeekFromPlayedWeeks returns the first missing regular-season week', () => {
  const weeks = fullSeason();
  weeks.delete(6);
  assert.equal(byeWeekFromPlayedWeeks(weeks), 6);
});

test('byeWeekFromPlayedWeeks accepts an iterable and coerces week numbers', () => {
  // Missing week 6 (first gap) among an array of string/number weeks.
  assert.equal(byeWeekFromPlayedWeeks(['1', 2, '3', 4, 5, 7, 8]), 6);
});

test('byeWeekFromPlayedWeeks returns null when the schedule is unknown (no games)', () => {
  assert.equal(byeWeekFromPlayedWeeks(new Set()), null);
  assert.equal(byeWeekFromPlayedWeeks([]), null);
  assert.equal(byeWeekFromPlayedWeeks(null), null);
  assert.equal(byeWeekFromPlayedWeeks(undefined), null);
});

test('byeWeekFromPlayedWeeks returns null when every week is played (no bye)', () => {
  assert.equal(byeWeekFromPlayedWeeks(fullSeason()), null);
});
