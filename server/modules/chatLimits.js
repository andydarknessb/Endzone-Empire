/**
 * The League chat length limit and its clamp, kept as a pure module (#486).
 *
 * These lived inside draftSocket.js when #443 introduced them, but that module
 * pulls in socket.io, the pg pool and the redis adapter, so it cannot be
 * required from a jsdom client test. #486 mirrors this limit in the composer's
 * character counter and pins the client constant equal to the server's, and
 * that parity test needs to import the value without loading the whole socket
 * stack. Lifting the constant and the clamp here - both pure, no requires -
 * keeps a single server-side definition that draftSocket re-exports unchanged,
 * so `server/test/chatSend.test.js` still requires them from draftSocket and
 * stays green.
 */

/** The chat message length limit, counted in Unicode CODE POINTS. A "character"
 *  here is one code point, not one UTF-16 code unit (#443): an astral emoji like
 *  👍 is a single character even though it is two code units, and a ZWJ sequence
 *  is several. The chat_messages.message column is varchar(500), which Postgres
 *  also counts in characters, so this limit and the column agree exactly. */
const MAX_CHAT_CHARS = 500;

/** Truncate a chat message to at most MAX_CHAT_CHARS characters (#443).
 *  Iterating by code point - Array.from uses the string iterator - makes the
 *  cut land on a code-point boundary, so it can never bisect a surrogate pair
 *  into a lone surrogate the way a UTF-16-unit `slice(0, 500)` would to an emoji
 *  straddling the boundary. That is the guarantee the limit actually owes and
 *  the only one it makes (#443 AC3, corrected #488): every code point kept is a
 *  whole code point, so the result is always valid UTF-8 and storable as text.
 *
 *  It does NOT keep every emoji whole. A single grapheme is often several code
 *  points - a ZWJ family, or a base plus a variation selector such as the red
 *  heart U+2764 U+FE0F the picker itself offers - and clamping at a boundary
 *  inside one drops its trailing code points. The heart bisected at the limit
 *  keeps U+2764 and drops U+FE0F, so it is stored as a monochrome text heart
 *  rather than the red emoji. That is acceptable and strictly less lossy than
 *  the old UTF-16 slice (which could emit an unstorable lone surrogate); the
 *  point is only that what remains is always valid, not that it looks the same. */
function clampToCharacters(str) {
  const points = Array.from(str);
  return points.length <= MAX_CHAT_CHARS ? str : points.slice(0, MAX_CHAT_CHARS).join('');
}

module.exports = {
  MAX_CHAT_CHARS,
  clampToCharacters,
};
