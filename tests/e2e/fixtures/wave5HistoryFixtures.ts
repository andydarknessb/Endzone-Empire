// Route-mocked fixture for League history on Play-select (ADR 0067 wave 5, spec #2433): layers the one
// history read onto the layout-guard harness (layoutGuardFixtures.ts), which answers the app shell,
// `GET /api/user` and the league row, and registers AFTER it so the history route wins.
//
// Two archived seasons with the harness's long team names, so the champion banner, the standings rows,
// the trophy lines and the draft-grade rows are as wide as a real league's. The newest season has a
// champion, a podium, trophies and draft grades; the older one has none of the optional parts.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import { LEAGUE_ID, setupLayoutGuard, TEAMS } from './layoutGuardFixtures';

export const HISTORY_URL = `/#/league/${LEAGUE_ID}/history`;

const standing = (index: number, rank: number, wins: number, losses: number, pf: number) => ({
  teamId: TEAMS[index].teamId, name: TEAMS[index].teamName, rank, wins, losses, ties: 0, pf,
});

const HISTORY = {
  seasons: [
    {
      season: 2026,
      outcome: 'champion',
      champions: [{
        teamId: TEAMS[0].teamId, name: TEAMS[0].teamName, avatarUrl: null, avatarStaticUrl: null,
      }],
      standings: [
        standing(0, 1, 12, 2, 1502.4),
        standing(1, 2, 10, 4, 1400.1),
        standing(2, 3, 9, 5, 1350.7),
        standing(3, 4, 7, 7, 1290.3),
        standing(4, 5, 5, 9, 1201.9),
        standing(5, 6, 2, 12, 1102.5),
      ],
      trophies: [
        { id: 1, type: 'champion', label: '2026 League Champion', team_name: TEAMS[0].teamName },
        { id: 2, type: 'fewest_left_on_bench', label: 'Fewest Left on the Bench', team_name: TEAMS[4].teamName },
        { id: 3, type: 'win_streak', label: 'Longest Win Streak (7)', team_name: TEAMS[1].teamName },
      ],
      draftGrades: [
        { teamId: TEAMS[1].teamId, name: TEAMS[1].teamName, grade: 'A+', rosterValue: 250.1, rank: 1 },
        { teamId: TEAMS[0].teamId, name: TEAMS[0].teamName, grade: 'B', rosterValue: 210.4, rank: 2 },
        { teamId: TEAMS[5].teamId, name: TEAMS[5].teamName, grade: 'D-', rosterValue: null, rank: 3 },
      ],
    },
    {
      season: 2025,
      outcome: 'no_champion',
      champions: [],
      standings: [standing(2, 1, 10, 4, 1400)],
      trophies: [],
      draftGrades: null,
    },
  ],
  allTime: TEAMS.map((team, index) => ({
    teamId: team.teamId,
    name: team.teamName,
    avatarUrl: null,
    avatarStaticUrl: null,
    championships: index === 0 ? 1 : 0,
    wins: 20 - index,
    losses: 8 + index,
    ties: 0,
  })),
};

export async function setupHistoryFixture(page: Page, { theme }: { theme: 'light' | 'dark' }) {
  await setupLayoutGuard(page);
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (request.method() === 'GET' && pathname === `/api/league/${LEAGUE_ID}/history`) return json(route, 200, HISTORY);
    return route.fallback();
  });
}
