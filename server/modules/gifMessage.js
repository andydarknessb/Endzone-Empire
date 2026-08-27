'use strict';

/**
 * The GIF message contract and its send-time guards (#446, parent #429).
 *
 * A GIF message is a structured League-chat message that names exactly ONE
 * provider asset, carries an OPTIONAL caption and a REQUIRED accessible
 * description (AC1). It is stored as a `chat_messages` row (content_kind='gif';
 * see 20260827000021), so it inherits feed_seq, the shared position claim,
 * moderation, blocking, idempotency, reconnect and retention unchanged. This
 * module is the PURE contract: it validates an inbound send payload and never
 * touches the socket, the pool or any provider. draftSocket's chat:send calls
 * it, then composes the INSERT.
 *
 * AC2 IS STRUCTURAL, AND THIS GUARD IS THE SECOND BARRIER. The store has no url
 * column and no blob column, so a message can only ever name an asset as
 * (provider, assetId) - there is nowhere to persist a URL or an upload. This
 * guard is the app-level half of that: an asset id (and provider) must be an
 * OPAQUE token from a strict allowlist charset, so a URL (has `:` `/` `.`), a
 * data: / blob: payload, a path, or whitespace all FAIL the positive match
 * rather than being blocklisted one shape at a time. A payload that carries a
 * url / upload / bytes key at all is refused outright, before any field check,
 * because a well-formed client never sends one and its presence is the tell of
 * an attempt to smuggle media the message path does not accept.
 *
 * The avatar upload path (team.router -> avatar.service, its own Supabase
 * bucket, magic-byte sniff) is a DIFFERENT surface with the opposite rule and is
 * untouched by this guard: same word ("upload"), different surface, separate
 * storage.
 *
 * Every refusal is a SCREAMING_SNAKE code a client branches on (ADR 0008); the
 * message is copy. Capability enablement is decided by the caller and passed in
 * as `enabled` (disabled by default, AC9) rather than read here, so this module
 * stays pure and the one flag lives in one place (gifCapability.js).
 */

const TEXT = 'text';
const GIF = 'gif';

const GIF_CODES = Object.freeze({
  DISABLED: 'GIF_PROVIDER_DISABLED',
  DESCRIPTION_REQUIRED: 'DESCRIPTION_REQUIRED',
  DESCRIPTION_TOO_LONG: 'DESCRIPTION_TOO_LONG',
  MEDIA_NOT_ALLOWED: 'MEDIA_NOT_ALLOWED',
  INVALID: 'INVALID_REQUEST',
});

// The accessible description shares the message column bound (varchar 500) and
// is counted in Unicode code points, the same unit MAX_CHAT_CHARS and the
// column use (#443).
const GIF_DESCRIPTION_MAX = 500;

// A provider id and an asset id are OPAQUE tokens, not URLs or uploads. The
// charset is a positive allowlist: letters, digits, underscore, hyphen (and a
// dot in an asset id, which some providers use in an id) - and nothing a URL,
// data: payload, path or whitespace needs. Bounds mirror the columns
// (gif_provider varchar 64, gif_asset_id varchar 255).
const PROVIDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const ASSET_ID_PATTERN = /^[A-Za-z0-9_.-]{1,255}$/;

// Keys a well-formed GIF payload never carries; their presence is an attempt to
// hand the message path a URL or an upload, which it does not accept (AC2).
const FORBIDDEN_MEDIA_KEYS = ['url', 'uri', 'dataUri', 'src', 'file', 'upload', 'bytes', 'blob'];

/**
 * Whether a value reads as a URL or an upload rather than an opaque asset id.
 * A convenience for callers and tests; the actual send guard uses the positive
 * ASSET_ID_PATTERN, of which this is the negative shadow for the common shapes.
 */
function looksLikeUrlOrUpload(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v === '') return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return true; // scheme: http:, data:, blob:, ftp:, file:
  if (v.startsWith('//')) return true; // protocol-relative
  if (v.includes('://')) return true;
  if (/[\s<>]/.test(v)) return true;
  return false;
}

function fail(code, error, extra = {}) {
  return { ok: false, code, error, ...extra };
}

function codePointLength(value) {
  return Array.from(value).length;
}

/**
 * Validate an inbound GIF send payload against the contract.
 *
 * @param {object} payload   { provider, assetId, description, caption? }
 * @param {object} options   { enabled } - the GIF-message capability state
 * @returns {{ ok: true, value: { provider, assetId, description, caption } }
 *          | { ok: false, code, error, ...extra }}
 *
 * The caption's LENGTH is intentionally NOT bounded here: the handler runs the
 * caption through the same code-point MESSAGE_TOO_LONG check every chat message
 * gets (#502), so there is one length rule, not two. This function only
 * normalizes an absent/blank caption to null (a GIF may have none, AC1).
 */
function validateGifSend(payload, { enabled } = {}) {
  // Capability gate first (AC7): a client that never rendered the picker can
  // still emit the event, so the refusal is server-side, not a disabled button.
  if (!enabled) return fail(GIF_CODES.DISABLED, 'GIF messages are not enabled');

  if (!payload || typeof payload !== 'object') {
    return fail(GIF_CODES.INVALID, 'a GIF message payload is required');
  }

  // No url/upload/bytes key may ride on a GIF payload at all (AC2).
  for (const key of FORBIDDEN_MEDIA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      return fail(GIF_CODES.MEDIA_NOT_ALLOWED, 'a GIF message references a provider asset, not a URL or an upload');
    }
  }

  const { provider, assetId, description, caption } = payload;

  if (typeof provider !== 'string' || !PROVIDER_PATTERN.test(provider.trim())) {
    return fail(GIF_CODES.MEDIA_NOT_ALLOWED, 'a GIF provider must be a valid provider id');
  }
  if (typeof assetId !== 'string' || !ASSET_ID_PATTERN.test(assetId.trim())) {
    return fail(GIF_CODES.MEDIA_NOT_ALLOWED, 'a GIF asset must be a provider id, not a URL or an upload');
  }

  // Description is required and blocks send when missing (AC3).
  if (typeof description !== 'string' || description.trim() === '') {
    return fail(GIF_CODES.DESCRIPTION_REQUIRED, 'a GIF message requires an accessible description');
  }
  const desc = description.trim();
  const descLength = codePointLength(desc);
  if (descLength > GIF_DESCRIPTION_MAX) {
    return fail(
      GIF_CODES.DESCRIPTION_TOO_LONG,
      `description must be at most ${GIF_DESCRIPTION_MAX} characters`,
      { limit: GIF_DESCRIPTION_MAX, length: descLength }
    );
  }

  // Caption is optional; an absent or blank caption is null, never an empty
  // string, so a GIF with no caption stores message = NULL (AC1).
  let cap = null;
  if (caption !== undefined && caption !== null) {
    if (typeof caption !== 'string') {
      return fail(GIF_CODES.INVALID, 'caption must be a string');
    }
    const trimmed = caption.trim();
    cap = trimmed === '' ? null : trimmed;
  }

  return { ok: true, value: { provider: provider.trim(), assetId: assetId.trim(), description: desc, caption: cap } };
}

module.exports = {
  TEXT,
  GIF,
  GIF_CODES,
  GIF_DESCRIPTION_MAX,
  PROVIDER_PATTERN,
  ASSET_ID_PATTERN,
  FORBIDDEN_MEDIA_KEYS,
  looksLikeUrlOrUpload,
  validateGifSend,
};
