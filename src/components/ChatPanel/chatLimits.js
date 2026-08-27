/**
 * The composer's view of the League chat length limit (#486).
 *
 * The visible counter and its screen-reader announcer count the SAME units the
 * server clamp and the chat_messages.message varchar(500) column count: Unicode
 * code points. The number a manager sees is the number the server enforces, so
 * the counter uses `Array.from(text).length` (code points) deliberately - not
 * `text.length` (UTF-16 code units, which double-counts an astral emoji) and
 * not Intl.Segmenter (grapheme clusters, which would undercount a ZWJ family
 * the server counts as several).
 *
 * The client cannot import the server socket module at runtime, so MAX_CHAT_CHARS
 * is declared here and pinned equal to the server's constant by
 * chatLimits.parity.test.js. Change one value without the other and that test
 * fails.
 */

/** The server-enforced chat length limit, in Unicode code points. Pinned equal
 *  to the server's MAX_CHAT_CHARS (server/modules/chatLimits) by the parity test. */
export const MAX_CHAT_CHARS = 500;

/** How many remaining code points first turns the counter into a warning and
 *  arms the polite threshold announcement (#486). At or below this, the visible
 *  indicator warns and the status region announces once that the limit is near. */
export const CHAT_CHARS_WARNING = 50;

/** The composer text's length in Unicode code points - the unit the server
 *  clamp and the varchar column both count. Array.from walks the string by its
 *  iterator, one step per code point, so an astral emoji counts as 1 and a ZWJ
 *  sequence counts as each of its joined code points. Nullish text counts as 0. */
export function characterCount(text) {
  return Array.from(text == null ? '' : text).length;
}
