const test = require('node:test');
const assert = require('node:assert/strict');
const { openingWeek } = require('../services/openingWeek.service');

// Opening week (ADR 0071): the schedule is one read of nfl_games on the caller's
// client, so each case stubs that read with rows shaped like the query returns
// (one per season and week: first kickoff and last kickoff).
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const WEEK_1_THURSDAY = Date.UTC(2026, 8, 10, 17); // 2026-09-10 17:00Z
const thursday = (week) => WEEK_1_THURSDAY + (week - 1) * 7 * DAY;
const FULL_SEASON = Array.from({ length: 18 }, (_, i) => i + 1);

function weeksOn(season, weeks) {
  return weeks.map((week) => ({
    season,
    week,
    first_kickoff: new Date(thursday(week)),
    last_kickoff: new Date(thursday(week) + 3 * DAY),
  }));
}

function opening(rows, { regularSeasonWeeks = 14, now }) {
  const client = { query: async () => ({ rows }) };
  return openingWeek(client, { regularSeasonWeeks, now: new Date(now) });
}

test('a draft that ends before the season opens opens week 1', async () => {
  const result = await opening(weeksOn(2026, FULL_SEASON), { now: Date.UTC(2026, 7, 1) });
  assert.deepEqual(result, { season: 2026, week: 1, open: true });
});

test('a draft that ends before a Thursday kickoff opens that week', async () => {
  const result = await opening(weeksOn(2026, FULL_SEASON), { now: thursday(5) - HOUR });
  assert.deepEqual(result, { season: 2026, week: 5, open: true });
});

test('a draft that ends after a Thursday kickoff opens the next week', async () => {
  const result = await opening(weeksOn(2026, FULL_SEASON), { now: thursday(5) + HOUR });
  assert.deepEqual(result, { season: 2026, week: 6, open: true });
});

test('a draft that ends after the last game of the season opens next season at week 1', async () => {
  const result = await opening(weeksOn(2026, FULL_SEASON), { now: thursday(18) + 4 * DAY });
  assert.deepEqual(result, { season: 2027, week: 1, open: true });
});

test('no regular-season schedule on file opens the calendar year of now at week 1', async () => {
  const result = await opening([], { now: Date.UTC(2026, 10, 10) });
  assert.deepEqual(result, { season: 2026, week: 1, open: true });
});

test('a schedule loaded to week 3 only opens week 4 once week 3 has kicked off', async () => {
  const result = await opening(weeksOn(2026, [1, 2, 3]), { now: thursday(3) + 4 * DAY });
  assert.deepEqual(result, { season: 2026, week: 4, open: true });
});

test('a missing week below the latest kicked-off week counts as kicked off', async () => {
  const result = await opening(weeksOn(2026, [1, 2, 3, 4, 6, 7, 8, 9, 10]), { now: thursday(8) + HOUR });
  assert.deepEqual(result, { season: 2026, week: 9, open: true });
});

test('every regular-season week kicked off returns the last regular-season week, not open', async () => {
  const result = await opening(weeksOn(2026, FULL_SEASON), { regularSeasonWeeks: 14, now: thursday(14) + 4 * DAY });
  assert.deepEqual(result, { season: 2026, week: 14, open: false });
});
