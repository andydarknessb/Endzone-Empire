import { LIFECYCLE_KINDS as CLIENT_LIFECYCLE_KINDS } from './stallAnnouncement';
import { LIFECYCLE_KINDS as SERVER_LIFECYCLE_KINDS } from '../../../server/services/draftActivity';

// The stall announcer derives its exit set (STALL_EXIT_KINDS) by exclusion from a
// CLIENT copy of the Draft lifecycle roster (stallAnnouncement.js LIFECYCLE_KINDS),
// because react-scripts's webpack build confines runtime imports to src/
// (ModuleScopePlugin) and cannot pull server/services/draftActivity.js into the
// bundle. The risk is silent staleness: if a lifecycle kind is added on the server
// and the client copy is not updated, the new kind never reaches the announcer and
// a stall it should clear (or announce) is missed - the same shape of bug #648
// spent two rounds on, one file away. jest has no ModuleScopePlugin, so this pins
// the two rosters equal and fails the moment either changes alone.
//
// The house pattern for exactly this: chatLimits.parity.test.js (MAX_CHAT_CHARS)
// and useLeagueChat.humanType.parity.test.js (LEAGUE_CHAT). The server module is
// safe to import here - draftActivity.js's only load-time require is the pure
// server/services/teamIdentity (no pg, no socket.io).
describe('stallAnnouncement LIFECYCLE_KINDS parity with the server roster', () => {
  it('mirrors server/services/draftActivity.js LIFECYCLE_KINDS value for value', () => {
    // Order is not semantically meaningful for a kind roster, so compare as sets:
    // a reorder on either side is not a drift, an added/removed/renamed kind is.
    expect([...CLIENT_LIFECYCLE_KINDS].sort()).toEqual([...SERVER_LIFECYCLE_KINDS].sort());
  });

  it('the server roster is a non-empty list of string kinds (guards a shape change too)', () => {
    // If the server export ever became a Set or object, the set-compare above could
    // pass vacuously or throw; assert the shape this parity relies on.
    expect(Array.isArray(SERVER_LIFECYCLE_KINDS)).toBe(true);
    expect(SERVER_LIFECYCLE_KINDS.length).toBeGreaterThan(0);
    SERVER_LIFECYCLE_KINDS.forEach((kind) => expect(typeof kind).toBe('string'));
  });
});
