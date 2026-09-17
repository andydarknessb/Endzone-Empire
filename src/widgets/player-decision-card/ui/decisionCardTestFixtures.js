import apiClient from '../../../api/apiClient';

/**
 * Shared fixtures for the Decision card's kind-split test files (#1515, T19;
 * formal review n1). `availabilityEntry` is #1307's non-lineup player row -
 * the shape WaiverWire and PlayerManagement map their own rows into, with no
 * slot/locked/spent/eligibleSlots since neither surface has a lineup to read
 * those from. `mockCardRoute` routes `apiClient.get` by URL so a suite can
 * stub the lineup-context endpoint (`line`/`weather`/`usage`) and the card
 * route (`/api/players/:id/card`, #1306/#1331) with different bodies.
 *
 * Each caller still does its own `jest.mock('.../api/apiClient', ...)` (a
 * manual mock factory has to live in the test file jest.mock hoists it in) -
 * this module only reads the SAME mocked instance back out, so it works
 * identically from every kind's test file.
 */
export const availabilityEntry = (over = {}) => ({
  playerId: 7,
  name: 'Breece Hall',
  position: 'RB',
  nflTeam: 'NYJ',
  slot: 'RB',
  injuryStatus: null,
  opponent: 'KC',
  kickoff: '2026-09-14T17:00:00Z',
  ...over,
});

export function mockCardRoute(card) {
  apiClient.get.mockImplementation((url) => {
    if (url.includes('/card?')) return Promise.resolve({ data: card || {} });
    return Promise.resolve({ data: { line: null, weather: null, usage: null } });
  });
}
