// Route-mocked fixture for Power rankings on Play-select (ADR 0067 wave 5, spec #2433): it layers the rankings
// and standings reads onto the layout-guard harness (layoutGuardFixtures.ts) and registers AFTER it, so these
// routes win. Team 1 rose 3, team 2 fell 2, team 3 is unchanged, team 4 is new.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import { LEAGUE_ID, setupLayoutGuard, TEAMS, VIEWER_TEAM_ID } from './layoutGuardFixtures';

export const POWER_RANKINGS_URL = `/#/league/${LEAGUE_ID}/power-rankings`;

const CHANGES: Array<number | null> = [3, -2, 0, null];

function rankings() {
  return TEAMS.slice(0, 4).map((team, i) => ({
    teamId: team.teamId,
    name: team.teamName,
    rank: i + 1,
    score: 90 - i * 10,
    winPct: 0.75 - i * 0.2,
    avgScore: 121.3 - i * 11,
    playoffOdds: 0.9 - i * 0.2,
    titleOdds: 0.34 - i * 0.1,
    change: CHANGES[i],
  }));
}

export async function setupPowerRankingsFixture(page: Page, theme: 'light' | 'dark') {
  await setupLayoutGuard(page);
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== 'GET') return route.fallback();
    if (pathname === `/api/scoring/league/${LEAGUE_ID}/power-rankings`) {
      return json(route, 200, {
        season: 2026,
        week: 5,
        viewerTeamId: VIEWER_TEAM_ID,
        data: { computedAt: '2026-07-10T12:00:00.000Z', runs: 10000, rankings: rankings() },
      });
    }
    if (pathname === `/api/scoring/league/${LEAGUE_ID}/standings`) {
      return json(route, 200, {
        league: { season_status: 'in_progress' },
        standings: rankings().map((r) => ({ teamId: r.teamId, name: r.name, wins: 3, losses: 1, ties: 0 })),
      });
    }
    return route.fallback();
  });
}
