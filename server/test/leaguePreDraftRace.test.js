const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const { settingsUnfrozenWhereSql } = require('../services/leaguePhase');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-predraft-race-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

// Every settings save is a transaction (ADR 0033, #2717): BEGIN/COMMIT/ROLLBACK,
// the commissioner's SELECT 1 (a row for user 7) and the League lock are answered
// here; every other statement reaches the test's pool.query mock.
const SETTINGS_LOCK_SQL = 'UPDATE "leagues" SET "board_version" = "board_version" + 1 WHERE "id" = $1 RETURNING *';
function mockConnect(t) {
  t.mock.method(pool, 'connect', async () => ({
    query: (sql, params) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.startsWith('SELECT 1 FROM "leagues"')) return { rows: params[1] === 7 ? [{ '?column?': 1 }] : [] };
      if (text === SETTINGS_LOCK_SQL) return { rows: [{ id: 1 }] };
      return pool.query(sql, params);
    },
    release: () => {},
  }));
}

test('pre-draft settings reject a draft that starts between status check and update', async (t) => {
  let updateQuery = null;
  mockConnect(t);
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return {
        rows: [{
          draft_status: 'pending', min_teams: 2, max_teams: 12, draft_date: null,
          roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
          keepers_enabled: false, keeper_count: 0, team_count: 2,
        }],
      };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      updateQuery = text;
      // Simulate draftStart committing after the status read but before this UPDATE.
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', `Bearer ${token}`)
    .send({ pickTimeSeconds: 90 });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /locked once the draft starts/);
  // The UPDATE is guarded on the phase module's freeze rule (still pre-draft
  // for a fantasy league), so the draft that started in between zeroes it.
  assert.ok(updateQuery.includes(`AND ${settingsUnfrozenWhereSql()}`), updateQuery);
});

test('administrative-only updates remain available after draft start', async (t) => {
  let updateQuery = null;
  mockConnect(t);
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.startsWith('UPDATE "leagues"')) {
      updateQuery = text;
      return { rows: [{ id: 1, owner_id: 7, name: 'Renamed League', draft_status: 'active' }], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'commissioner' });
  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Renamed League' });

  assert.equal(response.status, 200);
  assert.ok(!updateQuery.includes(settingsUnfrozenWhereSql()), updateQuery);
});
