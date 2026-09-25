// Fixture harness for the Waivers page layout guard (#1613, ADR 0049). The
// same catch-all-route shape as playersListFixtures.ts: one handler answers
// every endpoint the page reads and 500s `unexpected mocked request` on
// anything else.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

const USER_ID = 61;
const LEAGUE_ID = 4400;
export const WAIVERS_URL = `/#/league/${LEAGUE_ID}/waivers`;
export const CLAIMED_PLAYER_NAME = 'Romeo Doubs';

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();

function leagueRow() {
  return {
    id: LEAGUE_ID,
    name: 'Layout Guard League',
    draft_status: 'complete',
    season_status: 'regular',
    waiver_type: 'faab',
    waiver_period_hours: 24,
    best_ball: false,
    my_team_faab_remaining: 62,
    my_team_waiver_priority: 7,
  };
}

function cardsPlayer(id: number, name: string, position: string) {
  const weeks = [];
  for (let week = 4; week <= 18; week += 1) {
    weeks.push(week === 9 ? { week, reason: 'on bye' } : { week, points: 11.4 });
  }
  return {
    id,
    name,
    position,
    nfl_team: 'GB',
    photo_url: null,
    injury_status: null,
    bye_week: 9,
    availability: { state: 'waivers', teamId: null, teamName: null, availableAt: hoursFromNow(30) },
    projWeek: { week: 4, points: 11.4 },
    ros: { points: 150, perGame: 11.4, posRank: 12, throughWeek: 17 },
    weeks,
    ownership: null,
    upgrade: { points: 3.2, overPlayer: { id: 1, name: 'Bench Guy' }, slot: position },
  };
}

function playersResponse() {
  return {
    players: [
      cardsPlayer(9101, 'Jaylen Warren', 'RB'),
      cardsPlayer(9102, CLAIMED_PLAYER_NAME, 'WR'),
      cardsPlayer(9103, 'Chris Godwin', 'WR'),
    ],
    totalPages: 2,
    total: 3523,
    context: {
      leagueId: LEAGUE_ID,
      leagueName: 'Layout Guard League',
      rosterCount: 20,
      rosterCapacity: 20,
      waiverType: 'faab',
      faabRemaining: 62,
      waiverPriority: 7,
    },
  };
}

function waiversResponse() {
  return {
    league: { waiver_type: 'faab', waiver_period_hours: 24, faab_budget: 100, waivers_clear_at: null, current_season: 2026 },
    myTeam: { id: 500, waiver_priority: 7, faab_remaining: 62 },
    onWaivers: [],
    myClaims: [
      {
        id: 1,
        player_id: 9102,
        player_name: CLAIMED_PLAYER_NAME,
        drop_player_id: null,
        drop_player_name: null,
        bid: 24,
        status: 'pending',
        note: null,
        claim_order: 1,
        created_at: '2026-09-20T00:00:00Z',
        processed_at: null,
        clear_at: hoursFromNow(14),
      },
    ],
  };
}

function lineupResponse() {
  const entry = (id: number, name: string, position: string, bye: number) => ({
    id, name, position, slot: position, bye_week: bye, nfl_team: 'GB', projected_points: 10,
  });
  return {
    week: 4,
    currentWeek: 4,
    season: 2026,
    teamId: 500,
    rosterSlots: [],
    entries: [entry(1, 'Starter One', 'QB', 7), entry(2, 'Starter Two', 'RB', 7), entry(3, 'Starter Three', 'WR', 9)],
  };
}

async function fulfilApi(route: Route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (method === 'GET' && pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'e2e-viewer' });
  if (method === 'GET' && pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
  if (method === 'GET' && pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
  if (method === 'GET' && pathname === '/api/league') return json(route, 200, [leagueRow()]);
  if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}`) {
    return json(route, 200, { league: leagueRow(), teams: [], viewerTeamId: 500 });
  }
  if (method === 'GET' && pathname === '/api/team/roster') return json(route, 200, []);
  if (method === 'GET' && pathname === '/api/team/lineup') return json(route, 200, lineupResponse());
  if (method === 'GET' && pathname === '/api/waivers') return json(route, 200, waiversResponse());
  if (method === 'GET' && pathname === '/api/players') return json(route, 200, playersResponse());

  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

export async function setupWaiversLayoutGuard(page: Page) {
  await page.route('**/api/**', fulfilApi);
}
