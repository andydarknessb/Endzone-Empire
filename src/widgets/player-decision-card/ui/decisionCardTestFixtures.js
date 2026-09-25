import apiClient from '../../../api/apiClient';

/**
 * Shared fixtures for the Decision card's kind-split test files (#1515, T19;
 * formal review n1). `availabilityEntry` is #1307's non-lineup player row -
 * the shape WaiverWire and PlayerManagement map their own rows into, with no
 * slot/locked/spent/eligibleSlots since neither surface has a lineup to read
 * those from. `mockCardRoute` stubs the one card route
 * (`/api/players/:id/card`, #1306/#1331; it carries `line`, `weather`,
 * `opponents` and `decision.usage` too since #1667) and rejects any other
 * URL, so a resurrected second read fails loudly.
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
    return Promise.reject(new Error(`unexpected request: ${url}`));
  });
}
