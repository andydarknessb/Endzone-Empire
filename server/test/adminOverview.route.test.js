const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');

/**
 * GET /api/admin/overview, the leagues panel: rows are grouped by draft and
 * season status AND by league type, so pick'em-only leagues (which stay
 * draft-pending forever) do not inflate the "pending draft" bucket unseen.
 * Exercised over supertest with a fake pool answering each overview query.
 */

const previousSecret = process.env.JWT_SECRET;
const previousAdmins = process.env.PLATFORM_ADMIN_IDS;
process.env.JWT_SECRET = 'admin-overview-route-test-secret';
process.env.PLATFORM_ADMIN_IDS = '9';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
  if (previousAdmins === undefined) delete process.env.PLATFORM_ADMIN_IDS;
  else process.env.PLATFORM_ADMIN_IDS = previousAdmins;
});

const admin = () => `Bearer ${signToken({ id: 9, username: 'admin' })}`;

const app = express();
app.use(express.json());
app.use('/api/admin', require('../routes/admin.router'));

const LEAGUE_ROWS = [
  { draft_status: 'completed', season_status: 'in_progress', pickem_only: false, count: 4 },
  { draft_status: 'pending', season_status: 'not_started', pickem_only: true, count: 3 },
  { draft_status: 'pending', season_status: 'not_started', pickem_only: false, count: 2 },
];

function fakeDb(t) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push(text);
    if (/COUNT\(\*\)::int AS "total" FROM "users"/.test(text)) return { rows: [{ total: 42 }] };
    if (/AS "last7"/.test(text)) return { rows: [{ last7: 3, last30: 11 }] };
    if (/FROM "leagues" GROUP BY/.test(text)) return { rows: LEAGUE_ROWS };
    if (/FROM "users" ORDER BY "created_at" DESC/.test(text)) return { rows: [] };
    if (/FROM "player_stats"/.test(text)) return { rows: [{ season: 2026, week: 1, rows: 100 }] };
    if (/api_usage|quota/i.test(text)) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });
  return calls;
}

test('the leagues panel is grouped by league type as well as draft and season status', async (t) => {
  const calls = fakeDb(t);
  const res = await request(app).get('/api/admin/overview').set('Authorization', admin());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.leagues, LEAGUE_ROWS);
  const grouping = calls.find((q) => /FROM "leagues" GROUP BY/.test(q));
  assert.match(grouping, /GROUP BY "draft_status", "season_status", "pickem_only"/);
  assert.match(grouping.split(' FROM "leagues"')[0], /"pickem_only"/, 'the type is projected, not only grouped');
});
