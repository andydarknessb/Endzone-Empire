// Fixture harness for the Players list's 390px layout guard (#1310, ADR 0040's
// acceptance criterion 3: "The 390 px stacked row measured in Chromium: no
// horizontal scroll, Claim 44 px"). Modeled on decisionCardFixtures.ts's
// catch-all-route shape: one handler answers every endpoint PlayerManagement
// reads and 500s `unexpected mocked request` on anything else.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

const USER_ID = 61;
const LEAGUE_ID = 4400;
export const PLAYERS_URL = '/#/player';

const FREE_AGENT_ID = 9101;
const WAIVERS_ID = 9102;
const ROSTERED_ID = 9103;
const MY_TEAM_ID = 9104;
export const CLAIM_PLAYER_NAME = 'Romeo Doubs';

function leagueRow() {
  return {
    id: LEAGUE_ID,
    name: 'Layout Guard League',
    draft_status: 'complete',
    season_status: 'regular',
    waiver_type: 'faab',
    best_ball: false,
    my_team_faab_remaining: 42,
    my_team_waiver_priority: null,
  };
}

function cardsPlayer({ id, name, position, state, teamName = null, points = 11.4 }: {
  id: number; name: string; position: string; state: string; teamName?: string | null; points?: number;
}) {
  const weeks = [];
  for (let week = 2; week <= 18; week += 1) {
    weeks.push(week === 9 ? { week, reason: 'on bye' } : { week, points });
  }
  return {
    id,
    name,
    position,
    nfl_team: 'GB',
    photo_url: null,
    injury_status: null,
    bye_week: 9,
    availability: {
      state,
      teamId: state === 'rostered' ? 55 : (state === 'my_team' ? 500 : null),
      teamName: state === 'rostered' ? teamName : null,
      availableAt: state === 'waivers' ? '2026-09-17T07:00:00.000Z' : null,
    },
    projWeek: { week: 2, points },
    ros: { points: points * 16, perGame: points, posRank: 12, throughWeek: 17 },
    weeks,
    ownership: null,
    upgrade: state === 'my_team' ? null : { points: 3.2, overPlayer: { id: 1, name: 'Bench Guy' }, slot: position },
  };
}

function playersResponse() {
  return {
    players: [
      cardsPlayer({ id: FREE_AGENT_ID, name: 'Jaylen Warren', position: 'RB', state: 'free_agent' }),
      cardsPlayer({ id: WAIVERS_ID, name: CLAIM_PLAYER_NAME, position: 'WR', state: 'waivers' }),
      cardsPlayer({ id: ROSTERED_ID, name: 'Chris Godwin', position: 'WR', state: 'rostered', teamName: 'Rival Squad' }),
      cardsPlayer({ id: MY_TEAM_ID, name: 'Justin Herbert', position: 'QB', state: 'my_team' }),
    ],
    totalPages: 1,
    total: 4,
    context: {
      leagueId: LEAGUE_ID,
      leagueName: 'Layout Guard League',
      rosterCount: 12,
      rosterCapacity: 16,
      waiverType: 'faab',
      faabRemaining: 42,
      waiverPriority: null,
    },
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
  if (method === 'GET' && pathname === '/api/team/roster') return json(route, 200, []);
  if (method === 'GET' && pathname === '/api/players') return json(route, 200, playersResponse());

  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

export async function setupPlayersListLayoutGuard(page: Page) {
  await page.route('**/api/**', fulfilApi);
}
