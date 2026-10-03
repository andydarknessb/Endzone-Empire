// Fixture harness for the Lineup Ledger's layout guard (#1957, spec #1956 L10).
// The Lineup page (`/#/team?leagueId=<id>`) is opened with every `/api/**`
// read answered through `page.route`, the way player-decision-card.spec.ts and
// auth-offline.spec.ts do, and anything unrecognised 500s `unexpected mocked
// request` so a new read cannot slip in unnoticed.
//
// The lineup is shaped for the layout, not for scoring: nine starter slots
// with one empty FLEX, five Bench players, one IR player, a Questionable
// starter, an Out starter and a starter whose name is long enough to need its
// ellipsis. Entry fields are the wire's own (snake_case, as
// `layoutGuardFixtures.ts`'s `lineupForViewer` and the server's `getLineup`
// send them); `unavailable` is the server's Unavailable reason code.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

export const LEAGUE_ID = 7;
const TEAM_ID = 70;
const USER_ID = 41;
const WEEK = 4;

export const LINEUP_URL = `/#/team?leagueId=${LEAGUE_ID}`;
export const LONG_NAME = 'Christian McCaffrey-Longname';

type Entry = {
  id: number;
  name: string;
  position: string;
  nfl_team: string;
  slot: string;
  projected_points: number;
  injury_status?: string;
  unavailable?: string;
};

const ROSTER_SLOTS = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', count: 2, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

// 8 starters (the second FLEX is left empty), 5 Bench, 1 IR.
const ENTRIES: Entry[] = [
  { id: 101, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', slot: 'QB', projected_points: 24.2, injury_status: 'Q' },
  { id: 102, name: LONG_NAME, position: 'RB', nfl_team: 'SF', slot: 'RB', projected_points: 19.6 },
  { id: 103, name: 'Breece Hall', position: 'RB', nfl_team: 'NYJ', slot: 'RB', projected_points: 14.2 },
  { id: 104, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', slot: 'WR', projected_points: 17.1 },
  { id: 105, name: 'CeeDee Lamb', position: 'WR', nfl_team: 'DAL', slot: 'WR', projected_points: 0, injury_status: 'O', unavailable: 'out' },
  { id: 106, name: 'Sam LaPorta', position: 'TE', nfl_team: 'DET', slot: 'TE', projected_points: 9.8 },
  { id: 107, name: 'Tyreek Hill', position: 'WR', nfl_team: 'MIA', slot: 'FLEX', projected_points: 13.4 },
  { id: 108, name: 'Denver Broncos', position: 'DEF', nfl_team: 'DEN', slot: 'DEF', projected_points: 7.5 },
  { id: 201, name: 'Rachaad White', position: 'RB', nfl_team: 'TB', slot: 'BENCH', projected_points: 11.3 },
  { id: 202, name: 'Jaylen Waddle', position: 'WR', nfl_team: 'MIA', slot: 'BENCH', projected_points: 10.9 },
  { id: 203, name: 'Dalton Kincaid', position: 'TE', nfl_team: 'BUF', slot: 'BENCH', projected_points: 8.2 },
  { id: 204, name: 'Kyren Williams', position: 'RB', nfl_team: 'LAR', slot: 'BENCH', projected_points: 12.7 },
  { id: 205, name: 'Brock Purdy', position: 'QB', nfl_team: 'SF', slot: 'BENCH', projected_points: 18.4 },
  { id: 301, name: 'Christian Watson', position: 'WR', nfl_team: 'GB', slot: 'IR', projected_points: 0, injury_status: 'IR', unavailable: 'ir' },
];

/** The first Bench RB the swap logic treats as an eligible target for a starting RB. */
export const BENCH_RB_ID = 204;
export const STARTER_RB_TEST_ID = 'slot-row-RB-0';

function lineup() {
  return {
    leagueId: LEAGUE_ID,
    teamId: TEAM_ID,
    season: 2026,
    week: WEEK,
    currentWeek: WEEK,
    rosterSlots: ROSTER_SLOTS,
    benchSlots: 5,
    irSlots: 1,
    entries: ENTRIES.map((e) => ({
      id: e.id,
      name: e.name,
      position: e.position,
      nfl_team: e.nfl_team,
      injury_status: e.injury_status ?? null,
      slot: e.slot,
      ir_attested: false,
      projected_points: e.projected_points,
      bye_week: null,
      locked: false,
      onBye: false,
      valid_stash: e.slot === 'IR',
      opponent: 'KC',
      unavailable: e.unavailable ?? null,
    })),
  };
}

async function fulfilApi(route: Route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();
  if (method !== 'GET') return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });

  if (pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'ledger-layout-viewer' });
  if (pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
  if (pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
  if (pathname === '/api/league') {
    return json(route, 200, [{
      id: LEAGUE_ID,
      name: 'Ledger Layout League',
      best_ball: false,
      draft_status: 'complete',
      my_team_id: TEAM_ID,
      my_team_name: 'Layout Team',
    }]);
  }
  if (pathname === `/api/league/${LEAGUE_ID}`) {
    return json(route, 200, { league: { id: LEAGUE_ID, name: 'Ledger Layout League', best_ball: false }, teams: [], viewerTeamId: TEAM_ID });
  }
  if (pathname === `/api/league/${LEAGUE_ID}/matchups`) return json(route, 200, []);
  if (pathname === `/api/scoring/league/${LEAGUE_ID}/standings`) return json(route, 200, { standings: [] });
  if (pathname === '/api/team/roster') {
    return json(route, 200, ENTRIES.map((e) => ({
      id: e.id, name: e.name, position: e.position, nfl_team: e.nfl_team, lineup_slot: e.slot,
    })));
  }
  if (pathname === '/api/team/lineup') return json(route, 200, lineup());
  if (pathname === '/api/team/lineup/advice') return json(route, 200, { projectedTotal: 0, optimalTotal: 0, suggestions: [] });
  if (pathname === '/api/team/hindsight') return json(route, 200, { totalPointsLeftOnBench: 0 });

  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

/** Seeds a session, stubs the score-feed socket and routes every `/api/**` read. */
export async function setupLineupLedgerLayout(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('endzone_token', 'ledger-layout-access');
    localStorage.setItem('endzone_refresh', 'ledger-layout-refresh');
    (window as unknown as { __ENDZONE_TEST_SOCKET_FACTORY__: unknown }).__ENDZONE_TEST_SOCKET_FACTORY__ = () => ({
      emit() {},
      on() {},
      disconnect() {},
      io: { on() {}, off() {} },
    });
  });
  await page.route('**/api/**', fulfilApi);
}
