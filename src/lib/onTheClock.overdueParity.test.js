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
// The regex is anchored to the `const OVERDUE_AFTER_MS =` DECLARATION, not a
// bare identifier match: the identifier also appears in a docblock four lines
// above the declaration, in a `<=` comparison, and in module.exports. A
// non-anchored, forward-scanning match (e.g. /OVERDUE_AFTER_MS[\s\S]*?(\d+)/)
// would have latched onto the first number after the docblock mention and
// silently compared the wrong figure (the exact defect caught on PR #755). The
// server literal is written `30_000`, so digits AND underscores are captured
// and the separators stripped before Number().
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
