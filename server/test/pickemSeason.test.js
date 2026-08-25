const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  WEEK_ROLLOVER_GRACE_HOURS,
  deriveNflWeek,
  weekBoundsFromKickoffs,
  FINALIZATION_GRACE_HOURS,
  pickemSeasonComplete,
  pickemChampions,
  seasonOverMessage,
  seasonHasClosed,
} = require('../services/pickemSeason.service');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * A regular season shaped like the real one: week 1's Monday-night game kicks
 * off at 00:15Z Tuesday 2026-09-15 (8:15pm ET Monday), and every later week's
 * last kickoff is exactly seven days on. lastKickoffAt is the MAX kickoff of
 * the week, which is what getSeasonWeekBounds returns.
 */
const WEEK1_MNF = new Date('2026-09-15T00:15:00.000Z');
const mnf = (week) => new Date(WEEK1_MNF.getTime() + (week - 1) * 7 * DAY);
const seasonBounds = (weeks = 18) =>
  Array.from({ length: weeks }, (_, i) => ({ week: i + 1, lastKickoffAt: mnf(i + 1) }));

/* ------------------------------------------------------------------ *
 * deriveNflWeek                                                       *
 * ------------------------------------------------------------------ */

test('deriveNflWeek: no schedule on file gives week 1', () => {
  assert.equal(deriveNflWeek([], new Date('2026-06-01T12:00:00Z')), 1);
});

test('deriveNflWeek follows the NFL calendar', () => {
  const cases = [
    ['before the week 1 kickoff', '2026-09-01T12:00:00Z', 1],
    ['Sunday afternoon of week 3', '2026-09-27T17:00:00Z', 3],
    // The point of the design: the Tuesday between two weeks reports the week
    // managers can pick, not the finished one.
    ['Tuesday noon after week 3 closed', '2026-09-29T16:00:00Z', 4],
    ['during week 3 Monday night football', '2026-09-29T02:30:00Z', 3],
    ['inside the grace after week 3 MNF kicked off', '2026-09-29T05:00:00Z', 3],
    ['the instant the grace expires', '2026-09-29T06:15:00Z', 4],
    ['week 18 Sunday', '2027-01-10T18:00:00Z', 18],
    ['after week 18 plus grace', '2027-02-01T00:00:00Z', 18],
  ];
  for (const [label, at, expected] of cases) {
    assert.equal(deriveNflWeek(seasonBounds(), new Date(at)), expected, label);
  }
});

test('deriveNflWeek honors a custom grace and defaults to WEEK_ROLLOVER_GRACE_HOURS', () => {
  assert.equal(WEEK_ROLLOVER_GRACE_HOURS, 6);
  const at = new Date(mnf(3).getTime() + 5 * HOUR);
  assert.equal(deriveNflWeek(seasonBounds(), at), 3, 'inside the default 6h grace');
  assert.equal(deriveNflWeek(seasonBounds(), at, { graceHours: 4 }), 4, 'a 4h grace has expired');
  assert.equal(deriveNflWeek(seasonBounds(), at, { graceHours: 0 }), 4, 'no grace closes at kickoff');
});

test('deriveNflWeek never leaves 1..18, and a missing week-18 row still lands on 18', () => {
  // Tank01 drops TBD week-18 games, so week 18 can have zero rows while every
  // earlier week has closed. The all-closed fallback is still 18.
  assert.equal(deriveNflWeek(seasonBounds(17), new Date('2027-01-06T12:00:00Z')), 18);
  // Playoff weeks in the bounds never pull the answer past 18.
  const withPlayoffs = seasonBounds().concat([
    { week: 19, lastKickoffAt: new Date('2027-01-19T00:15:00Z') },
    { week: 22, lastKickoffAt: new Date('2027-02-15T00:00:00Z') },
  ]);
  assert.equal(deriveNflWeek(withPlayoffs, new Date('2027-01-14T12:00:00Z')), 18);
  // A stray week-0 row never yields week 0.
  const withZero = [{ week: 0, lastKickoffAt: new Date('2027-03-01T00:00:00Z') }].concat(seasonBounds());
  assert.equal(deriveNflWeek(withZero, new Date('2026-09-01T12:00:00Z')), 1);
  // Bounds arrive from SQL, so week and kickoff may be a string and an ISO
  // string; order of rows is not guaranteed either.
  const shuffled = seasonBounds().reverse().map((b) => ({ week: String(b.week), lastKickoffAt: b.lastKickoffAt.toISOString() }));
  assert.equal(deriveNflWeek(shuffled, new Date('2026-09-27T17:00:00Z')), 3);
});

/* ------------------------------------------------------------------ *
 * weekBoundsFromKickoffs                                               *
 * ------------------------------------------------------------------ */

test('weekBoundsFromKickoffs collapses per-game kickoffs to one bound per week', () => {
  const bounds = weekBoundsFromKickoffs([
    { week: 2, kickoff_at: '2026-09-20T17:00:00.000Z' },
    { week: 2, kickoff_at: '2026-09-22T00:15:00.000Z' },
    { week: 1, kickoff_at: '2026-09-15T00:15:00.000Z' },
    { week: 1, kickoff_at: '2026-09-11T00:20:00.000Z' },
    { week: 1, kickoff_at: '2026-09-13T17:00:00.000Z' },
  ]);
  assert.deepEqual(bounds, [
    { week: 1, lastKickoffAt: new Date('2026-09-15T00:15:00.000Z') },
    { week: 2, lastKickoffAt: new Date('2026-09-22T00:15:00.000Z') },
  ]);
});

test('a game rescheduled out of its week does not hold that week open', () => {
  // The 2020 TEN@PIT shape: a week-4 game moved to the week-7 window keeps its
  // week-4 label in nfl_games. It stays on the week-4 slate for picking, but
  // it must not pin current_week at 4 for three more weeks.
  const rows = [
    { week: 4, kickoff_at: '2026-10-02T00:15:00.000Z' }, // Thu
    { week: 4, kickoff_at: '2026-10-04T17:00:00.000Z' }, // Sun
    { week: 4, kickoff_at: '2026-10-06T00:15:00.000Z' }, // Mon night
    { week: 4, kickoff_at: '2026-10-25T17:00:00.000Z' }, // moved into the week-7 window
    { week: 5, kickoff_at: '2026-10-11T17:00:00.000Z' },
    { week: 5, kickoff_at: '2026-10-13T00:15:00.000Z' },
  ];
  const bounds = weekBoundsFromKickoffs(rows);
  assert.deepEqual(bounds, [
    { week: 4, lastKickoffAt: new Date('2026-10-06T00:15:00.000Z') },
    { week: 5, lastKickoffAt: new Date('2026-10-13T00:15:00.000Z') },
  ]);
  // Wednesday after week 4's Monday night: week 5 is what managers pick.
  assert.equal(deriveNflWeek(bounds, new Date('2026-10-07T12:00:00Z')), 5);
  // A within-week reschedule (Thu -> the following Wed, 2020 BAL@PIT) is inside
  // the span and still counts.
  const wed = weekBoundsFromKickoffs([
    { week: 12, kickoff_at: '2026-11-29T18:00:00.000Z' }, // Sun
    { week: 12, kickoff_at: '2026-12-02T20:40:00.000Z' }, // Wed, moved from Thu
  ]);
  assert.deepEqual(wed, [{ week: 12, lastKickoffAt: new Date('2026-12-02T20:40:00.000Z') }]);
});

/* ------------------------------------------------------------------ *
 * pickemSeasonComplete                                                *
 * ------------------------------------------------------------------ */

const W18_KICKOFF_1 = '2027-01-10T18:00:00.000Z';
const W18_KICKOFF_2 = '2027-01-10T21:25:00.000Z';
const finalGame = (gameKey, kickoffAt, [home, away], [hs, as]) => ({
  week: 18, gameKey, teams: gameKey.split('|'), kickoffAt,
  homeTeam: home, awayTeam: away, status: 'final', homeScore: hs, awayScore: as,
});
const scheduledGame = (gameKey, kickoffAt) => ({
  week: 18, gameKey, teams: gameKey.split('|'), kickoffAt,
  homeTeam: null, awayTeam: null, status: 'scheduled', homeScore: null, awayScore: null,
});

test('pickemSeasonComplete: an empty week-18 slate is never complete', () => {
  // A freshly rolled-over season has no schedule yet; it must not complete
  // on the spot.
  assert.equal(pickemSeasonComplete({ week18Games: [], now: new Date('2027-06-01T00:00:00Z') }), false);
});

test('pickemSeasonComplete: every game resolved (ties included) completes immediately', () => {
  const week18Games = [
    finalGame('BUF|MIA', W18_KICKOFF_1, ['BUF', 'MIA'], [24, 17]),
    finalGame('DAL|WAS', W18_KICKOFF_2, ['WAS', 'DAL'], [20, 20]), // a tie still resolves
  ];
  // "Now" is still inside the second game's afternoon: no time fallback needed.
  assert.equal(pickemSeasonComplete({ week18Games, now: new Date('2027-01-11T01:00:00Z') }), true);
});

test('pickemSeasonComplete: one unresolved game waits for the finalization grace, then completes', () => {
  assert.equal(FINALIZATION_GRACE_HOURS, 24);
  const week18Games = [
    finalGame('BUF|MIA', W18_KICKOFF_1, ['BUF', 'MIA'], [24, 17]),
    scheduledGame('DAL|WAS', W18_KICKOFF_2), // never marked final anywhere
  ];
  const lastKickoff = new Date(W18_KICKOFF_2).getTime();
  assert.equal(
    pickemSeasonComplete({ week18Games, now: new Date(lastKickoff + 23 * HOUR) }),
    false,
    'pre-grace'
  );
  assert.equal(
    pickemSeasonComplete({ week18Games, now: new Date(lastKickoff + 25 * HOUR) }),
    true,
    'post-grace: one never-finalized game must not wedge the league out of a champion'
  );
  assert.equal(
    pickemSeasonComplete({ week18Games, now: new Date(lastKickoff + 13 * HOUR), graceHours: 12 }),
    true,
    'custom grace'
  );
});

/* ------------------------------------------------------------------ *
 * pickemChampions                                                     *
 * ------------------------------------------------------------------ */

const row = (userId, points, correct, extra = {}) => ({ userId, points, correct, ...extra });

test('pickemChampions: a single leader is the only champion', () => {
  const standings = [row(1, 120, 100, { rank: 1 }), row(2, 118, 101, { rank: 2 }), row(3, 90, 80, { rank: 3 })];
  assert.deepEqual(pickemChampions(standings), [row(1, 120, 100, { rank: 1 })]);
});

test('pickemChampions: a tie on points AND correct picks makes co-champions', () => {
  const standings = [
    row(1, 120, 100, { username: 'alice' }),
    row(2, 120, 100, { username: 'bob' }),
    row(3, 120, 99),
  ];
  assert.deepEqual(pickemChampions(standings).map((r) => r.userId), [1, 2]);
});

test('pickemChampions: a tie on points is broken by correct picks', () => {
  // Confidence mode: equal points, but one manager got there with more picks right.
  const standings = [row(7, 200, 110), row(8, 200, 109)];
  assert.deepEqual(pickemChampions(standings).map((r) => r.userId), [7]);
});

test('pickemChampions: no standings, no champion', () => {
  assert.deepEqual(pickemChampions([]), []);
});

test('pickemChampions: nobody is crowned when the leader has no points and no correct picks', () => {
  // computePickemStandings lists every member at zero, and the completion
  // guard only needs ONE pick to exist this season: without this rule a
  // league where one manager made one losing pick would crown everybody.
  const standings = [row(1, 0, 0), row(2, 0, 0), row(3, 0, 0)];
  assert.deepEqual(pickemChampions(standings), []);
});

test('a game moved EARLIER than its week does not collapse the week window', () => {
  // The mirror of the TEN@PIT shape, or simply one bad kickoff_at row from a
  // sync: anchoring on the week's first kickoff would filter out every real
  // game and close week 5 three weeks early.
  const bounds = weekBoundsFromKickoffs([
    { week: 5, kickoff_at: '2026-09-20T17:00:00.000Z' }, // outlier, three weeks early
    { week: 5, kickoff_at: '2026-10-09T00:15:00.000Z' }, // Thu
    { week: 5, kickoff_at: '2026-10-11T17:00:00.000Z' }, // Sun
    { week: 5, kickoff_at: '2026-10-13T00:15:00.000Z' }, // Mon night
  ]);
  assert.deepEqual(bounds, [{ week: 5, lastKickoffAt: new Date('2026-10-13T00:15:00.000Z') }]);
  assert.equal(deriveNflWeek(bounds, new Date('2026-10-11T18:00:00Z')), 5);
});

test('pickemSeasonComplete: the time fallback needs at least one resolved game', () => {
  // Zero resolved games 24h after the last kickoff means the finalization
  // pipeline never graded the week at all; completing then would crown a
  // permanent champion from weeks 1-17. Wait for evidence instead.
  const week18Games = [scheduledGame('BUF|MIA', W18_KICKOFF_1), scheduledGame('DAL|WAS', W18_KICKOFF_2)];
  const lastKickoff = new Date(W18_KICKOFF_2).getTime();
  assert.equal(pickemSeasonComplete({ week18Games, now: new Date(lastKickoff + 48 * HOUR) }), false);
});

/* ------------------------------------------------------------------ *
 * seasonOverMessage                                                   *
 * ------------------------------------------------------------------ */

test('seasonOverMessage names one, two or three winners and counts beyond that', () => {
  const winner = (teamName, points = 12) => ({ userId: 1, teamName, username: 'u', points, correct: 10 });
  assert.equal(seasonOverMessage([]), "The pick'em season is over.");
  assert.equal(
    seasonOverMessage([winner('Sunday Ballers')]),
    "The pick'em season is over. Sunday Ballers wins with 12 points."
  );
  assert.equal(
    seasonOverMessage([winner('A', 1)]),
    "The pick'em season is over. A wins with 1 point."
  );
  assert.equal(
    seasonOverMessage([winner('A'), winner('B')]),
    "The pick'em season is over. A and B share the title with 12 points."
  );
  assert.equal(
    seasonOverMessage([winner('A'), winner('B'), winner('C')]),
    "The pick'em season is over. A, B and C share the title with 12 points."
  );
  // Team names run to 120 characters and a pick'em league holds up to 50
  // managers; notifications.message is varchar(500). Past three names, count.
  const long = 'x'.repeat(120);
  const four = seasonOverMessage([winner(long), winner(long), winner(long), winner(long)]);
  assert.equal(four, "The pick'em season is over. 4 managers share the title with 12 points.");
  const three = seasonOverMessage([winner(long), winner(long), winner(long)]);
  assert.ok(three.length <= 500, `three maximal names must fit: ${three.length}`);
  // A Team id, never account identity, is the defensive fallback.
  assert.equal(
    seasonOverMessage([{ teamId: 9, teamName: null, points: 3, correct: 3 }]),
    "The pick'em season is over. Team 9 wins with 3 points."
  );
});

/* ------------------------------------------------------------------ *
 * seasonHasClosed                                                     *
 * ------------------------------------------------------------------ */

test('seasonHasClosed is true only once every week has closed under the grace', () => {
  assert.equal(seasonHasClosed([], new Date('2027-03-01T00:00:00Z')), false, 'no schedule is not a closed season');
  assert.equal(seasonHasClosed(seasonBounds(), new Date('2027-01-10T18:00:00Z')), false, 'week 18 in play');
  assert.equal(seasonHasClosed(seasonBounds(), new Date(mnf(18).getTime() + 5 * HOUR)), false, 'inside the grace');
  assert.equal(seasonHasClosed(seasonBounds(), new Date(mnf(18).getTime() + 7 * HOUR)), true, 'past the grace');
  assert.equal(seasonHasClosed(seasonBounds(17), new Date('2027-03-01T00:00:00Z')), true, 'a missing week-18 row still closes');
});
