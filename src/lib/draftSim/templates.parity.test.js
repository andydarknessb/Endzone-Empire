import { DEFAULT_ROSTER_SLOTS as CLIENT_DEFAULT_ROSTER_SLOTS } from './templates';
import { DEFAULT_ROSTER_SLOTS as SERVER_DEFAULT_ROSTER_SLOTS } from '../../../server/services/rosterSlots';

// templates.js carries a CLIENT copy of DEFAULT_ROSTER_SLOTS (used to derive
// STANDARD_LINEUP and to seed slot iteration for the Draft Simulator). Its
// authority is the server's DEFAULT_ROSTER_SLOTS. react-scripts's webpack
// build confines runtime imports to src/ (ModuleScopePlugin), so the client
// cannot import the server constant at runtime and must keep a mirror; the
// risk is silent staleness. jest has no ModuleScopePlugin, so this pins the
// two equal and fails the moment either changes alone.
//
// The server constant is read from server/services/rosterSlots.js, a pure
// leaf with no load-time require: lineup.service.js loads the pg pool at
// module scope (`../modules/pool` -> `require('pg')`), so importing the
// service here would drag pg into jsdom. lineup.service re-exports this same
// reference, so the constant this test pins is byte-for-byte the one every
// server consumer resolves.
//
// This comparison is WHOLE-OBJECT (toEqual on the full arrays), unlike
// lineupAttention.parity.test.js's keys-only compare. That test's client
// mirror (DEFAULT_STARTER_SLOT_ORDER) only carries slot keys, so keys-only is
// all there is to pin. This copy carries `count` and `eligiblePositions` on
// every slot too, and a drift in either is real: a wrong `count` changes how
// many starters a slot holds, and a wrong `eligiblePositions` changes which
// positions can fill it. Only comparing keys would let both drift silently.
//
// Compared as an ORDERED list, not a sorted set: the simulator derives
// STANDARD_LINEUP directly from this array and iterates slots in this order,
// so a reorder on either side is real drift, not a harmless permutation.
// `toEqual` on arrays is order-sensitive.
//
// The house pattern for exactly this: stallAnnouncement.parity.test.js
// (LIFECYCLE_KINDS), chatLimits.parity.test.js (MAX_CHAT_CHARS),
// useLeagueChat.humanType.parity.test.js (LEAGUE_CHAT), lineupAttention's own
// parity test (DEFAULT_STARTER_SLOT_ORDER, keys-only).
describe('draftSim templates DEFAULT_ROSTER_SLOTS parity with the server roster', () => {
  it('mirrors server DEFAULT_ROSTER_SLOTS as a whole object, in order', () => {
    expect(CLIENT_DEFAULT_ROSTER_SLOTS).toEqual(SERVER_DEFAULT_ROSTER_SLOTS);
  });

  it('the server roster is a non-empty array of slot objects with the fields this copy relies on', () => {
    // If the server export ever became a plain object, a Set, or lost a
    // field, the whole-object compare above could throw or pass vacuously;
    // assert the shape the parity relies on explicitly.
    expect(Array.isArray(SERVER_DEFAULT_ROSTER_SLOTS)).toBe(true);
    expect(SERVER_DEFAULT_ROSTER_SLOTS.length).toBeGreaterThan(0);
    SERVER_DEFAULT_ROSTER_SLOTS.forEach((slot) => {
      expect(typeof slot).toBe('object');
      expect(slot).not.toBeNull();
      expect(typeof slot.key).toBe('string');
      expect(typeof slot.label).toBe('string');
      expect(typeof slot.count).toBe('number');
      expect(Array.isArray(slot.eligiblePositions)).toBe(true);
    });
  });
});
