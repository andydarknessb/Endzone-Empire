/**
 * The League chat length limit, kept as a pure module (#486).
 *
 * This lived inside draftSocket.js when #443 introduced it (alongside a clamp
 * that has since been removed, #502), but that module pulls in socket.io, the
 * pg pool and the redis adapter, so it cannot be required from a jsdom client
 * test. #486 mirrors this limit in the composer's character counter and pins
 * the client constant equal to the server's, and that parity test needs to
 * import the value without loading the whole socket stack. Lifting the
 * constant here - pure, no requires - keeps a single server-side definition
 * that draftSocket re-exports unchanged, so `server/test/chatSend.test.js`
 * still requires it from draftSocket and stays green.
 */

/** The chat message length limit, counted in Unicode CODE POINTS. A "character"
 *  here is one code point, not one UTF-16 code unit (#443): an astral emoji like
 *  👍 is a single character even though it is two code units, and a ZWJ sequence
 *  is several. The chat_messages.message column is varchar(500), which Postgres
 *  also counts in characters, so this limit and the column agree exactly.
 *
 *  #502: an over-limit send is REFUSED (code MESSAGE_TOO_LONG in draftSocket.js),
 *  never shortened. Earlier this file also held a truncating clamp function
 *  that cut a message down to this boundary (#443, corrected #488); it had no
 *  caller left once the handler stopped shortening accepted messages, and was
 *  removed along with it. */
const MAX_CHAT_CHARS = 500;

module.exports = {
  MAX_CHAT_CHARS,
};
