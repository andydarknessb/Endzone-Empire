const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const pool = require('../modules/pool');
const supabaseAdminModule = require('../modules/supabaseAdmin');
const avatarService = require('../services/avatar.service');

async function tinyPng(size = 40) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 200, g: 20, b: 20 } } })
    .png()
    .toBuffer();
}

// A real (if single-frame) GIF above the minimum dimension — big enough to
// clear the 32x32 floor, and its "gif" branch in processUpload doesn't care
// about true frame count, only the sniffed extension.
async function tinyGif(size = 40) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 10, g: 200, b: 10 } } })
    .gif()
    .toBuffer();
}

function mockStorage({ uploadError = null } = {}) {
  const uploaded = [];
  const removed = [];
  return {
    uploaded,
    removed,
    storage: {
      from: () => ({
        upload: async (path, buffer, opts) => {
          uploaded.push({ path, buffer, opts });
          return uploadError ? { error: uploadError } : { error: null };
        },
        remove: async (paths) => {
          removed.push(...paths);
          return { error: null };
        },
        getPublicUrl: (path) => ({
          data: { publicUrl: `https://example.supabase.co/storage/v1/object/public/team-avatars/${path}` },
        }),
      }),
    },
  };
}

beforeEach(() => {
  supabaseAdminModule.supabaseAdmin = mockStorage();
});

test('processUpload rejects an unrecognized file type', async () => {
  await assert.rejects(
    () => avatarService.processUpload(Buffer.from('not an image')),
    (err) => err.statusCode === 400
  );
});

test('processUpload rejects an empty buffer', async () => {
  await assert.rejects(
    () => avatarService.processUpload(Buffer.alloc(0)),
    (err) => err.statusCode === 400
  );
});

test('processUpload rejects an image below the minimum dimension', async () => {
  const tiny = await tinyPng(10);
  await assert.rejects(
    () => avatarService.processUpload(tiny),
    (err) => err.statusCode === 400 && /dimensions/.test(err.message)
  );
});

test('processUpload normalizes a static PNG to 512x512 and reports no static variant', async () => {
  const input = await tinyPng(100);
  const result = await avatarService.processUpload(input);
  assert.equal(result.ext, 'png');
  assert.equal(result.staticBuffer, null);
  const outMeta = await sharp(result.mainBuffer).metadata();
  assert.equal(outMeta.width, 512);
  assert.equal(outMeta.height, 512);
});

test('processUpload passes an animated GIF through untouched and derives a static frame', async () => {
  const gif = await tinyGif();
  const result = await avatarService.processUpload(gif);
  assert.equal(result.ext, 'gif');
  assert.ok(Buffer.isBuffer(result.staticBuffer), 'static frame should be generated for GIF uploads');
  assert.ok(result.mainBuffer.equals(gif), 'GIF bytes must be passed through unmodified');
  const staticMeta = await sharp(result.staticBuffer).metadata();
  assert.equal(staticMeta.format, 'png');
});

test('uploadTeamAvatar rejects a team the caller does not own', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  const buffer = await tinyPng();
  await assert.rejects(
    () => avatarService.uploadTeamAvatar({ teamId: 1, ownerId: 99, buffer }),
    (err) => err.statusCode === 403
  );
});

test('uploadTeamAvatar stores the processed image and updates both columns', async (t) => {
  let updateParams = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('SELECT "avatar_url", "avatar_static_url" FROM "teams"')) {
      return { rows: [{ avatar_url: 'https://example.supabase.co/storage/v1/object/public/team-avatars/team-1/old.png', avatar_static_url: null }] };
    }
    if (text.startsWith('UPDATE "teams" SET "avatar_url"')) {
      updateParams = params;
      return { rows: [{ id: 1, avatar_url: params[0], avatar_static_url: params[1] }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const team = await avatarService.uploadTeamAvatar({ teamId: 1, ownerId: 7, buffer: await tinyPng() });
  assert.match(team.avatar_url, /team-1\/\d+\.png$/);
  assert.equal(team.avatar_static_url, null);
  assert.equal(updateParams[2], 1); // teamId
  assert.equal(updateParams[3], 7); // ownerId
});

test('uploadTeamAvatar uploads a static-frame sibling for GIF uploads', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('SELECT "avatar_url", "avatar_static_url" FROM "teams"')) {
      return { rows: [{ avatar_url: null, avatar_static_url: null }] };
    }
    if (text.startsWith('UPDATE "teams" SET "avatar_url"')) {
      return { rows: [{ id: 1, avatar_url: params[0], avatar_static_url: params[1] }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const team = await avatarService.uploadTeamAvatar({ teamId: 1, ownerId: 7, buffer: await tinyGif() });
  assert.match(team.avatar_url, /team-1\/\d+\.gif$/);
  assert.match(team.avatar_static_url, /team-1\/\d+-static\.png$/);
});

test('uploadTeamAvatar best-effort deletes the previous avatar objects after a successful replace', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('SELECT "avatar_url", "avatar_static_url" FROM "teams"')) {
      return {
        rows: [{
          avatar_url: 'https://example.supabase.co/storage/v1/object/public/team-avatars/team-1/111.png',
          avatar_static_url: null,
        }],
      };
    }
    if (text.startsWith('UPDATE "teams" SET "avatar_url"')) {
      return { rows: [{ id: 1, avatar_url: params[0], avatar_static_url: params[1] }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  await avatarService.uploadTeamAvatar({ teamId: 1, ownerId: 7, buffer: await tinyPng() });
  // deleteAvatarObjects is fire-and-forget (`void ...`) — flush microtasks once.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(supabaseAdminModule.supabaseAdmin.removed, ['team-1/111.png']);
});

test('removeTeamAvatar rejects a team the caller does not own', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  await assert.rejects(
    () => avatarService.removeTeamAvatar({ teamId: 1, ownerId: 99 }),
    (err) => err.statusCode === 403
  );
});

test('removeTeamAvatar clears both columns and deletes storage objects', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('SELECT "avatar_url", "avatar_static_url" FROM "teams"')) {
      return {
        rows: [{
          avatar_url: 'https://example.supabase.co/storage/v1/object/public/team-avatars/team-1/a.gif',
          avatar_static_url: 'https://example.supabase.co/storage/v1/object/public/team-avatars/team-1/a-static.png',
        }],
      };
    }
    if (text.startsWith('UPDATE "teams" SET "avatar_url" = NULL')) {
      assert.equal(params[0], 1);
      assert.equal(params[1], 7);
      return { rows: [{ id: 1, avatar_url: null, avatar_static_url: null }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const team = await avatarService.removeTeamAvatar({ teamId: 1, ownerId: 7 });
  assert.equal(team.avatar_url, null);
  assert.equal(team.avatar_static_url, null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    new Set(supabaseAdminModule.supabaseAdmin.removed),
    new Set(['team-1/a.gif', 'team-1/a-static.png'])
  );
});

test('uploadTeamAvatar fails with 503 when storage is not configured', async (t) => {
  supabaseAdminModule.supabaseAdmin = null;
  t.mock.method(pool, 'query', async () => ({ rows: [{ avatar_url: null, avatar_static_url: null }] }));
  const buffer = await tinyPng();
  await assert.rejects(
    () => avatarService.uploadTeamAvatar({ teamId: 1, ownerId: 7, buffer }),
    (err) => err.statusCode === 503
  );
});
