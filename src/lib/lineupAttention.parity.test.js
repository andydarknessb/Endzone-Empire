import { DEFAULT_ROSTER_SLOTS } from '../../server/services/rosterSlots';

// lineupAttention.js used to carry a CLIENT copy of the standard starter order
// (DEFAULT_STARTER_SLOT_ORDER), a fallback for a league with no explicit
// `roster_slots` yet, pinned here against the server's DEFAULT_ROSTER_SLOTS.
// #1210 deleted that client-side default (ADR 0029's sibling concern: a
// default guesses at a fantasy-standard shape that mis-places IDP starters,
// same as the pairing default #1207/#1210 removed), so there is no longer a
// client mirror for this file to pin - the shape-guard test below is what
// remains, standing alone as a sanity check on the server constant.
//
// The server constant is read from server/services/rosterSlots.js, a pure leaf
// with no load-time require: lineup.service.js loads the pg pool at module
// scope (`../modules/pool` -> `require('pg')`), so importing the service here
// would drag pg into jsdom. lineup.service re-exports this same reference, so
// the constant this test reads is byte-for-byte the one every server consumer
// resolves.
describe('DEFAULT_ROSTER_SLOTS (server)', () => {
  it('is a non-empty array of slot objects with string keys (guards a shape change)', () => {
    // If the server export ever became a plain object, a Set, or an array of
    // strings, a consumer keying off `.key` would fail in a confusing way;
    // assert the shape explicitly instead.
    expect(Array.isArray(DEFAULT_ROSTER_SLOTS)).toBe(true);
    expect(DEFAULT_ROSTER_SLOTS.length).toBeGreaterThan(0);
    DEFAULT_ROSTER_SLOTS.forEach((slot) => {
      expect(typeof slot).toBe('object');
      expect(slot).not.toBeNull();
      expect(typeof slot.key).toBe('string');
    });
  });
});
