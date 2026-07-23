const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const supabaseAdminModule = require('../modules/supabaseAdmin');
const { signToken } = require('../modules/auth');
const commissionerRouter = require('../routes/commissioner.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'commissioner-avatar-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/commissioner', commissionerRouter);

function withMockClient(t, handlers) {
  const client = {
    query: async (sql, params) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      for (const [pattern, handler] of handlers) {
        if (pattern.test(text)) return handler(text, params);
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return client;
}

test('DELETE .../teams/:teamId/avatar requires the commissioner', async (t) => {
  withMockClient(t, [
    [/^BEGIN$/, () => ({})],
    [/^ROLLBACK$/, () => ({})],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 1, owner_id: 999, current_season: 2026, current_week: 1 }] })],
  ]);
  const token = signToken({ id: 7, username: 'not-the-commish' });
  const response = await request(app)
    .delete('/api/commissioner/league/1/teams/5/avatar')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 403);
});

test('DELETE .../teams/:teamId/avatar clears the avatar and privately notifies the owner (not the league)', async (t) => {
  supabaseAdminModule.supabaseAdmin = null; // storage cleanup is best-effort; irrelevant to this assertion
  const notifyInserts = [];
  withMockClient(t, [
    [/^BEGIN$/, () => ({})],
    [/^COMMIT$/, () => ({})],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 1, owner_id: 7, current_season: 2026, current_week: 1 }] })],
    [
      /^SELECT "owner_id", "avatar_url", "avatar_static_url" FROM "teams"/,
      () => ({ rows: [{ owner_id: 42, avatar_url: null, avatar_static_url: null }] }),
    ],
    [/^UPDATE "teams" SET "avatar_url" = NULL/, () => ({ rows: [] })],
    [
      /^INSERT INTO "transactions"/,
      (text, params) => {
        assert.match(params[3], /remove_team_avatar/); // detail jsonb is bound, not inlined
        return { rows: [] };
      },
    ],
    [
      /^INSERT INTO "notifications"/,
      () => {
        notifyInserts.push('recorded');
        return { rows: [] };
      },
    ],
  ]);

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .delete('/api/commissioner/league/1/teams/5/avatar')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  // Exactly one notification row — a private notify() to the owner, never a
  // notifyLeague() broadcast (which would insert one row per team owner).
  assert.equal(notifyInserts.length, 1);
});

test('DELETE .../teams/:teamId/avatar 404s when the team is not in that league', async (t) => {
  withMockClient(t, [
    [/^BEGIN$/, () => ({})],
    [/^ROLLBACK$/, () => ({})],
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ id: 1, owner_id: 7, current_season: 2026, current_week: 1 }] })],
    [/^SELECT "owner_id", "avatar_url", "avatar_static_url" FROM "teams"/, () => ({ rows: [] })],
  ]);
  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .delete('/api/commissioner/league/1/teams/999/avatar')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(response.status, 404);
});
