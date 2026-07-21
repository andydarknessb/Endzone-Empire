const pool = require('../modules/pool');
// Referenced as `supabaseAdminModule.supabaseAdmin` throughout (not
// destructured) so tests can substitute a mock client on the shared module
// object — a destructured const would freeze in whatever the value was
// (often null, when env vars are unset) at require time.
const supabaseAdminModule = require('../modules/supabaseAdmin');
const { AVATAR_BUCKET } = supabaseAdminModule;
const { sniffImageType } = require('../modules/imageSniff');

class AvatarError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB — see design doc §4
const MIN_DIMENSION = 32;
const MAX_DIMENSION = 2048;
const TARGET_SIZE = 512;

const EXT_TO_SHARP_FORMAT = { png: 'png', jpg: 'jpeg', webp: 'webp' };

/**
 * Validate + transform an uploaded buffer into what actually gets stored.
 * Static images (png/jpg/webp) are normalized to a 512x512 cover crop, which
 * also strips EXIF as a side effect of re-encoding. Animated GIFs pass
 * through untouched (re-encoding risks breaking the animation and sharp's
 * animated pipeline is comparatively heavy) but still get dimension-checked,
 * and additionally yield a static first-frame PNG for prefers-reduced-motion
 * display (see TeamAvatar).
 *
 * @returns {{ ext: string, contentType: string, mainBuffer: Buffer, staticBuffer: Buffer|null }}
 */
async function processUpload(buffer) {
  // Lazy-required: sharp's native binary doesn't resolve inside Jest's
  // module sandbox on Windows (unrelated client-side tests transitively
  // require this file via team.router.js/commissioner.service.js without
  // ever calling processUpload), even though it works fine under plain Node.
  const sharp = require('sharp');
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AvatarError(400, 'no file uploaded');
  }
  const sniffed = sniffImageType(buffer);
  if (!sniffed) {
    throw new AvatarError(400, 'unsupported file type — must be PNG, JPEG, WEBP, or GIF');
  }

  let metadata;
  try {
    metadata = await sharp(buffer, { animated: sniffed.ext === 'gif' }).metadata();
  } catch (error) {
    throw new AvatarError(400, 'could not read image dimensions — file may be corrupt');
  }
  if (
    !metadata.width || !metadata.height
    || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION
    || metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION
  ) {
    throw new AvatarError(
      400,
      `image dimensions must be between ${MIN_DIMENSION}x${MIN_DIMENSION} and ${MAX_DIMENSION}x${MAX_DIMENSION}`
    );
  }

  if (sniffed.ext === 'gif') {
    // Cheap single-frame decode (animated: false) — not a full-GIF re-encode.
    const staticBuffer = await sharp(buffer, { animated: false }).png().toBuffer();
    return { ext: 'gif', contentType: 'image/gif', mainBuffer: buffer, staticBuffer };
  }

  const format = EXT_TO_SHARP_FORMAT[sniffed.ext];
  const mainBuffer = await sharp(buffer)
    .resize(TARGET_SIZE, TARGET_SIZE, { fit: 'cover' })
    [format]()
    .toBuffer();
  return { ext: sniffed.ext, contentType: sniffed.mimeType, mainBuffer, staticBuffer: null };
}

function requireStorage() {
  if (!supabaseAdminModule.supabaseAdmin) {
    throw new AvatarError(503, 'avatar storage is not configured on this server');
  }
}

function objectPath(teamId, suffix, ext) {
  return `team-${teamId}/${Date.now()}${suffix}.${ext}`;
}

function publicUrlFor(path) {
  return supabaseAdminModule.supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

function pathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/object/public/${AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

async function uploadObject(path, buffer, contentType) {
  const { error } = await supabaseAdminModule.supabaseAdmin.storage
    .from(AVATAR_BUCKET)
    .upload(path, buffer, { contentType, cacheControl: '31536000', upsert: false });
  if (error) throw new AvatarError(502, `avatar upload failed: ${error.message}`);
}

/**
 * Best-effort storage cleanup — failures are logged, never surfaced to the
 * caller. Takes a { avatar_url, avatar_static_url } shape (i.e. a raw teams
 * row, or a slice of one) since every caller has one of those on hand.
 */
async function deleteAvatarObjects({ avatar_url: avatarUrl, avatar_static_url: avatarStaticUrl } = {}) {
  if (!supabaseAdminModule.supabaseAdmin) return;
  const paths = [pathFromPublicUrl(avatarUrl), pathFromPublicUrl(avatarStaticUrl)].filter(Boolean);
  if (paths.length === 0) return;
  try {
    const { error } = await supabaseAdminModule.supabaseAdmin.storage.from(AVATAR_BUCKET).remove(paths);
    if (error) console.error('Error deleting old avatar object(s)', error);
  } catch (error) {
    console.error('Error deleting old avatar object(s)', error);
  }
}

/** Owner-initiated avatar upload/replace. Throws AvatarError(403) if not the team's owner. */
async function uploadTeamAvatar({ teamId, ownerId, buffer }) {
  requireStorage();
  const existing = await pool.query(
    `SELECT "avatar_url", "avatar_static_url" FROM "teams" WHERE "id" = $1 AND "owner_id" = $2`,
    [teamId, ownerId]
  );
  if (!existing.rows[0]) throw new AvatarError(403, 'team not found or not yours');

  const { ext, contentType, mainBuffer, staticBuffer } = await processUpload(buffer);
  const mainPath = objectPath(teamId, '', ext);
  await uploadObject(mainPath, mainBuffer, contentType);
  let staticPath = null;
  if (staticBuffer) {
    staticPath = objectPath(teamId, '-static', 'png');
    await uploadObject(staticPath, staticBuffer, 'image/png');
  }

  const avatarUrl = publicUrlFor(mainPath);
  const avatarStaticUrl = staticPath ? publicUrlFor(staticPath) : null;
  const result = await pool.query(
    `UPDATE "teams" SET "avatar_url" = $1, "avatar_static_url" = $2, "updated_at" = now()
     WHERE "id" = $3 AND "owner_id" = $4 RETURNING *`,
    [avatarUrl, avatarStaticUrl, teamId, ownerId]
  );
  if (!result.rows[0]) throw new AvatarError(403, 'team not found or not yours');

  void deleteAvatarObjects(existing.rows[0]);
  return result.rows[0];
}

/** Owner-initiated avatar removal (reset to the initials fallback). */
async function removeTeamAvatar({ teamId, ownerId }) {
  const existing = await pool.query(
    `SELECT "avatar_url", "avatar_static_url" FROM "teams" WHERE "id" = $1 AND "owner_id" = $2`,
    [teamId, ownerId]
  );
  if (!existing.rows[0]) throw new AvatarError(403, 'team not found or not yours');

  const result = await pool.query(
    `UPDATE "teams" SET "avatar_url" = NULL, "avatar_static_url" = NULL, "updated_at" = now()
     WHERE "id" = $1 AND "owner_id" = $2 RETURNING *`,
    [teamId, ownerId]
  );
  void deleteAvatarObjects(existing.rows[0]);
  return result.rows[0];
}

module.exports = {
  AvatarError,
  MAX_UPLOAD_BYTES,
  processUpload,
  uploadTeamAvatar,
  removeTeamAvatar,
  deleteAvatarObjects,
  pathFromPublicUrl,
};
