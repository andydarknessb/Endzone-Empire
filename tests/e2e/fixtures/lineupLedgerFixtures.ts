// Fixture for the Lineup Ledger layout guard (#1957, spec #1956 L10): routes
// the handful of `/api` reads the Team Lineup page (`/#/team`) makes the way
// tests/e2e/auth-offline.spec.ts does (one catch-all over `/api/**`, 500
// `unexpected mocked request` on anything else), and serves a lineup shaped to
// make each Ledger layout rule reachable: nine starting seats with one empty
// FLEX, five bench players, one IR stash, one Questionable and one Out
// starter, and one name long enough to wrap a flex row at 390px.
import type { Page } from '@playwright/test';
import { json } from './jsonRoute';

export const LEAGUE_ID = 7;
export const LINEUP_URL = `/#/team?leagueId=${LEAGUE_ID}`;
export const LONG_NAME = 'Christian McCaffrey-Longname';

const KICKOFF = '2026-10-04T17:00:00Z';

const ROSTER_SLOTS = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

type Seed = {
  id: number;
  name: string;
  position: string;
  slot: string;
  projected: number | null;
  points?: number;
  injury?: string;
  unavailable?: string;
};

// The FLEX seat is left empty on purpose (8 of 9 starters filled).
const SEEDS: Seed[] = [
  { id: 101, name: 'Josh Allen', position: 'QB', slot: 'QB', projected: 24.2, injury: 'Q' },
  { id: 102, name: LONG_NAME, position: 'RB', slot: 'RB', projected: 18.4, points: 112.6 },
  { id: 103, name: 'Bijan Robinson', position: 'RB', slot: 'RB', projected: 15.1 },
  { id: 104, name: 'Justin Jefferson', position: 'WR', slot: 'WR', projected: 16.9, points: 8.2 },
  { id: 105, name: 'Garrett Wilson', position: 'WR', slot: 'WR', projected: null, injury: 'O', unavailable: 'out' },
  { id: 106, name: 'Sam LaPorta', position: 'TE', slot: 'TE', projected: 9.7 },
  { id: 107, name: 'Harrison Butker', position: 'K', slot: 'K', projected: 8.1 },
  { id: 108, name: 'San Francisco 49ers', position: 'DEF', slot: 'DEF', projected: 7.3 },
  { id: 201, name: 'Rachaad White', position: 'RB', slot: 'BENCH', projected: 11.8 },
  { id: 202, name: 'Tank Dell', position: 'WR', slot: 'BENCH', projected: 10.2 },
  { id: 203, name: 'Rashid Shaheed', position: 'WR', slot: 'BENCH', projected: 8.9 },
  { id: 204, name: 'Dalton Kincaid', position: 'TE', slot: 'BENCH', projected: 7.6 },
  { id: 205, name: 'Jordan Love', position: 'QB', slot: 'BENCH', projected: 6.4 },
  { id: 301, name: 'Stashed Runner', position: 'RB', slot: 'IR', projected: null, injury: 'IR', unavailable: 'ir' },
];

const wireEntry = (seed: Seed) => ({
  id: seed.id,
  name: seed.name,
  position: seed.position,
  nfl_team: 'KC',
  slot: seed.slot,
  projected_points: seed.projected,
  actualPoints: seed.points ?? null,
  injury_status: seed.injury ?? null,
  unavailable: seed.unavailable ?? null,
  opponent: seed.unavailable ? null : 'BUF',
  kickoff: seed.unavailable ? null : KICKOFF,
  game_key: seed.unavailable ? null : `g-${seed.id}`,
  locked: false,
  onBye: false,
  valid_stash: seed.slot === 'IR',
});

export const LINEUP_BODY = {
  leagueId: LEAGUE_ID,
  teamId: 70,
  season: 2026,
  week: 5,
  currentWeek: 5,
  rosterSlots: ROSTER_SLOTS,
  benchSlots: 5,
  irSlots: 1,
  entries: SEEDS.map(wireEntry),
};

export async function setupLineupLedgerFixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('endzone_token', 'ledger-access-token');
    localStorage.setItem('endzone_refresh', 'ledger-refresh-token');
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      if (url.pathname === '/api/user') return json(route, 200, { id: 41, username: 'ledger-manager' });
      if (url.pathname === '/api/league') {
        return json(route, 200, [{
          id: LEAGUE_ID,
          name: 'Ledger League',
          best_ball: false,
          draft_status: 'complete',
          my_team_id: 70,
          my_team_name: 'Ledger Team',
        }]);
      }
      if (url.pathname === `/api/league/${LEAGUE_ID}`) {
        return json(route, 200, { league: { id: LEAGUE_ID, name: 'Ledger League', best_ball: false } });
      }
      if (url.pathname === '/api/team/roster') {
        return json(route, 200, SEEDS.map((s) => ({ id: s.id, name: s.name, position: s.position, nfl_team: 'KC', lineup_slot: s.slot })));
      }
      if (url.pathname === `/api/scoring/league/${LEAGUE_ID}/standings`) return json(route, 200, { standings: [] });
      if (url.pathname === '/api/team/lineup') return json(route, 200, LINEUP_BODY);
      if (url.pathname === '/api/team/lineup/advice') {
        return json(route, 200, { projectedTotal: 0, optimalTotal: 0, suggestions: [] });
      }
      if (url.pathname === '/api/team/hindsight') return json(route, 200, { totalPointsLeftOnBench: 0 });
    }
    return json(route, 500, { error: `unexpected mocked request: ${request.method()} ${url.pathname}` });
  });
}
