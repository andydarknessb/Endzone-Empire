const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-auction-settings-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);
const authorization = () => `Bearer ${signToken({ id: 7, username: 'commissioner' })}`;
const auctionSettings = (nominationCustomOrder) => ({
  budget: 200,
  nominationSeconds: 30,
  bidSeconds: 15,
  nominationOrder: 'custom',
  nominationCustomOrder,
});

function transactionClient() {
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
            keepers_enabled: false, keeper_count: 0, team_count: 2,
          }],
        };
      }
      if (text === 'SELECT "id" FROM "teams" WHERE "league_id" = $1') {
        return { rows: [{ id: 11 }, { id: 12 }] };
      }
      if (text.startsWith('UPDATE "leagues"')) {
        return { rows: [{ id: 1, owner_id: 7, draft_status: 'pending' }] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  return { calls, client };
}

test('accepts and commits an exact custom auction order', async (t) => {
  const tx = transactionClient();
  t.mock.method(pool, 'connect', async () => tx.client);

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ auctionSettings: auctionSettings([12, 11]) });

  assert.equal(response.status, 200);
  assert.ok(tx.calls.includes('COMMIT'));
  assert.ok(tx.calls.some((sql) => sql.startsWith('UPDATE "leagues"')));
});

for (const [name, order] of [
  ['missing team', [11]],
  ['stale removed team', [11, 99]],
]) {
  test(`rejects a custom auction order with a ${name}`, async (t) => {
    const tx = transactionClient();
    t.mock.method(pool, 'connect', async () => tx.client);

    const response = await request(app)
      .put('/api/league/1')
      .set('Authorization', authorization())
      .send({ auctionSettings: auctionSettings(order) });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /must list every current team exactly once/);
    assert.ok(tx.calls.some((sql) => sql.includes('FOR UPDATE')));
    assert.ok(tx.calls.includes('ROLLBACK'));
    assert.ok(!tx.calls.some((sql) => sql.startsWith('UPDATE "leagues"')));
  });
}
