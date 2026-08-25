const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'keeper-settings-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);
const authorization = () => `Bearer ${signToken({ id: 7, username: 'commissioner' })}`;

function transactionClient({ currentCount = 2, assignmentCounts = [] } = {}) {
  const calls = [];
  const client = {
    release: () => calls.push('RELEASE'),
    query: async (sql) => {
      const text = String(sql);
      calls.push(text);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('SELECT "draft_status"')) {
        return {
          rows: [{
            draft_status: 'pending', min_teams: 2, max_teams: 12, draft_date: null,
            roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
            keepers_enabled: true, keeper_count: currentCount, team_count: 2,
          }],
        };
      }
      if (text.includes('COUNT(*)::int AS "count"')) return { rows: assignmentCounts };
      if (text.startsWith('DELETE FROM "keepers"')) return { rows: [], rowCount: assignmentCounts.length };
      if (text.startsWith('UPDATE "leagues"')) return { rows: [{ id: 1, owner_id: 7, draft_status: 'pending' }] };
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  return { calls, client };
}

test('disabling keepers clears assignments and commits the settings update', async (t) => {
  const tx = transactionClient({ assignmentCounts: [{ team_id: 11, count: 2 }] });
  t.mock.method(pool, 'connect', async () => tx.client);

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ keepersEnabled: false });

  assert.equal(response.status, 200);
  assert.ok(tx.calls.some((sql) => sql.startsWith('DELETE FROM "keepers"')));
  assert.ok(tx.calls.includes('COMMIT'));
  assert.ok(!tx.calls.includes('ROLLBACK'));
});

test('reducing keeper count below existing assignments rolls back with a clear conflict', async (t) => {
  const tx = transactionClient({ currentCount: 2, assignmentCounts: [{ team_id: 11, count: 2 }] });
  t.mock.method(pool, 'connect', async () => tx.client);

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ keeperCount: 1 });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /team 11 has 2/);
  assert.ok(tx.calls.includes('ROLLBACK')); // complementary only
  // #274. UPDATE "leagues" is the live half of this assertion and the reason
  // it exists: transactionClient answers it, so a guard moved below it saves
  // the settings and returns this identical 409.
  //
  // DELETE FROM "keepers" is swept alongside it for completeness, and is NOT
  // load-bearing today - said plainly so nobody reads it as proof it is not.
  // keeperSettingsPlan returns clearAssignments: false on every branch where
  // it also sets error (draftValidation.service.js:177-181), and the DELETE is
  // gated on clearAssignments, so a conflict and a wipe are mutually exclusive
  // by construction. It is here to catch a future refactor that decouples
  // them, not to catch a moved guard.
  assert.deepEqual(
    tx.calls.filter((sql) => /^(UPDATE "leagues"|DELETE FROM "keepers")/.test(sql)),
    [],
    'the settings write did not run (and no keeper wipe, which this branch cannot reach)'
  );
});

test('a valid keeper-count update preserves assignments and commits', async (t) => {
  const tx = transactionClient({ currentCount: 1, assignmentCounts: [{ team_id: 11, count: 1 }] });
  t.mock.method(pool, 'connect', async () => tx.client);

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ keeperCount: 2 });

  assert.equal(response.status, 200);
  assert.ok(tx.calls.some((sql) => sql.startsWith('UPDATE "leagues"')));
  assert.ok(tx.calls.includes('COMMIT'));
  assert.ok(!tx.calls.some((sql) => sql.startsWith('DELETE FROM "keepers"')));
});
