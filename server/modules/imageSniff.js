/**
 * Magic-byte content sniffing for team avatar uploads. Never trust a file's
 * extension or the client-supplied Content-Type — both are attacker-chosen.
 * This is the only gate on the animated-GIF pass-through path (see
 * avatar.service.js), so it has to recognize bytes, not metadata.
 *
 * SVG is deliberately not supported anywhere in this pipeline: it can embed
 * <script>, making it an XSS vector if ever served same-origin.
 */

const SIGNATURES = [
  { ext: 'png', mimeType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { ext: 'jpg', mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'gif', mimeType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
  { ext: 'gif', mimeType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
];

function matches(buffer, bytes) {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[i] !== bytes[i]) return false;
  }
  return true;
}

function isWebp(buffer) {
  // RIFF....WEBP: 'RIFF' at 0-3, 4-byte chunk size, 'WEBP' at 8-11.
  if (buffer.length < 12) return false;
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  return riff === 'RIFF' && webp === 'WEBP';
}

/**
 * Identify a buffer's true image format from its leading bytes.
 * @param {Buffer} buffer
 * @returns {{ ext: 'png'|'jpg'|'gif'|'webp', mimeType: string } | null}
 */
function sniffImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
  for (const sig of SIGNATURES) {
    if (matches(buffer, sig.bytes)) return { ext: sig.ext, mimeType: sig.mimeType };
  }
  if (isWebp(buffer)) return { ext: 'webp', mimeType: 'image/webp' };
  return null;
}

const ALLOWED_EXTENSIONS = ['png', 'jpg', 'gif', 'webp'];

module.exports = { sniffImageType, ALLOWED_EXTENSIONS };
