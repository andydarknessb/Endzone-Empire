const test = require('node:test');
const assert = require('node:assert/strict');
const {
  checkChatSend,
  ONE_MINUTE,
  TEXT_PER_10S,
  TEXT_PER_60S,
  GIF_PER_10S,
  GIF_LEAGUE_PER_10S,
} = require('../modules/chatFlood');

// The engine is pure: a caller-owned store (a Map), a "now" in ms, and the
// send's league/user/kind. It records a hit only when the send is allowed, so
// a blocked send never consumes capacity it was denied.

test('text: allows up to the ten-second ceiling, then blocks with an explicit retry time', () => {
  const store = new Map();
  const now = 1_000_000;
  for (let i = 0; i < TEXT_PER_10S; i++) {
    const r = checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + i });
    assert.equal(r.allowed, true, `send ${i} under the limit is allowed`);
    assert.equal(r.retryAfterMs, 0);
  }
  const blocked = checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + TEXT_PER_10S });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0, 'a blocked send names when to retry');
  assert.ok(blocked.retryAfterMs <= 10_000);
  assert.equal(blocked.retryAfterSeconds, Math.ceil(blocked.retryAfterMs / 1000));
});

test('text: a blocked send consumes nothing — capacity returns as the window slides', () => {
  const store = new Map();
  const now = 2_000_000;
  for (let i = 0; i < TEXT_PER_10S; i++) {
    assert.equal(checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + i }).allowed, true);
  }
  // Two blocked attempts inside the window.
  assert.equal(checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + 5 }).allowed, false);
  assert.equal(checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + 6 }).allowed, false);
  // The oldest hit ages out; exactly one slot frees, and the blocked attempts
  // did not eat it.
  const after = checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + 10_001 });
  assert.equal(after.allowed, true);
});

test('text: no more than thirty sends are admitted in any rolling minute', () => {
  // 5/10s and 30/60s are nested (six disjoint 10s windows hold at most 30), so
  // the minute ceiling is a belt-and-braces guard the 10s ceiling already
  // guarantees rather than a limit that blocks a distinct pattern. What is
  // worth pinning is the invariant both express together: hammering sends can
  // never get more than thirty into a single minute.
  const store = new Map();
  const start = 3_000_000;
  let admitted = 0;
  // One attempt every 250ms for 60s - far faster than the ceilings allow.
  for (let now = start; now < start + ONE_MINUTE; now += 250) {
    if (checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now }).allowed) admitted++;
  }
  assert.ok(admitted <= TEXT_PER_60S, `admitted ${admitted} in a minute, ceiling is ${TEXT_PER_60S}`);
});

test('text: limits are per member and per league — one sender does not spend another', () => {
  const store = new Map();
  const now = 4_000_000;
  for (let i = 0; i < TEXT_PER_10S; i++) {
    assert.equal(checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + i }).allowed, true);
  }
  assert.equal(checkChatSend(store, { leagueId: 1, userId: 7, kind: 'text', now: now + 5 }).allowed, false);
  // A different member in the same league is unaffected.
  assert.equal(checkChatSend(store, { leagueId: 1, userId: 8, kind: 'text', now: now + 5 }).allowed, true);
  // The same member in a different league is unaffected.
  assert.equal(checkChatSend(store, { leagueId: 2, userId: 7, kind: 'text', now: now + 5 }).allowed, true);
});

test('gif: one per ten seconds per member', () => {
  const store = new Map();
  const now = 5_000_000;
  assert.equal(GIF_PER_10S, 1);
  const first = checkChatSend(store, { leagueId: 1, userId: 7, kind: 'gif', now });
  assert.equal(first.allowed, true);
  const second = checkChatSend(store, { leagueId: 1, userId: 7, kind: 'gif', now: now + 1 });
  assert.equal(second.allowed, false);
  assert.ok(second.retryAfterMs > 0);
  const later = checkChatSend(store, { leagueId: 1, userId: 7, kind: 'gif', now: now + 10_001 });
  assert.equal(later.allowed, true);
});

test('gif: a league-wide burst ceiling caps coordinated senders even under the per-member limit', () => {
  const store = new Map();
  const now = 6_000_000;
  // Distinct members each sending a single gif — each passes the per-member
  // 1/10s limit, so only the league-wide ceiling can stop the flood.
  let allowed = 0;
  for (let userId = 100; userId < 100 + GIF_LEAGUE_PER_10S + 3; userId++) {
    const r = checkChatSend(store, { leagueId: 1, userId, kind: 'gif', now });
    if (r.allowed) allowed++;
  }
  assert.equal(allowed, GIF_LEAGUE_PER_10S, 'the league-wide ceiling caps the coordinated burst');
  // A different league has its own ceiling.
  assert.equal(checkChatSend(store, { leagueId: 2, userId: 100, kind: 'gif', now }).allowed, true);
});

test('an unknown kind is a programming error, not a silent allow', () => {
  const store = new Map();
  assert.throws(() => checkChatSend(store, { leagueId: 1, userId: 7, kind: 'sticker', now: 1 }), /kind/);
});
