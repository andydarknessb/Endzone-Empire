import { DEFAULT_STARTER_SLOT_ORDER } from './lineupAttention';
import { DEFAULT_ROSTER_SLOTS } from '../../server/services/rosterSlots';

// lineupAttention.js carries a CLIENT copy of the standard starter order
// (DEFAULT_STARTER_SLOT_ORDER), used as the fallback when a league has no
// explicit `roster_slots` yet. Its authority is the server's
// DEFAULT_ROSTER_SLOTS. react-scripts's webpack build confines runtime imports
// to src/ (ModuleScopePlugin), so the client cannot import the server constant
// at runtime and must keep a mirror; the risk is silent staleness. jest has no
// ModuleScopePlugin, so this pins the two equal and fails the moment either
// changes alone.
//
// The server constant is read from server/services/rosterSlots.js, a pure leaf
// with no load-time require: lineup.service.js loads the pg pool at module
// scope (`../modules/pool` -> `require('pg')`), so importing the service here
// would drag pg into jsdom. lineup.service re-exports this same reference, so
// the constant this test pins is byte-for-byte the one every server consumer
// resolves.
//
// The house pattern for exactly this: stallAnnouncement.parity.test.js
// (LIFECYCLE_KINDS), chatLimits.parity.test.js (MAX_CHAT_CHARS),
// useLeagueChat.humanType.parity.test.js (LEAGUE_CHAT).
describe('lineupAttention DEFAULT_STARTER_SLOT_ORDER parity with the server roster', () => {
  it('mirrors server DEFAULT_ROSTER_SLOTS keys in order', () => {
    // Compare as an ORDERED list, not as sorted sets. The precedent parity
    // tests sort before comparing because their rosters are order-free (a set
    // of kinds); this one must NOT. lineupAttention uses the constant to pick
    // AND order the starting slots (starterSlotOrder drives the empty-slot and
    // bye passes in the fallback path), so a reorder on either side is real
    // drift, not a harmless permutation. `toEqual` on arrays is order-sensitive.
    expect(DEFAULT_STARTER_SLOT_ORDER).toEqual(DEFAULT_ROSTER_SLOTS.map((s) => s.key));
  });

  it('the server roster is a non-empty array of slot objects with string keys (guards a shape change too)', () => {
    // If the server export ever became a plain object, a Set, or an array of
    // strings, the ordered compare above could throw or pass vacuously; assert
    // the shape the parity relies on explicitly.
    expect(Array.isArray(DEFAULT_ROSTER_SLOTS)).toBe(true);
    expect(DEFAULT_ROSTER_SLOTS.length).toBeGreaterThan(0);
    DEFAULT_ROSTER_SLOTS.forEach((slot) => {
      expect(typeof slot).toBe('object');
      expect(slot).not.toBeNull();
      expect(typeof slot.key).toBe('string');
    });
  });
});
