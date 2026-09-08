const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select } = require('./helpers/fakePool');
const {
  MEMBER_LEAGUE_FIELDS,
  MEMBER_TEAM_FIELDS,
  MEMBER_PICK_FIELDS,
  PRESENTER_LEAGUE_FIELDS,
  PRESENTER_TEAM_FIELDS,
  PRESENTER_PICK_FIELDS,
} = require('./helpers/draftStatePins');
const { memberSnapshot, presenterSnapshot } = require('../services/draftRoomSnapshot');

/**
 * The Draft room snapshot contract (#788). memberSnapshot builds `draft:state`
 * for authenticated league members; presenterSnapshot builds the anonymous
 * share-link board. Both are league-shared, so what they carry is a contract,
 * not an implementation detail.
 *
 * WHY THE FIXTURES ARE WIDER THAN THE CONTRACT. fakePool answers rows verbatim,
 * so a snapshot that returned its rows raw would carry every field the fixture
 * holds - including `owner_id` (an account identifier #115 forbids on a
 * league-shared payload), `draft_share_token` (the presenter credential only a
 * commissioner may mint) and `invite_code`. The snapshot names its output
 * fields, so none of the three survive; the exact-key-set assertions below are
 * what prove it, and they are pinned against the INDEPENDENT copies in
 * draftStatePins.js (never imported from the module under test), so a widened
 * read fails here instead of passing a tautology.
 *
 * The negative-control the issue names (AC1): add `owner_id` to
 * MEMBER_LEAGUE_COLUMNS in draftRoomSnapshot.js - the single list that drives
 * both the member SELECT and its projection - and the first two tests below go
 * red (the key set gains a 20th field the pinned copy lacks, and `owner_id` is
 * no longer stripped). Verified by experiment, reported in the PR body.
 */

const LEAGUE_ID = 1;

// A leagues row wider than either audience: the 19 member columns, the three
// forbidden fields, the columns the presenter's on-the-clock derivation needs,
// and a stand-in for a column added next quarter.
const wideLeagueRow = (over = {}) => ({
  id: LEAGUE_ID,
  name: 'The Gridiron Society',
  draft_status: 'active',
  draft_paused: false,
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  current_pick: 1,
  pick_deadline_at: '2026-09-01T00:00:00.000Z',
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  draft_rounds: 15,
  roster_limit: 16,
  roster_slots: {},
  bench_slots: 6,
  ir_slots: 1,
  min_teams: 2,
  draft_date: '2026-09-01',
  draft_timezone: 'America/New_York',
  // Never on either snapshot:
  owner_id: 7,
  draft_share_token: 'presenter-secret-token',
  invite_code: 'JOIN-ME-42',
  // Publication is not the default: a new column does not ship because it exists.
  some_column_added_next_quarter: 'leaks by default under SELECT *',
  ...over,
});

// A teams row WIDER than the shared read projects (it carries owner_id), so the
// presenter narrowing is proven to strip a field a future teams query might
// re-add straight through.
const teamRow = (id, draftPosition) => ({
  id,
  name: `Team ${id}`,
  draft_position: draftPosition,
  autodraft: false,
  draft_ready: true,
  teamId: id,
  teamName: `Team ${id}`,
  owner_id: 100 + id,
});

const pickRow = () => ({
  pick_number: 1,
  team_id: 11,
  is_keeper: false,
  teamId: 11,
  teamName: 'Team 11',
  player_id: 501,
  name: 'Star Runningback',
  position: 'RB',
  nfl_team: 'KC',
});

function snapshotPool(leagueOver = {}) {
  return createFakePool([
    [select('leagues'), () => ({ rows: [wideLeagueRow(leagueOver)] })],
    [/FROM "teams"/, () => ({ rows: [teamRow(11, 1), teamRow(12, 2)] })],
    [/FROM "draft_picks"/, () => ({ rows: [pickRow()] })],
  ]);
}

test('memberSnapshot: the league key set equals MEMBER_LEAGUE_FIELDS exactly, no extra and no missing', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  assert.deepEqual(Object.keys(snapshot.league).sort(), [...MEMBER_LEAGUE_FIELDS].sort());
  fake.assertClean();
});

test('memberSnapshot: a league row carrying owner_id, draft_share_token and invite_code yields a league with none of the three', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  for (const forbidden of ['owner_id', 'draft_share_token', 'invite_code']) {
    assert.equal(forbidden in snapshot.league, false, `${forbidden} must never ride draft:state`);
  }
  // The VALUES, not only the keys: a future rename must not smuggle them back.
  const body = JSON.stringify(snapshot.league);
  for (const secret of ['presenter-secret-token', 'JOIN-ME-42', 'leaks by default under SELECT *']) {
    assert.ok(!body.includes(secret), `${secret} is not on the member snapshot`);
  }
  fake.assertClean();
});

// #833 AC2 (the draft:state half): every member pick carries the player's market
// ADP, read from the readPicks SELECT, so the Draft room's Misery Meter reads a
// pick's ADP off the pick and not off the windowed player pool. The draft_picks
// handler returns `adp` ONLY when the real SELECT names `"players"."adp"`, so this
// is a true red-tell: drop that column from readPicks in draftRoomSnapshot.js and
// picks[0].adp is undefined instead of the player's ADP, turning the assertion red.
// (Verified by experiment; reported in the PR body.) memberSnapshot returns the
// pick rows verbatim, so a null ADP - the LEFT-JOIN-absent case - passes through
// as null, which the second pick pins.
test('memberSnapshot: each pick carries the player market ADP from the readPicks select (#833 AC2)', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [wideLeagueRow()] })],
    [/FROM "teams"/, () => ({ rows: [teamRow(11, 1), teamRow(12, 2)] })],
    [/FROM "draft_picks"/, (text) => {
      const selectsAdp = /"players"\."adp"/.test(text);
      return {
        rows: [
          { ...pickRow(), adp: selectsAdp ? 3.2 : undefined },
          {
            ...pickRow(), pick_number: 2, player_id: 502, name: 'No-Market Guy',
            adp: selectsAdp ? null : undefined,
          },
        ],
      };
    }],
  ]).install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  // Present and equal to players.adp for a player who has one...
  assert.equal(snapshot.picks[0].adp, 3.2);
  // ...and null for a player who has none.
  assert.strictEqual(snapshot.picks[1].adp, null);
  fake.assertClean();
});

// #949 (the draft:state half): every member pick carries the autopick fact, read
// from the readPicks SELECT's `AS "auto"` projection (a COALESCE over the
// draft_activity.is_autopick LATERAL join), so a board refresh preserves the mark
// a live draft:picked set instead of silently un-marking every autopick in the
// room's history. This is a true red-tell of the SELECT LIST: the draft_picks
// handler returns `auto` ONLY when the real SELECT names `AS "auto"`, so dropping
// that projection from readPicks makes picks[0].auto undefined instead of the
// autopick fact, turning the assertion red. (Verified by experiment; reported in
// the PR body.) The LATERAL's one-row-per-pick_number resolution is a claim about
// the DATABASE that a matcher fake cannot express, so it is proven separately over
// a real Postgres in draftRoomSnapshot.pg.test.js. memberSnapshot returns the pick
// rows verbatim, so `auto` reaches the client at the top level; the presenter
// narrows to PRESENTER_PICK_FIELDS, which does not name it, so a share link never
// gets it (the presenter key-set test below is the guard for that).
test('memberSnapshot: each pick carries the autopick fact from the readPicks select (#949)', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [wideLeagueRow()] })],
    [/FROM "teams"/, () => ({ rows: [teamRow(11, 1), teamRow(12, 2)] })],
    [/FROM "draft_picks"/, (text) => {
      const selectsAuto = /AS "auto"/.test(text);
      return {
        rows: [
          { ...pickRow(), auto: selectsAuto ? true : undefined },
          { ...pickRow(), pick_number: 2, player_id: 502, name: 'Manual Pick', auto: selectsAuto ? false : undefined },
        ],
      };
    }],
  ]).install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  // The clock's pick reads true; a manual pick reads false. Strict, so a dropped
  // projection (undefined) fails rather than passing a loose truthiness check.
  assert.strictEqual(snapshot.picks[0].auto, true);
  assert.strictEqual(snapshot.picks[1].auto, false);
  fake.assertClean();
});

// #998: the member half of the pin. memberSnapshot returns the teams and pick
// rows VERBATIM, so a member team's / pick's key set is exactly the SELECT list
// of readTeams / readPicks - there is no `shape()` narrowing on this side, which
// is why MEMBER_TEAM_FIELDS and MEMBER_PICK_FIELDS are the only thing standing
// between a widened projection and a silently wider draft:state payload. Until
// now nothing imported either list (#998), so the helper's header promise -
// "a one-place edit fails a pin, loudly" - held for the presenter lists and was
// false for these two.
//
// WHY THE FIXTURE IS DERIVED FROM THE SQL. fakePool answers rows verbatim, so a
// hand-written fixture row would pin the FIXTURE, not the query: widening
// readPicks would leave the fake's row unchanged and the assertion green. Every
// key the fake returns is therefore read out of the real SELECT list, exactly as
// the #833 `adp` and #949 `auto` tests above read one column out of it - so the
// red-tell the helper's header promises is the real one: project one more column
// in readPicks (or readTeams) without touching the pin and the key set gains a
// field the pinned copy lacks.

// The output names a bare-column / aliased SELECT list produces, in order:
// `"t"."c" AS "x"` -> x, `"t"."c"` -> c. Paren-depth aware, so the COALESCE in
// readPicks (which contains a comma) stays one item. fakePool hands the handler
// whitespace-normalised SQL, so the string is single-line by the time it lands.
function projectedNames(sql) {
  const list = sql.slice(sql.indexOf('SELECT ') + 'SELECT '.length, sql.indexOf(' FROM '));
  const items = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { items.push(current); current = ''; } else current += ch;
  }
  items.push(current);
  return items.map((item) => {
    const trimmed = item.trim();
    const aliased = /AS\s+"([^"]+)"$/.exec(trimmed);
    if (aliased) return aliased[1];
    const quoted = trimmed.match(/"([^"]+)"/g) || [];
    assert.ok(quoted.length, `cannot name the projected column in: ${trimmed}`);
    return quoted[quoted.length - 1].replace(/"/g, '');
  });
}

// A row carrying exactly the columns the real SELECT projects. A column the
// values map does not know about still arrives, under a value that says so, so a
// widened projection widens the row rather than being silently dropped.
const rowFromSelect = (sql, values) => Object.fromEntries(
  projectedNames(sql).map((name) => [
    name,
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : `column added: ${name}`,
  ])
);

// The teams fixture this pin uses answers only the columns readTeams asks for.
// The wider teamRow used elsewhere in this file carries owner_id on purpose, to
// prove the PRESENTER narrowing strips it; feeding that row here would pin the
// fixture instead of the query, since the member side does not narrow at all.
const memberTeamValues = (id, draftPosition) => {
  const { owner_id: ownerId, ...rest } = teamRow(id, draftPosition);
  void ownerId;
  return rest;
};

test('memberSnapshot: every pick key set equals MEMBER_PICK_FIELDS and every team key set equals MEMBER_TEAM_FIELDS, exactly', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [wideLeagueRow()] })],
    [/FROM "teams"/, (text) => ({
      rows: [
        rowFromSelect(text, memberTeamValues(11, 1)),
        rowFromSelect(text, memberTeamValues(12, 2)),
      ],
    })],
    [/FROM "draft_picks"/, (text) => ({
      rows: [
        rowFromSelect(text, { ...pickRow(), adp: 3.2, auto: true }),
        rowFromSelect(text, {
          ...pickRow(), pick_number: 2, player_id: 502, name: 'Manual Pick', adp: null, auto: false,
        }),
      ],
    })],
  ]).install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  assert.equal(snapshot.picks.length, 2);
  for (const pick of snapshot.picks) {
    assert.deepEqual(Object.keys(pick).sort(), [...MEMBER_PICK_FIELDS].sort());
  }
  assert.equal(snapshot.teams.length, 2);
  for (const team of snapshot.teams) {
    assert.deepEqual(Object.keys(team).sort(), [...MEMBER_TEAM_FIELDS].sort());
  }
  // onTheClock is one of those team objects, so it carries the same key set.
  assert.ok(snapshot.onTheClock, 'an active draft is on the clock');
  assert.deepEqual(Object.keys(snapshot.onTheClock).sort(), [...MEMBER_TEAM_FIELDS].sort());
  fake.assertClean();
});

// The `auto` entry #994 added to MEMBER_PICK_FIELDS is load-bearing under the pin
// above rather than decorative: it is in the member key set only because
// readPicks projects `AS "auto"`, and dropping either the projection or the pin
// entry turns the exact-key-set assertion red.
test('memberSnapshot: the pin entry `auto` is the one readPicks projects (#994)', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [wideLeagueRow()] })],
    [/FROM "teams"/, (text) => ({ rows: [rowFromSelect(text, memberTeamValues(11, 1))] })],
    [/FROM "draft_picks"/, (text) => ({ rows: [rowFromSelect(text, { ...pickRow(), adp: 3.2, auto: true })] })],
  ]).install(t);

  const snapshot = await memberSnapshot(LEAGUE_ID);

  assert.ok(MEMBER_PICK_FIELDS.includes('auto'), 'the pin lists auto');
  assert.ok(Object.keys(snapshot.picks[0]).includes('auto'), 'the payload carries auto');
  assert.strictEqual(snapshot.picks[0].auto, true);
  fake.assertClean();
});

test('presenterSnapshot: league, teams[0], picks[0] and onTheClock key sets equal the PRESENTER_* lists', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await presenterSnapshot(LEAGUE_ID);

  assert.deepEqual(Object.keys(snapshot.league).sort(), [...PRESENTER_LEAGUE_FIELDS].sort());
  assert.equal(snapshot.teams.length, 2);
  assert.deepEqual(Object.keys(snapshot.teams[0]).sort(), [...PRESENTER_TEAM_FIELDS].sort());
  assert.deepEqual(Object.keys(snapshot.picks[0]).sort(), [...PRESENTER_PICK_FIELDS].sort());
  assert.ok(snapshot.onTheClock, 'an active draft is on the clock');
  assert.deepEqual(Object.keys(snapshot.onTheClock).sort(), [...PRESENTER_TEAM_FIELDS].sort());
  fake.assertClean();
});

test('presenterSnapshot: the on-the-clock derivation still runs, honouring the draft order', async (t) => {
  // The presenter reads a narrow league (no team `id` published), but the shared
  // teams read carries `id`, so teamForPick still resolves - and honours
  // overrides. current_pick 1, snake, two teams -> the second slot is up.
  const fake = snapshotPool().install(t);

  const snapshot = await presenterSnapshot(LEAGUE_ID);

  assert.equal(snapshot.onTheClock.teamId, 12);
  assert.equal(snapshot.onTheClock.teamName, 'Team 12');
  fake.assertClean();
});

test('presenterSnapshot: no account id or presenter credential appears anywhere in the payload', async (t) => {
  const fake = snapshotPool().install(t);

  const snapshot = await presenterSnapshot(LEAGUE_ID);

  const body = JSON.stringify(snapshot);
  for (const forbidden of ['owner_id', 'draft_share_token', 'invite_code']) {
    assert.ok(!new RegExp(`"${forbidden}"`).test(body), `${forbidden} is not published`);
  }
  for (const secret of ['presenter-secret-token', 'JOIN-ME-42', 'leaks by default under SELECT *']) {
    assert.ok(!body.includes(secret), `${secret} is not published`);
  }
  fake.assertClean();
});

test('both snapshots return null for an unknown league', async (t) => {
  const fake = createFakePool([
    [select('leagues'), () => ({ rows: [] })],
  ]).install(t);

  assert.equal(await memberSnapshot(404), null);
  assert.equal(await presenterSnapshot(404), null);
  fake.assertClean();
});
