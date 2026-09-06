/**
 * The app-wide draft refusal (ADR 0008): a stable HTTP statusCode plus a
 * human message, and an optional stable SCREAMING_SNAKE code a client
 * branches on. Lives in its own leaf module (the pattern server/modules/io.js
 * uses for the same reason) so both draft.service.js and rosterGate.service.js
 * can require it without requiring each other - draft.service.js requires
 * rosterGate.service.js (to re-export assertRosterAcquisitionAllowed and to
 * call assertPositionCapNotReached from undoDrop), so the reverse import
 * would be circular, and draft.service.js assigns module.exports as one
 * object literal at the end of the file rather than incrementally, which
 * would hand a circular importer the pre-export empty object (#943).
 */
class DraftError extends Error {
  constructor(statusCode, message, code = null) {
    super(message);
    this.statusCode = statusCode;
    // A stable SCREAMING_SNAKE code (ADR 0008) a client branches on, distinct
    // from the human message. Optional so existing throws keep their behaviour.
    this.code = code;
  }
}

module.exports = { DraftError };
