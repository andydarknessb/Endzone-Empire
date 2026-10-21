// Route-mocked fixture for the Commissioner console on Play-select (ADR 0067 wave 5, spec #2433): it layers the
// join-request queue and the scoring defaults onto the layout-guard harness (layoutGuardFixtures.ts) and registers
// AFTER it, so these routes win. The harness league row already makes the viewer the commissioner of a public,
// join-approval league, so the console's queue widget and the tools both mount.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import {
  LEAGUE_ID, LEAGUE_ROW, setupLayoutGuard, TEAMS, VIEWER_TEAM_ID,
} from './layoutGuardFixtures';

export const COMMISSIONER_URL = `/#/league/${LEAGUE_ID}/commissioner`;

const SCORING_DEFAULTS = {
  passing: { yards: 0.04, touchdowns: 4, interceptions: -2 },
  rushing: { yards: 0.1, touchdowns: 6 },
  receiving: { yards: 0.1, touchdowns: 6, reception: 0.5 },
  misc: { fumblesLost: -2 },
  kicking: {
    extraPoint: 1,
    fieldGoal: [
      { min: 0, max: 39, points: 3 },
      { min: 40, max: 49, points: 4 },
      { min: 50, max: null, points: 5 },
    ],
  },
  teamDefense: { sack: 1 },
  idp: { soloTackle: 1 },
};

const PENDING_REQUESTS = [
  { id: 11, team_name: 'Gridiron Gurus', created_at: '2026-09-08T20:00:00.000Z' },
  { id: 12, team_name: 'End Zone Elites', created_at: '2026-09-08T19:00:00.000Z' },
];

export type CommissionerFixtureOptions = { theme: 'light' | 'dark'; pending: boolean };

/** Registers the harness and the console reads; call before `page.goto(COMMISSIONER_URL)`. `pending: false` serves an empty queue. */
export async function setupCommissionerFixture(page: Page, { theme, pending }: CommissionerFixtureOptions) {
  await setupLayoutGuard(page);
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    if (pathname === `/api/league/${LEAGUE_ID}`) {
      return json(route, 200, { league: { ...LEAGUE_ROW, owner_id: 1 }, teams: TEAMS, viewerTeamId: VIEWER_TEAM_ID });
    }
    if (pathname === `/api/league/${LEAGUE_ID}/join-requests`) return json(route, 200, pending ? PENDING_REQUESTS : []);
    if (pathname === `/api/commissioner/league/${LEAGUE_ID}/bans`) return json(route, 200, []);
    if (pathname === '/api/scoring/rules') return json(route, 200, { defaults: SCORING_DEFAULTS, presets: {} });
    return route.fallback();
  });
}
