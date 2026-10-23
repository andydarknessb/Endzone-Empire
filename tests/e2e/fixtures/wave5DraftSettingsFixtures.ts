// Fixture for the wave 5 Draft settings e2e (spec #2433, 3/8): a pending snake draft with four Teams, the
// viewer as commissioner. One catch-all route answers every endpoint the page reads and 500s anything else.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

const USER_ID = 61;
export const LEAGUE_ID = 7800;
export const DRAFT_SETTINGS_URL = `/#/league/${LEAGUE_ID}/draft-settings`;
export const TEAM_NAMES = ['Alpha Dogs', 'Bravo Bears', 'Charlie Chiefs', 'Delta Hawks'];

const leagueRow = () => ({
  id: LEAGUE_ID,
  name: 'Sunday Ballers',
  is_commissioner: true,
  draft_status: 'pending',
  draft_type: 'snake',
  draft_rotation: 'snake',
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
  position_caps: {},
  roster_slots: [{ slot: 'QB', count: 1 }, { slot: 'RB', count: 2 }, { slot: 'WR', count: 2 }, { slot: 'TE', count: 1 }],
  bench_slots: 6,
  ir_slots: 1,
  keepers_enabled: false,
  keeper_count: 0,
  season_status: 'preseason',
  market: 'standard',
});

const teams = () => TEAM_NAMES.map((name, index) => ({
  id: 500 + index, name, draft_position: index + 1, draft_ready: index === 0,
}));

async function fulfilApi(route: Route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();
  if (method === 'GET' && pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'e2e-commissioner' });
  if (method === 'GET' && pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
  if (method === 'GET' && pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
  if (method === 'GET' && pathname === '/api/league') return json(route, 200, [leagueRow()]);
  if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}`) return json(route, 200, { league: leagueRow(), teams: teams(), viewerTeamId: 500 });
  if (method === 'GET' && pathname.startsWith(`/api/draft/league/${LEAGUE_ID}/keeper`)) return json(route, 200, []);
  if (method === 'POST' && pathname === `/api/draft/league/${LEAGUE_ID}/order`) return json(route, 200, {});
  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

export async function setupDraftSettings(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  await page.route('**/api/**', fulfilApi);
}
