const fs = require('fs');
const path = require('path');
const { OVERDUE_AFTER_MS } = require('./onTheClock');

// Overdue tolerance parity (#769, stallAnnouncement.parity.test.js idiom).
//
// The Overdue tolerance has ONE spelling on the server (OVERDUE_AFTER_MS in
// server/services/pickClock.service.js, #768) and the client keeps a copy in
// src/lib/onTheClock.js because react-scripts's webpack build cannot pull a
// server module into the client bundle, and pickClock.service.js is not even
// import-safe under jest (its load-time requires reach pg and socket.io). So
// this pins the two numbers by reading the server SOURCE as text, the same
// move the house parity tests make when the server value cannot be imported.
//
// Two things make the extraction load-bearing, not cosmetic:
//
// 1. The underscore. The server literal is written `30_000`. A naive `(\d+)`
//    captures `30`, not `30000`, because `_` is not a digit - a SILENT wrong
//    comparison that would pass against a client value of 30. So the capture is
//    `[\d_]+` and the separators are stripped before Number(). This is the real
//    hazard this file defends against.
// 2. The anchor. `OVERDUE_AFTER_MS` appears four times in the server file - the
//    declaration and three uses below it (a `<=` comparison and module.exports)
//    - so the regex anchors to the `const OVERDUE_AFTER_MS =` DECLARATION rather
//    than a bare identifier match that could latch onto a use. (The declaration
//    is the first hit here, so a forward scan would not currently mismatch; the
//    anchor is defence against a future edit that adds a use above it, the
//    general shape of the PR #755 defect, not a live bug in this file.)
//
// If the declaration is ever moved or renamed the match returns null and the
// test throws, rather than comparing the client value against undefined.
const SERVER_SOURCE = path.join(__dirname, '..', '..', 'server', 'services', 'pickClock.service.js');

describe('OVERDUE_AFTER_MS parity with server/services/pickClock.service.js', () => {
  it('the client copy equals the server declaration', () => {
    const source = fs.readFileSync(SERVER_SOURCE, 'utf8');
    const match = source.match(/const\s+OVERDUE_AFTER_MS\s*=\s*([\d_]+)/);
    // Fail loudly if the declaration moved or was renamed, rather than comparing
    // the client value against undefined and passing by accident.
    if (!match) {
      throw new Error(
        `Could not find "const OVERDUE_AFTER_MS = <number>" in ${SERVER_SOURCE}. ` +
          'The server constant moved or was renamed; update this parity test to match.'
      );
    }
    const serverValue = Number(match[1].replace(/_/g, ''));
    expect(serverValue).toBe(OVERDUE_AFTER_MS);
  });
});
