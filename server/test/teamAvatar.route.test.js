const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const pool = require('../modules/pool');
const supabaseAdminModule = require('../modules/supabaseAdmin');
const { signToken } = require('../modules/auth');
const teamRouter = require('../routes/team.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'team-avatar-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);

function mockStorage() {
  return {
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
        getPublicUrl: (path) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/team-avatars/${path}` },
        }),
      }),
    },
  };
}

async function tinyPng(size = 40) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 5, g: 5, b: 200 } } })
    .png()
    .toBuffer();
}

test('POST /api/team/:id/avatar uploads and returns the updated team', async (t) => {
  supabaseAdminModule.supabaseAdmin = mockStorage();
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('SELECT "avatar_url", "avatar_static_url" FROM "teams"')) {
      return { rows: [{ avatar_url: null, avatar_static_url: null }] };
    }
    if (text.startsWith('UPDATE "teams" SET "avatar_url"')) {
      return { rows: [{ id: 5, avatar_url: params[0], avatar_static_url: params[1] }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'alice' });
  const response = await request(app)
    .post('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', await tinyPng(), 'logo.png');

  assert.equal(response.status, 200);
  assert.match(response.body.avatar_url, /team-5\/\d+\.png$/);
});

test('POST /api/team/:id/avatar rejects a non-owner with 403', async (t) => {
  supabaseAdminModule.supabaseAdmin = mockStorage();
  t.mock.method(pool, 'query', async () => ({ rows: [] }));

  const token = signToken({ id: 99, username: 'mallory' });
  const response = await request(app)
    .post('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', await tinyPng(), 'logo.png');

  assert.equal(response.status, 403);
});

test('POST /api/team/:id/avatar rejects a non-image file with 400', async (t) => {
  supabaseAdminModule.supabaseAdmin = mockStorage();
  t.mock.method(pool, 'query', async () => ({ rows: [{ avatar_url: null, avatar_static_url: null }] }));

  const token = signToken({ id: 7, username: 'alice' });
  const response = await request(app)
    .post('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', Buffer.from('not an image'), 'file.png');

  assert.equal(response.status, 400);
});

test('POST /api/team/:id/avatar rejects a file over the size cap with 400', async (t) => {
  supabaseAdminModule.supabaseAdmin = mockStorage();
  t.mock.method(pool, 'query', async () => ({ rows: [{ avatar_url: null, avatar_static_url: null }] }));

  const token = signToken({ id: 7, username: 'alice' });
  const oversized = Buffer.alloc(6 * 1024 * 1024, 0);
  const response = await request(app)
    .post('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', oversized, 'huge.png');

  assert.equal(response.status, 400);
  assert.match(response.body.error, /too large/);
});

test('POST /api/team/:id/avatar rejects a non-numeric team id with 400', async (t) => {
  supabaseAdminModule.supabaseAdmin = mockStorage();
  const token = signToken({ id: 7, username: 'alice' });
  const response = await request(app)
    .post('/api/team/not-a-number/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', await tinyPng(), 'logo.png');

  assert.equal(response.status, 400);
});

test('DELETE /api/team/:id/avatar resets the avatar to null', async (t) => {
  supabaseAdminModule.supabaseAdmin = mockStorage();
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('SELECT "avatar_url", "avatar_static_url" FROM "teams"')) {
      return { rows: [{ avatar_url: 'https://x/storage/v1/object/public/team-avatars/team-5/1.png', avatar_static_url: null }] };
    }
    if (text.startsWith('UPDATE "teams" SET "avatar_url" = NULL')) {
      assert.equal(params[0], 5);
      assert.equal(params[1], 7);
      return { rows: [{ id: 5, avatar_url: null, avatar_static_url: null }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const token = signToken({ id: 7, username: 'alice' });
  const response = await request(app)
    .delete('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 200);
  assert.equal(response.body.avatar_url, null);
});

test('DELETE /api/team/:id/avatar rejects a non-owner with 403', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  const token = signToken({ id: 99, username: 'mallory' });
  const response = await request(app)
    .delete('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
});
