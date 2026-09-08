// Reads one HTTP failure response into a plain { message, code, status }.
//
// This is the transport-layer seam introduced by the expand step of #957
// (parent #942): a single place that understands the shapes the server uses
// to report a failure, so call sites stop reaching into `err.response.data`
// by hand and disagreeing about which key holds what. It has no dependencies:
// it imports neither the HTTP client, React, nor the notification layer, so it
// runs in every suite regardless of what that suite mocks. That is deliberate
// and is why the seam is here and not in apiClient's response interceptor: 64
// client test files (`git grep -lE "jest\.mock\(['\"][^'\"]*api/apiClient"` over
// src/**/*.test.{js,jsx}, re-counted rather than copied from the ticket) replace
// apiClient wholesale, so an interceptor there would execute in almost none of
// them and its behaviour could not be pinned by a test.
//
// The four design rules from #957, and how this reader meets each:
//
//   1. Discriminate on KEY PRESENCE, never on the shape of a string. There is
//      no regular expression here. A code may be a Postgres SQLSTATE ('23505')
//      or a Node network code ('ECONNREFUSED') as readily as an uppercase word,
//      so no pattern over the text could tell a code from a sentence; which KEY
//      a value arrived under is the only reliable signal.
//
//   2. Tolerate the envelopes the server actually emits. Enumerated by grepping
//      origin/integration for `.json({ error`, `.json({ code`, `error: error.code`
//      and `code: error.code`; that search surfaces four distinct shapes:
//        a. { error: <sentence> }
//             the common case (server/modules/auth.js, most of
//             server/routes/auth.router.js, server/routes/draft.router.js, ...).
//        b. { error: <code>, message: <sentence> }
//             the commissioner routes' handle() code branch
//             (server/routes/commissioner.router.js).
//        c. { code: <code>, message: <sentence>, requestId }  (no `error` key)
//             the global express error handler and the /api 404 handler in
//             server/server.js, the rate limiter (server/modules/rateLimit.js),
//             and the same shape appears from auth, refresh-cookie and the user
//             routes.
//        d. { error: <sentence>, code: <code> }  (no `message` key)
//             draft.router.js and league.router.js on a refusal that carries a
//             code alongside the human message.
//      The three branches below cover all four by key presence alone. This list
//      is the shapes that search returned on 2026-09-06; it is not a claim that
//      the server can never grow a fifth, and a call site must still treat an
//      absent field as absent rather than as proof of a shape.
//
//   3. Be total and supply no default copy. It never throws and always returns
//      for any input: a bare Error, a cancelled request, an HTML error page from
//      the edge, null, undefined. When the body carries no usable sentence, the
//      returned `message` is undefined, NOT a fabricated fallback: a sentence
//      shown to a manager lives under the copy rules that govern every other
//      sentence in the product, and the transport layer sits outside them, so
//      each call site writes its own fallback.
//
//   4. Take only strings from the body. Two routers spread extra objects into
//      the same envelope, so a field may hold an object or array; those are
//      treated as absent so an object placeholder can never reach a notification.
//
// Scope note for the call sites that will migrate onto this (the contract the
// next tickets read): this reads the HTTP *response* envelope only. A failure
// with no response (a cancel, a DNS or connection error) yields message and code
// undefined and status undefined; it does not surface axios's own `err.code`.
// Shrinking the tolerance (#973, ADR 0032). Shape (b) is now emitted by NO
// server route: the thirteen emitters that carried the code in the
// message-carrying field were converged onto (c). Shapes (b) and (d) are kept
// here for hand-written fixtures and for a browser holding a response emitted
// before that deploy. scripts/envelopeConformance.js counts the remaining
// non-conforming emitters on a shrink-only allowlist, and ADR 0032 states the
// three conditions under which the (b)/(d) arms below are deleted: the guard
// at zero with an empty allowlist, no fixture hand-writing a retired envelope
// except the ones kept to pin this tolerance, and one release shipped at zero.
export function readHttpFailure(err) {
  const response = err && typeof err === 'object' ? err.response : undefined;
  const status =
    response && typeof response.status === 'number' ? response.status : undefined;

  const body =
    response && response.data && typeof response.data === 'object'
      ? response.data
      : undefined;

  if (!body) {
    return { message: undefined, code: undefined, status };
  }

  // Rule 4: a field counts as present only when it is a string.
  const errorField = typeof body.error === 'string' ? body.error : undefined;
  const codeField = typeof body.code === 'string' ? body.code : undefined;
  const messageField = typeof body.message === 'string' ? body.message : undefined;

  let code;
  let message;

  if (codeField !== undefined) {
    // Shapes (c) and (d): a dedicated `code` key carries the machine code. The
    // human sentence rides in `message` when present, otherwise in `error`.
    code = codeField;
    message = messageField !== undefined ? messageField : errorField;
  } else if (errorField !== undefined && messageField !== undefined) {
    // Shape (b): with no `code` key, a `message` sibling means the `error` field
    // is holding the code, not the sentence.
    code = errorField;
    message = messageField;
  } else {
    // Shape (a): the `error` field (or a lone `message`) is the sentence, and
    // there is no code.
    code = undefined;
    message = errorField !== undefined ? errorField : messageField;
  }

  return { message, code, status };
}
