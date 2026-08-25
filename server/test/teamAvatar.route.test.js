const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const pool = require('../modules/pool');
const supabaseAdminModule = require('../modules/supabaseAdmin');
const { signToken } = require('../modules/auth');
const teamRouter = require('../routes/team.router');
const { createFakePool, select, update } = require('./helpers/fakePool');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'team-avatar-route-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/team', teamRouter);

// #274: the recorder is the point. A storage upload is not inside the request's
// transaction, so nothing rolls it back and no SQL seam can see it. These two
// arrays are the closest (and only) seam that can prove an ownership guard ran
// BEFORE the bytes reached the bucket.
function mockStorage() {
  const uploaded = [];
  const removed = [];
  return {
    uploaded,
    removed,
    storage: {
      from: () => ({
        upload: async (path) => { uploaded.push(path); return { error: null }; },
        remove: async (paths) => { removed.push(...paths); return { error: null }; },
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
  const storage = mockStorage();
  supabaseAdminModule.supabaseAdmin = storage;
  const fake = createFakePool([
    [select('teams'), () => ({ rows: [] })],
    [update('teams'), () => ({ rows: [] })],
  ]).install(t);

  const token = signToken({ id: 99, username: 'mallory' });
  const response = await request(app)
    .post('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', await tinyPng(), 'logo.png');

  assert.equal(response.status, 403);
  // #274. uploadTeamAvatar throws the identical AvatarError(403) both before
  // the upload and after the UPDATE finds no row, so the 403 above is the same
  // in a correct build and in one where the ownership check moved below the
  // bucket write. Only these counts separate them.
  assert.equal(storage.uploaded.length, 0, 'no object reached the bucket');
  assert.equal(fake.matching(update('teams')).length, 0, 'the row was not updated');
});

test('POST /api/team/:id/avatar rejects a non-image file with 400', async (t) => {
  const storage = mockStorage();
  supabaseAdminModule.supabaseAdmin = storage;
  const fake = createFakePool([
    [select('teams'), () => ({ rows: [{ avatar_url: null, avatar_static_url: null }] })],
    [update('teams'), () => ({ rows: [{ id: 5 }] })],
  ]).install(t);

  const token = signToken({ id: 7, username: 'alice' });
  const response = await request(app)
    .post('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', Buffer.from('not an image'), 'file.png');

  assert.equal(response.status, 400);
  // #274. The sniff refusal sits between the ownership read and the upload, so
  // the file it rejects must never be stored. Here the fixture answers the
  // UPDATE successfully, which is deliberate: the absence is an observation.
  assert.equal(storage.uploaded.length, 0, 'the rejected file was not stored');
  assert.equal(fake.matching(update('teams')).length, 0, 'no avatar url was recorded');
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
  const storage = mockStorage();
  supabaseAdminModule.supabaseAdmin = storage;
  // #274: this test previously mocked nothing at all, so a guard moved below
  // the work would have reached the REAL pool. The strongest form is available
  // here because this refusal should touch the database not at all.
  const fake = createFakePool([]).install(t);
  const token = signToken({ id: 7, username: 'alice' });
  const response = await request(app)
    .post('/api/team/not-a-number/avatar')
    .set('Authorization', `Bearer ${token}`)
    .attach('avatar', await tinyPng(), 'logo.png');

  assert.equal(response.status, 400);
  assert.equal(fake.calls.length, 0, 'no statement was issued at all');
  assert.equal(storage.uploaded.length, 0, 'nothing reached the bucket');
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
  // #274: this test set no storage mock of its own, so its storage seam was
  // whatever the previous test happened to leave on the shared module. It now
  // owns its recorder, which is what makes the removal count below mean
  // anything.
  const storage = mockStorage();
  supabaseAdminModule.supabaseAdmin = storage;
  const fake = createFakePool([
    [select('teams'), () => ({ rows: [] })],
    [update('teams'), () => ({ rows: [] })],
  ]).install(t);
  const token = signToken({ id: 99, username: 'mallory' });
  const response = await request(app)
    .delete('/api/team/5/avatar')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(response.status, 403);
  assert.equal(fake.matching(update('teams')).length, 0, 'the columns were not cleared');
  await new Promise((resolve) => setImmediate(resolve)); // deleteAvatarObjects is fire-and-forget
  assert.equal(storage.removed.length, 0, 'no object was deleted from the bucket');
});
