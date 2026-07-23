const test = require('node:test');
const assert = require('node:assert/strict');
const { byeWeekFromPlayedWeeks, REG_SEASON_WEEKS } = require('../services/bye.service');

const fullSeason = () => new Set(Array.from({ length: REG_SEASON_WEEKS }, (_, i) => i + 1));

test('byeWeekFromPlayedWeeks returns the sole missing regular-season week', () => {
  const weeks = fullSeason();
  weeks.delete(6);
  assert.equal(byeWeekFromPlayedWeeks(weeks), 6);
});

test('byeWeekFromPlayedWeeks accepts an iterable and coerces week numbers', () => {
  const weeks = [...fullSeason()];
  weeks.splice(5, 1);
  assert.equal(byeWeekFromPlayedWeeks(weeks.map((week, index) => (index % 2 ? String(week) : week))), 6);
});

test('byeWeekFromPlayedWeeks returns null when an incomplete schedule has a non-bye gap', () => {
  const weeks = fullSeason();
  weeks.delete(6); // actual bye
  weeks.delete(10); // missing nfl_games row for a game week
  assert.equal(byeWeekFromPlayedWeeks(weeks), null);
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
