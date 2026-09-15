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
function mockPoolWithLeague(t, { leagueRow, players }) {
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
