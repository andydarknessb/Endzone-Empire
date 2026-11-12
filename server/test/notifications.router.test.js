const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const notificationsRouter = require('../routes/notifications.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'notifications-router-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/notifications', notificationsRouter);

const authed = () => `Bearer ${signToken({ id: 9, username: 'commish' })}`;

// #2752: a join alert stored before the change names the requester's account
// in `message` and carries `data.userId`. The read names the proposed Team
// instead, or the league alone once the join request is gone.
test('GET notifications serves legacy join alerts by Team, with no account name or id', async (t) => {
  const legacy = [
    {
      id: 3, user_id: 9, league_id: 7, league_name: 'Curated League', type: 'join_request',
      message: 'eve requested to join Curated League', data: { requestId: 41, userId: 5 },
      read: false, created_at: '2026-11-01T10:00:00Z',
    },
    {
      id: 4, user_id: 9, league_id: 7, league_name: 'Curated League', type: 'join_request',
      message: 'frank requested to join Curated League', data: { requestId: 42, userId: 6 },
      read: false, created_at: '2026-11-01T09:00:00Z',
    },
  ];
  // Request 41 still stands; request 42 has been decided and its row is gone.
  const joinRequests = [{ id: 41, team_name: 'Eve Picks' }];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "notifications"') && text.includes('LIMIT 50')) return { rows: legacy };
    if (text.includes('COUNT(*)')) return { rows: [{ n: 2 }] };
    if (text.includes('FROM "join_requests"')) {
      return { rows: joinRequests.filter((row) => params[0].includes(row.id)) };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app).get('/api/notifications').set('Authorization', authed());

  assert.equal(res.status, 200);
  const [found, gone] = res.body.notifications;
  assert.equal(found.message, 'Eve Picks requested to join Curated League');
  assert.deepEqual(found.data, { requestId: 41 });
  assert.equal(gone.message, 'A join request is waiting in Curated League');
  assert.deepEqual(gone.data, { requestId: 42 });
});

// The requester's own approved and denied notices share the type and carry the
// same requestId, but no userId and no commissioner wording: served as stored,
// even though request 41 resolves to a Team.
test('GET notifications serves the requester\'s approved and denied notices untouched', async (t) => {
  const own = [
    {
      id: 5, user_id: 9, league_id: 7, league_name: 'Curated League', type: 'join_request',
      message: 'Your request to join Curated League was approved!', data: { requestId: 41 },
      read: false, created_at: '2026-11-02T10:00:00Z',
    },
    {
      id: 6, user_id: 9, league_id: 7, league_name: 'Curated League', type: 'join_request',
      message: 'Your request to join Curated League was denied.', data: { requestId: 42 },
      read: false, created_at: '2026-11-02T09:00:00Z',
    },
  ];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "notifications"') && text.includes('LIMIT 50')) return { rows: own };
    if (text.includes('COUNT(*)')) return { rows: [{ n: 2 }] };
    if (text.includes('FROM "join_requests"')) {
      return { rows: [{ id: 41, team_name: 'Eve Picks' }].filter((row) => params[0].includes(row.id)) };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const res = await request(app).get('/api/notifications').set('Authorization', authed());

  assert.equal(res.status, 200);
  const [approved, denied] = res.body.notifications;
  assert.equal(approved.message, 'Your request to join Curated League was approved!');
  assert.deepEqual(approved.data, { requestId: 41 });
  assert.equal(denied.message, 'Your request to join Curated League was denied.');
  assert.deepEqual(denied.data, { requestId: 42 });
});
