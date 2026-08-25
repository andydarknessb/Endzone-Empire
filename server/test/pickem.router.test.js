const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { signToken } = require('../modules/auth');
const pickemRouter = require('../routes/pickem.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'pickem-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/pickem', pickemRouter);

const MEMBER = 9;
const authed = (userId = MEMBER) =>
  `Bearer ${signToken({ id: userId, username: `u${userId}` })}`;

// Kickoffs are relative to the clock so the lock assertions mean the same
// thing whatever calendar day the suite runs on.
const hoursFromNow = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();
const THURSDAY = hoursFromNow(-72); // long since kicked off
const SUNDAY = hoursFromNow(-24); // also kicked off, later than Thursday
const NEXT_WEEK = hoursFromNow(24 * 7);

const nflGameRows = (week, pairs) =>
  pairs.flatMap(([a, b, kickoff]) => [
    { week, nfl_team: a, opponent: b, kickoff_at: kickoff },
    { week, nfl_team: b, opponent: a, kickoff_at: kickoff },
  ]);

const WEEK_ONE_SCHEDULE = nflGameRows(1, [
  ['BUF', 'MIA', THURSDAY],
  ['DAL', 'WAS', SUNDAY],
]);

/**
 * One shared fake per test, both halves writing a single via-tagged call log:
 * mockPool registers answers for the pool side of the seam, mockClient for
 * the checked-out-client side. `overrides` are matched before the defaults,
 * so a test can change one statement's answer without restating the rest.
 *
 * Both accessors return the SAME array: the one log, holding both sides'
 * statements interleaved in execution order. Filter by `via` before asserting
 * on position or length, or the other side's calls are counted too. Handler
 * ordering across accessors: entries are appended per call, so a later
 * accessor call's overrides land AFTER an earlier call's defaults — an
 * earlier same-side default that matches the statement wins over them.
 */
const fakes = new WeakMap();
function register(t, side, entries) {
  if (!fakes.has(t)) {
    const handlers = [];
    fakes.set(t, { handlers, fake: createFakePool(handlers).install(t) });
  }
  const { handlers, fake } = fakes.get(t);
  handlers.push(...entries.map(([pattern, handler]) => [pattern, handler, side]));
  return fake.calls;
}

// Returns the shared both-sides log (see the block comment above): client
// calls are in here too — filter by `via` before positional/length asserts.
// If mockClient ran first, this call's overrides land after its defaults.
function mockPool(t, overrides = []) {
  return register(t, 'pool', [
    ...overrides,
    [/FROM "teams" WHERE "league_id"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/SELECT 1 FROM "leagues"/, () => ({ rows: [] })], // not a commissioner
    [/SELECT "id", "name", "current_season"/, () =>
      ({ rows: [{ id: 3, name: 'Ballers', current_season: 2026, current_week: 1 }] })],
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    [/FROM "nfl_games"/, () => ({ rows: WEEK_ONE_SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "pickem_picks"/, () => ({ rows: [] })],
    [/FROM "teams"\s+JOIN "users"/, () => ({ rows: [] })],
    [/game_recaps/, () => ({ rows: [] })],
  ]);
}

// Returns the shared both-sides log (see the block comment above): pool
// calls are in here too — filter by `via` before positional/length asserts.
// If mockPool ran first, this call's overrides land after its defaults.
function mockClient(t, overrides = []) {
  return register(t, 'client', [
    ...overrides,
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    [/SELECT "id", "name", "current_season"/, () =>
      ({ rows: [{ id: 3, name: 'Ballers', current_season: 2026, current_week: 1 }] })],
    [/FROM "nfl_games"/, () => ({ rows: WEEK_ONE_SCHEDULE })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/SELECT "team_pair", "confidence" FROM "pickem_picks"/, () => ({ rows: [] })],
    [/SELECT 1 FROM "pickem_picks"/, () => ({ rows: [] })],
    [/INSERT INTO "pickem_picks"/, () => ({ rows: [] })],
    [/INSERT INTO "pickem_settings"/, () => ({ rows: [] })],
    [/INSERT INTO "transactions"/, () => ({ rows: [] })],
  ]);
}

/**
 * #274: the seam for "the refusal wrote nothing".
 *
 * mockPool/mockClient both return the shared call log, and the refusal tests
 * below used to discard it. The log is the only thing that can tell a guard
 * above the write from one below it: every Pick'em write happens inside a
 * transaction, so a misplaced guard rolls back and answers identically.
 *
 * mockClient registers LIVE handlers for both inserts (see above), so a zero
 * here is an observation. The happy-path tests in this file assert the same
 * two patterns are PRESENT, which is the baseline that makes the zero legible.
 */
const writeCount = (calls, re) => calls.filter((call) => re.test(call.text)).length;
const PICKS_INSERT = /^INSERT INTO "pickem_picks"/;
const SETTINGS_INSERT = /^INSERT INTO "pickem_settings"/;

/* ------------------------------------------------------------------ *
 * Gates                                                               *
 * ------------------------------------------------------------------ */

test('every Pick\'em route requires a signed-in caller', async () => {
  for (const path of [
    '/api/pickem/league/3/settings',
    '/api/pickem/league/3/week/1',
    '/api/pickem/league/3/standings',
  ]) {
    const res = await request(app).get(path);
    assert.equal(res.status, 401, path);
  }
});

test('a non-member gets 403 from every Pick\'em route', async (t) => {
  const calls = mockPool(t, [[/FROM "teams" WHERE "league_id"/, () => ({ rows: [] })]]);

  const settings = await request(app)
    .get('/api/pickem/league/3/settings').set('Authorization', authed());
  assert.equal(settings.status, 403);
  assert.equal(settings.body.error, 'not a member of this league');

  const week = await request(app)
    .get('/api/pickem/league/3/week/1').set('Authorization', authed());
  assert.equal(week.status, 403);

  const save = await request(app)
    .put('/api/pickem/league/3/week/1/picks')
    .set('Authorization', authed())
    .send({ picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF' }] });
  assert.equal(save.status, 403);

  const standings = await request(app)
    .get('/api/pickem/league/3/standings').set('Authorization', authed());
  assert.equal(standings.status, 403);

  // #274. The three GET legs above refuse a read; the PUT leg refuses a write,
  // and only this count distinguishes a non-member who was turned away from
  // one whose picks were saved and then rolled back.
  assert.equal(writeCount(calls, PICKS_INSERT), 0, 'the non-member saved no picks');
});

test('a non-integer league id or an out-of-range week is a 400', async () => {
  const badLeague = await request(app)
    .get('/api/pickem/league/abc/settings').set('Authorization', authed());
  assert.equal(badLeague.status, 400);

  for (const week of ['0', '19', 'x']) {
    const res = await request(app)
      .get(`/api/pickem/league/3/week/${week}`).set('Authorization', authed());
    assert.equal(res.status, 400, `week ${week}`);
    assert.match(res.body.error, /between 1 and 18/);
  }
});

/* ------------------------------------------------------------------ *
 * Settings                                                            *
 * ------------------------------------------------------------------ */

test('GET settings reports the config and whether the caller can change it', async (t) => {
  mockPool(t, [
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'confidence' }] })],
    [/SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
  ]);
  const res = await request(app)
    .get('/api/pickem/league/3/settings').set('Authorization', authed());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { enabled: true, mode: 'confidence', isCommissioner: true });
});

test('GET settings on a league that never enabled Pick\'em reports it off', async (t) => {
  mockPool(t, [[/FROM "pickem_settings"/, () => ({ rows: [] })]]);
  const res = await request(app)
    .get('/api/pickem/league/3/settings').set('Authorization', authed());
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { enabled: false, mode: 'straight', isCommissioner: false });
});

test('a plain member cannot change the settings', async (t) => {
  const calls = mockPool(t); // default: SELECT 1 FROM "leagues" returns no row
  const res = await request(app)
    .put('/api/pickem/league/3/settings')
    .set('Authorization', authed())
    .send({ enabled: true });
  assert.equal(res.status, 403);
  assert.match(res.body.error, /only the commissioner/);
  assert.equal(writeCount(calls, SETTINGS_INSERT), 0, 'the member changed nothing');
});

test('a co-commissioner can enable Pick\'em', async (t) => {
  mockPool(t, [
    [/SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "pickem_settings"/, () => ({ rows: [] })],
  ]);
  const calls = mockClient(t, [[/FROM "pickem_settings"/, () => ({ rows: [] })]]);

  const res = await request(app)
    .put('/api/pickem/league/3/settings')
    .set('Authorization', authed())
    .send({ enabled: true, mode: 'confidence' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { enabled: true, mode: 'confidence', isCommissioner: true });
  assert.ok(calls.some((call) => /INSERT INTO "pickem_settings"/.test(call.text)));
});

test('changing the mode after picks exist is a 409 PICKEM_MODE_LOCKED', async (t) => {
  mockPool(t, [[/SELECT 1 FROM "leagues"/, () => ({ rows: [{ '?column?': 1 }] })]]);
  const calls = mockClient(t, [[/SELECT 1 FROM "pickem_picks"/, () => ({ rows: [{ '?column?': 1 }] })]]);

  const res = await request(app)
    .put('/api/pickem/league/3/settings')
    .set('Authorization', authed())
    .send({ enabled: true, mode: 'confidence' });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'PICKEM_MODE_LOCKED');
  // #274. The service-level sibling of this case (pickem.service.test.js)
  // already asserted the absence; the router test did not. The upsert handler
  // is live, so a lock moved below it would rewrite the mode and still 409.
  assert.equal(writeCount(calls, SETTINGS_INSERT), 0, 'the locked mode was not rewritten');
});

/* ------------------------------------------------------------------ *
 * Week board                                                          *
 * ------------------------------------------------------------------ */

test('the week board is 403 PICKEM_DISABLED until the commissioner turns it on', async (t) => {
  mockPool(t, [[/FROM "pickem_settings"/, () => ({ rows: [{ enabled: false, mode: 'straight' }] })]]);
  const res = await request(app)
    .get('/api/pickem/league/3/week/1').set('Authorization', authed());
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'PICKEM_DISABLED');
});

test('the week board derives the slate from nfl_games even with no live rows', async (t) => {
  mockPool(t, [
    [/FROM "pickem_picks"/, () => ({
      rows: [
        { user_id: MEMBER, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null, username: 'u9' },
        { user_id: 5, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null, username: 'rival' },
        { user_id: 5, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null, username: 'rival' },
      ],
    })],
  ]);

  const res = await request(app)
    .get('/api/pickem/league/3/week/1').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.equal(res.body.season, 2026);
  assert.equal(res.body.week, 1);
  assert.equal(res.body.mode, 'straight');
  assert.deepEqual(res.body.games.map((game) => game.gameKey), ['BUF|MIA', 'DAL|WAS']);
  assert.equal(res.body.games[0].homeTeam, null, 'no live row yet — no home/away order');
  assert.deepEqual(res.body.myPicks, [
    { gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: null },
  ]);
  // Both fixture games have kicked off, so both of the rival's picks are
  // revealed — the reveal is per game, driven by the same kickoff lock.
  assert.deepEqual(Object.keys(res.body.othersPicks).sort(), ['BUF|MIA', 'DAL|WAS']);
});

test("an unlocked game never leaks another manager's pick", async (t) => {
  const future = NEXT_WEEK;
  mockPool(t, [
    [/FROM "nfl_games"/, () => ({ rows: nflGameRows(1, [['BUF', 'MIA', future]]) })],
    [/FROM "pickem_picks"/, () => ({
      rows: [{ user_id: 5, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null, username: 'rival' }],
    })],
  ]);

  const res = await request(app)
    .get('/api/pickem/league/3/week/1').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.equal(res.body.games[0].locked, false);
  assert.deepEqual(res.body.othersPicks, {});
  assert.deepEqual(res.body.myPicks, []);
});

/* ------------------------------------------------------------------ *
 * Saving picks                                                        *
 * ------------------------------------------------------------------ */

test('saving picks for a kicked-off game is a 409 naming the offending games', async (t) => {
  mockPool(t);
  const calls = mockClient(t);

  const res = await request(app)
    .put('/api/pickem/league/3/week/1/picks')
    .set('Authorization', authed())
    .send({ picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF' }] });

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'PICKEM_LOCKED');
  assert.deepEqual(res.body.gameKeys, ['BUF|MIA']);
  // #274, and this is the textbook shape: the lock is re-checked INSIDE the
  // transaction, so a check moved below the upsert saves a pick on a game that
  // has already kicked off and answers the identical 409.
  assert.equal(writeCount(calls, PICKS_INSERT), 0, 'no pick was saved for a started game');
});

test('a happy-path save writes the batch and echoes it back', async (t) => {
  const future = NEXT_WEEK;
  mockPool(t);
  const calls = mockClient(t, [
    [/FROM "nfl_games"/, () => ({ rows: nflGameRows(1, [['BUF', 'MIA', future]]) })],
  ]);

  const res = await request(app)
    .put('/api/pickem/league/3/week/1/picks')
    .set('Authorization', authed())
    .send({ picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'mia' }] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    saved: 1,
    myPicks: [{ gameKey: 'BUF|MIA', pickedTeam: 'MIA', confidence: null }],
  });
  const upsert = calls.find((call) => /INSERT INTO "pickem_picks"/.test(call.text));
  assert.deepEqual(upsert.params, [3, MEMBER, 2026, 1, ['BUF|MIA'], ['MIA'], [null]]);
});

test('a duplicate confidence in confidence mode is a 400 PICKEM_BAD_CONFIDENCE', async (t) => {
  const future = NEXT_WEEK;
  mockPool(t);
  const calls = mockClient(t, [
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'confidence' }] })],
    [/FROM "nfl_games"/, () => ({
      rows: nflGameRows(1, [['BUF', 'MIA', future], ['DAL', 'WAS', future]]),
    })],
  ]);

  const res = await request(app)
    .put('/api/pickem/league/3/week/1/picks')
    .set('Authorization', authed())
    .send({
      picks: [
        { gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 2 },
        { gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 2 },
      ],
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'PICKEM_BAD_CONFIDENCE');
  assert.deepEqual(res.body.gameKeys, ['DAL|WAS']);
  // #274: a rejected batch must not be half-written. The upsert is one bulk
  // statement, so a validation moved below it would store BOTH duplicate
  // confidences before the 400.
  assert.equal(writeCount(calls, PICKS_INSERT), 0, 'the rejected batch was not saved');
});

// #274, documented exemption (no write assertion needed): the router returns
// this 400 from `if (!Array.isArray(picks))` at pickem.router.js:117, which
// sits before the try block and therefore before requireMember, loadLeague and
// upsertPicks. No client is checked out and no statement is dispatched, so
// there is no mutable work behind this refusal for a guard to sink below.
test('picks must be an array', async () => {
  const res = await request(app)
    .put('/api/pickem/league/3/week/1/picks')
    .set('Authorization', authed())
    .send({ picks: 'BUF' });
  assert.equal(res.status, 400);
});

/* ------------------------------------------------------------------ *
 * Standings                                                           *
 * ------------------------------------------------------------------ */

test('standings default to the league\'s current season and score every member', async (t) => {
  const calls = mockPool(t, [
    [/FROM "teams" JOIN "users"/, () => ({
      rows: [
        { user_id: MEMBER, username: 'u9', team_name: 'Mine', avatar_url: null, avatar_static_url: null },
        { user_id: 5, username: 'rival', team_name: 'Theirs', avatar_url: null, avatar_static_url: null },
      ],
    })],
    [/SELECT "user_id", "week", "team_pair"/, () => ({
      rows: [
        { user_id: MEMBER, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
        { user_id: 5, week: 1, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null },
      ],
    })],
    [/FROM "live_game_states"/, () => ({
      rows: [{ week: 1, home_team: 'BUF', away_team: 'MIA', game_status: 'final',
        current_score_home: 31, current_score_away: 10 }],
    })],
  ]);

  const res = await request(app)
    .get('/api/pickem/league/3/standings').set('Authorization', authed());

  assert.equal(res.status, 200);
  assert.equal(res.body.season, 2026);
  assert.deepEqual(
    res.body.standings.map((row) => [row.rank, row.username, row.points, row.correct]),
    [[1, 'u9', 1, 1], [2, 'rival', 0, 0]]
  );
  // The season-wide read still normalizes both schedule tables in SQL.
  const scheduleSql = calls.find((call) => /FROM "nfl_games"/.test(call.text)).text;
  assert.match(scheduleSql, /fn_normalize_nfl_team\("nfl_team"\)/);
});

test('standings return competition ranks for Pick\'em-only and side-game leagues', async (t) => {
  let pickemOnly = true;
  mockPool(t, [
    [/SELECT "id", "name", "current_season"/, () => ({
      rows: [{ id: 3, name: 'Ballers', current_season: 2026, current_week: 1, pickem_only: pickemOnly }],
    })],
    [/FROM "teams" JOIN "users"/, () => ({
      rows: [
        { user_id: MEMBER, username: 'zoe', team_name: 'Mine', avatar_url: null, avatar_static_url: null },
        { user_id: 5, username: 'abe', team_name: 'Theirs', avatar_url: null, avatar_static_url: null },
        { user_id: 7, username: 'mia', team_name: 'Third', avatar_url: null, avatar_static_url: null },
      ],
    })],
    [/SELECT "user_id", "week", "team_pair"/, () => ({
      rows: [
        { user_id: MEMBER, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
        { user_id: MEMBER, week: 1, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
        { user_id: 5, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
        { user_id: 5, week: 1, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: null },
        { user_id: 7, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
        { user_id: 7, week: 1, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: null },
      ],
    })],
    [/FROM "live_game_states"/, () => ({
      rows: [
        { week: 1, home_team: 'BUF', away_team: 'MIA', game_status: 'final',
          current_score_home: 31, current_score_away: 10 },
        { week: 1, home_team: 'DAL', away_team: 'WAS', game_status: 'final',
          current_score_home: 10, current_score_away: 20 },
      ],
    })],
  ]);

  for (pickemOnly of [true, false]) {
    const res = await request(app)
      .get('/api/pickem/league/3/standings').set('Authorization', authed());

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.standings.map((row) => [row.rank, row.teamName, row.points, row.correct]),
      [[1, 'Theirs', 2, 2], [1, 'Mine', 2, 2], [3, 'Third', 1, 1]],
      pickemOnly ? "Pick'em-only" : 'side game'
    );
  }
});

test('an explicit non-numeric season is rejected', async () => {
  const res = await request(app)
    .get('/api/pickem/league/3/standings?season=abc').set('Authorization', authed());
  assert.equal(res.status, 400);
});
