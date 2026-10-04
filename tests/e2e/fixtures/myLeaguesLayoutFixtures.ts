// Fixture harness for the My Leagues layout guard (#1982, spec #1979 L15).
// Same catch-all-route shape as playersPageLayoutFixtures.ts: one handler
// answers every endpoint the page reads and 500s `unexpected mocked request`
// on anything else. Two leagues, so the list has a first card to measure.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

const USER_ID = 61;
export const MY_LEAGUES_URL = '/#/league';

function leagueRow(id: number, name: string, isOwner: boolean) {
  return {
    id,
    name,
    draft_status: 'complete',
    season_status: 'regular',
    is_owner: isOwner,
    is_commissioner: isOwner,
    my_team_name: isOwner ? 'Layout Guard FC' : 'Second Squad',
    team_count: 10,
    max_teams: 10,
  };
}

async function fulfilApi(route: Route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (method === 'GET' && pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'e2e-viewer' });
  if (method === 'GET' && pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
  if (method === 'GET' && pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
  if (method === 'GET' && pathname === '/api/draft/mine') return json(route, 200, []);
  if (method === 'GET' && pathname === '/api/league') {
    return json(route, 200, [leagueRow(4400, 'Layout Guard League', true), leagueRow(4401, 'Second League', false)]);
  }

  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

export async function setupMyLeaguesLayout(page: Page) {
  await page.route('**/api/**', fulfilApi);
}
