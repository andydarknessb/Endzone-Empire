// Route-mocked fixture for the Transaction log on Play-select (ADR 0067 wave 5, spec #2433): it layers the
// league row, the transactions read and a player card onto the layout-guard harness (layoutGuardFixtures.ts)
// and registers AFTER it, so these routes win. `pickemOnly` serves the same league as a pick'em-only pool.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import {
  LEAGUE_ID, LEAGUE_ROW, setupLayoutGuard, TEAMS, VIEWER_TEAM_ID,
} from './layoutGuardFixtures';

export const ACTIVITY_URL = `/#/league/${LEAGUE_ID}/activity`;

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

// One row of every kind the page draws, spread over three days, 31+ rows so "Show more" is on the page.
const BASE_ROWS = [
  {
    id: 1, type: 'add', team_name: TEAMS[0].teamName, player_name: 'Jahmyr Gibbs', dropped_player_name: null, detail: { playerId: 1 }, created_at: hoursAgo(1),
  },
  {
    id: 2, type: 'drop', team_name: TEAMS[1].teamName, player_name: 'Zach Wilson', dropped_player_name: null, detail: { playerId: 2 }, created_at: hoursAgo(2),
  },
  {
    id: 3, type: 'waiver', team_name: TEAMS[0].teamName, player_name: 'Breece Hall', dropped_player_name: 'Tank Bigsby', detail: { playerId: 3, droppedPlayerId: 4, bid: 12 }, created_at: hoursAgo(5),
  },
  {
    id: 4,
    type: 'trade',
    team_name: TEAMS[0].teamName,
    player_name: null,
    dropped_player_name: null,
    detail: {
      proposingTeamId: 101,
      receivingTeamId: 102,
      receivingTeamName: TEAMS[1].teamName,
      items: [
        { playerId: 5, playerName: 'Puka Nacua', fromTeamId: 101, toTeamId: 102 },
        { playerId: 6, playerName: 'Chris Olave', fromTeamId: 102, toTeamId: 101 },
      ],
    },
    created_at: hoursAgo(30),
  },
  {
    id: 5, type: 'commissioner', team_name: null, player_name: null, dropped_player_name: null, detail: {}, created_at: hoursAgo(31),
  },
  {
    id: 6, type: 'stat_correction', team_name: null, player_name: null, dropped_player_name: null, detail: { season: 2026, week: 4, changes: [{ matchupId: 9 }] }, created_at: hoursAgo(80),
  },
];
const FILLER_ROWS = Array.from({ length: 28 }, (_, i) => ({
  id: 100 + i,
  type: 'add',
  team_name: TEAMS[i % 2].teamName,
  player_name: `Filler Player ${i + 1}`,
  dropped_player_name: null,
  detail: { playerId: 100 + i },
  created_at: hoursAgo(90 + i),
}));
const ROWS = [...BASE_ROWS, ...FILLER_ROWS];

export type ActivityFixtureOptions = { theme: 'light' | 'dark'; pickemOnly?: boolean };

/** Registers the harness and the activity reads; call before `page.goto(ACTIVITY_URL)`. */
export async function setupActivityFixture(page: Page, { theme, pickemOnly = false }: ActivityFixtureOptions) {
  await setupLayoutGuard(page);
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    if (pathname === `/api/league/${LEAGUE_ID}`) {
      return json(route, 200, {
        league: { ...LEAGUE_ROW, pickem_only: pickemOnly },
        teams: TEAMS,
        viewerTeamId: VIEWER_TEAM_ID,
      });
    }
    if (pathname === `/api/league/${LEAGUE_ID}/transactions`) {
      return json(route, 200, pickemOnly ? ROWS.filter((r) => r.type === 'commissioner') : ROWS);
    }
    if (/^\/api\/players\/\d+\/card$/.test(pathname)) return json(route, 200, { news: [], availability: { state: 'rostered' } });
    return route.fallback();
  });
}
