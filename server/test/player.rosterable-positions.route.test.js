const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const playerRouter = require('../routes/player.router');
const { DEFAULT_ROSTER_SLOTS } = require('../services/rosterSlots');

// ADR 0044 / CONTEXT.md's Rosterable position: a player pool query carrying a
// league id returns only players at that league's rosterable positions - the
// union of every STARTING slot's eligible positions in the league's roster
// template, group keys (DL, LB, DB) expanded through lineup.service's
// existing expandEligibility. The endpoint also accepts a set of positions in
// one request (`positions=RB,WR,TE`); the server intersects the requested set
// (or "All") with the rosterable set. See server/routes/player.router.js and
// server/services/lineup.service.js (rosterablePositions).

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'player-rosterable-positions-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/players', playerRouter);

// One player per whitelisted position code the route already accepts.
const ALL_POSITION_PLAYERS = [
  { id: 1, name: 'Signal Caller', position: 'QB', nfl_team: null },
  { id: 2, name: 'Ball Carrier', position: 'RB', nfl_team: null },
  { id: 3, name: 'Route Runner', position: 'WR', nfl_team: null },
  { id: 4, name: 'Seam Threat', position: 'TE', nfl_team: null },
  { id: 5, name: 'Leg', position: 'K', nfl_team: null },
  { id: 6, name: 'Unit', position: 'DEF', nfl_team: null },
  { id: 7, name: 'Edge', position: 'DE', nfl_team: null },
  { id: 8, name: 'Nose', position: 'DT', nfl_team: null },
  { id: 9, name: 'Backer', position: 'LB', nfl_team: null },
  { id: 10, name: 'Corner', position: 'CB', nfl_team: null },
  { id: 11, name: 'Safety', position: 'S', nfl_team: null },
  { id: 12, name: 'Back', position: 'DB', nfl_team: null },
  // The four rare codes formal review f1 (#1419) added to POSITIONS
  // alongside DL: ~zero real Tank01 rows today, but a client IDP group chip
  // can legitimately send them as part of an expanded group request.
  { id: 13, name: 'Nose Tackle', position: 'NT', nfl_team: null },
  { id: 14, name: 'Anchor', position: 'DL', nfl_team: null },
  { id: 15, name: 'Inside Backer', position: 'ILB', nfl_team: null },
  { id: 16, name: 'Outside Backer', position: 'OLB', nfl_team: null },
  { id: 17, name: 'Free Safety', position: 'FS', nfl_team: null },
  { id: 18, name: 'Strong Safety', position: 'SS', nfl_team: null },
];

// A fake pool that behaves like Postgres would for the WHERE this route
// builds: when the query text carries `"position" = ANY($n)`, it filters the
// canned player fixture by the bound array at that param index, exactly as a
// real WHERE would. No league lookups wired in - for the no-leagueId cases.
function mockPoolNoLeague(t, { players }) {
  return t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "players" AS "source"')) {
      // Match only the outer, unaliased `"position" = ANY($n)` this route
      // builds - NOT the idp_ranks CTE's `"p"."position" = ANY($n)`, which is
      // a global rank input, never a pool filter (see the query's own
      // comment: "NOT filtered by the outer WHERE").
      const anyMatch = text.match(/(?<!\.)"position" = ANY\(\$(\d+)\)/);
      let rows = players;
      if (anyMatch) {
        const allowed = new Set(params[Number(anyMatch[1]) - 1]);
        rows = rows.filter((p) => allowed.has(p.position));
      }
      return {
        rows: rows.map((p) => ({ ...p, total_count: String(rows.length), identity_ids: [p.id] })),
      };
    }
    if (text.includes('FROM "nfl_games"') || text.includes('FROM "player_season_stats"')) {
      return { rows: [] };
    }
    throw new Error(`unexpected query: ${text}`);
  });
}

// Same, but wired for a leagueId request: membership + league row lookups,
// plus the availability/roster-count reads the context block needs.
// `capture`, when given, records the bound ANY() array (or null if the query
// carried no position filter at all) as `capture.allowed`, so a test can
// assert directly on what reached the SQL params, not just the response.
function mockPoolWithLeague(t, { leagueRow, players, capture = null }) {
  return t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.startsWith('SELECT * FROM "teams"')) {
      return { rows: [{ id: 17, league_id: leagueRow.id, owner_id: 7, faab_remaining: 0, waiver_priority: 1 }] };
    }
    if (text.startsWith('SELECT * FROM "leagues"')) {
      return { rows: [leagueRow] };
    }
    if (text.includes('FROM "players" AS "source"')) {
      const anyMatch = text.match(/(?<!\.)"position" = ANY\(\$(\d+)\)/);
      let rows = players;
      if (anyMatch) {
        const allowed = params[Number(anyMatch[1]) - 1];
        if (capture) capture.allowed = allowed;
        const allowedSet = new Set(allowed);
        rows = rows.filter((p) => allowedSet.has(p.position));
      } else if (capture) {
        capture.allowed = null;
      }
      return {
        rows: rows.map((p) => ({ ...p, total_count: String(rows.length), identity_ids: [p.id] })),
      };
    }
    if (text.includes('FROM "nfl_games"') || text.includes('FROM "player_season_stats"')) {
      return { rows: [] };
    }
    if (text.includes('COUNT(*)::int AS "roster_count"')) return { rows: [{ roster_count: 0 }] };
    if (text.includes('FROM "team_players"')) return { rows: [] };
    if (text.includes('FROM "waiver_players"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
}

function authedGet(qs) {
  const token = signToken({ id: 7, username: 'member' });
  return request(app).get(`/api/players${qs}`).set('Authorization', `Bearer ${token}`);
}

function positionsOf(res) {
  return res.body.players.map((p) => p.position).sort();
}

test('multi-position filter: positions=RB,WR,TE returns only those positions', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?positions=RB,WR,TE');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['RB', 'TE', 'WR']);
});

test('multi-position filter: a bad code in the set is rejected with the same 400 shape', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?positions=RB,ZZ');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /position must be one of/);
});

// Formal review f1 (#1419): the Players page's own IDP group chips (DL, LB,
// DB) send `positions` as the WHOLE expanded POSITION_GROUPS set for that
// key, not just the six codes Tank01 commonly reports - so the whitelist has
// to accept every member, rare codes included, or a manager in an IDP league
// gets a 400 the moment they pick a defender chip.
test('the DL group chip request (positions=DL,DE,DT,NT) is accepted', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?positions=DL,DE,DT,NT');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['DE', 'DL', 'DT', 'NT']);
});

test('the LB group chip request (positions=LB,ILB,OLB) is accepted', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?positions=LB,ILB,OLB');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['ILB', 'LB', 'OLB']);
});

test('the DB group chip request (positions=DB,CB,S,FS,SS) is accepted', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?positions=DB,CB,S,FS,SS');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['CB', 'DB', 'FS', 'S', 'SS']);
});

test('the existing single-position parameter keeps working unchanged', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?position=QB');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['QB']);
});

test('a request with no league id is not gated', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), [...ALL_POSITION_PLAYERS.map((p) => p.position)].sort());
});

test('a non-IDP league excludes defenders from "All"', async (t) => {
  const leagueRow = {
    id: 1,
    name: 'Standard League',
    waiver_type: 'faab',
    current_season: 2026,
    roster_slots: DEFAULT_ROSTER_SLOTS,
  };
  mockPoolWithLeague(t, { leagueRow, players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?leagueId=1');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['DEF', 'K', 'QB', 'RB', 'TE', 'WR']);
});

test('a non-IDP league excludes defenders from an explicit defender request too', async (t) => {
  const leagueRow = {
    id: 1,
    name: 'Standard League',
    waiver_type: 'faab',
    current_season: 2026,
    roster_slots: DEFAULT_ROSTER_SLOTS,
  };
  mockPoolWithLeague(t, { leagueRow, players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?leagueId=1&positions=LB,CB,DB');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), []);
});

test('a FLEX-template league (no TE slot) intersects an RB,WR,TE request down to RB,WR', async (t) => {
  const leagueRow = {
    id: 2,
    name: 'RB/WR Flex League',
    waiver_type: 'faab',
    current_season: 2026,
    roster_slots: [
      { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
      { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
      { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR'] },
      { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
      { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
      { key: 'BENCH', label: 'Bench', count: 5, eligiblePositions: [] },
      { key: 'IR', label: 'IR', count: 1, eligiblePositions: [] },
    ],
  };
  mockPoolWithLeague(t, { leagueRow, players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?leagueId=2&positions=RB,WR,TE');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['RB', 'WR']);
});

test('a missing roster template applies no gate', async (t) => {
  const leagueRow = {
    id: 3,
    name: 'Untemplated League',
    waiver_type: 'faab',
    current_season: 2026,
    // roster_slots intentionally absent
  };
  mockPoolWithLeague(t, { leagueRow, players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?leagueId=3');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), [...ALL_POSITION_PLAYERS.map((p) => p.position)].sort());
});

test('an empty roster template applies no gate', async (t) => {
  const leagueRow = {
    id: 4,
    name: 'Empty Template League',
    waiver_type: 'faab',
    current_season: 2026,
    roster_slots: [],
  };
  mockPoolWithLeague(t, { leagueRow, players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?leagueId=4');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), [...ALL_POSITION_PLAYERS.map((p) => p.position)].sort());
});

// formal review f1: a count-0 slot row seats nobody (the same treatment
// optimalLineup's own `s.count > 0` filter, and the lineup cap that uses
// `count` as its max, already give it), so it must contribute nothing to the
// rosterable set - a league that zeroed out its K and DP (DL/LB/DB) slots
// rather than removing them still excludes kickers and every defender code.
test('a count-0 slot row is never rosterable: zeroed K and DP slots exclude kickers and defenders from "All"', async (t) => {
  const leagueRow = {
    id: 5,
    name: 'Zeroed-Out Slots League',
    waiver_type: 'faab',
    current_season: 2026,
    roster_slots: [
      { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
      { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
      { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
      { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
      { key: 'K', label: 'K', count: 0, eligiblePositions: ['K'] },
      { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
      { key: 'DP', label: 'DP', count: 0, eligiblePositions: ['DL', 'LB', 'DB'] },
    ],
  };
  const capture = {};
  mockPoolWithLeague(t, { leagueRow, players: ALL_POSITION_PLAYERS, capture });
  const res = await authedGet('?leagueId=5');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), ['DEF', 'QB', 'RB', 'TE', 'WR']);
  // Neither a kicker nor any defender code reached the SQL params.
  assert.ok(Array.isArray(capture.allowed), 'the query must still carry a position filter');
  assert.equal(capture.allowed.includes('K'), false);
  for (const idpCode of ['DE', 'DT', 'NT', 'DL', 'LB', 'ILB', 'OLB', 'CB', 'S', 'FS', 'SS', 'DB']) {
    assert.equal(capture.allowed.includes(idpCode), false, `${idpCode} must not be in the bound ANY() array`);
  }
});

// formal review f2: `positions=,` parses to an all-empty code set, which
// carries nothing to filter by - treated as absent, the same as `positions`
// omitted entirely, rather than binding an empty ANY() array that would zero
// out the whole pool.
test('positions=, (an all-empty code set) is treated as absent, not an empty filter', async (t) => {
  mockPoolNoLeague(t, { players: ALL_POSITION_PLAYERS });
  const res = await authedGet('?positions=,');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(positionsOf(res), [...ALL_POSITION_PLAYERS.map((p) => p.position)].sort());
});
