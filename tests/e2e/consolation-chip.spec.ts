/**
 * Consolation Matchup chip (#2744). A Consolation bracket game reads Consolation on the Matchup page and
 * never Playoff. Mocked origin: `page.route` stubs the Matchup detail on the layout-guard harness, the same
 * shape league-wave2-matchup.spec.ts uses.
 */
import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';
import { json } from './fixtures/jsonRoute';
import { LEAGUE_ID, LEAGUE_ROW, MATCHUP_URL, setupLayoutGuard } from './fixtures/layoutGuardFixtures';

const MATCHUP_ID = 918;
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

function side(teamId: number, name: string, base: number) {
  return {
    teamId,
    name,
    expectedFinal: 90,
    playersRemaining: 9,
    yetToPlay: 9,
    starters: SLOTS.map((slot, i) => ({
      id: base + i,
      slot,
      name: `${name} Starter ${i + 1}`,
      position: slot === 'FLEX' ? 'WR' : slot,
      nfl_team: 'KC',
      opponent: 'BUF',
      injury_status: null,
      points: 0,
      projected: 10,
      availability: { available: true, reason: null },
      game_state: 'scheduled',
      game_clock: null,
      stats: null,
    })),
    bench: [],
  };
}

function consolationDetail() {
  return {
    matchup: {
      id: MATCHUP_ID, season: 2026, week: 18, final: false, status: 'scheduled', is_playoff: true,
      is_consolation: true, first_kickoff_at: null, synced_at: null, home_score: 0, away_score: 0,
    },
    home: side(101, 'Home Team', 1000),
    away: side(102, 'Away Team', 2000),
    viewerTeamId: 101,
    viewerWhatIf: null,
    nflGameIds: [],
  };
}

async function open(page: Page) {
  await setupLayoutGuard(page, { view: 'standard' });
  await page.route('**/api/**', async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    if (route.request().method() === 'GET' && pathname === `/api/league/${LEAGUE_ID}/matchups/${MATCHUP_ID}`) {
      return json(route, 200, consolationDetail());
    }
    if (route.request().method() === 'GET' && pathname === `/api/league/${LEAGUE_ID}`) {
      return json(route, 200, { league: { ...LEAGUE_ROW, current_week: 18 }, teams: [], viewerTeamId: 101 });
    }
    if (route.request().method() === 'GET' && pathname === '/api/user/action-items') {
      return json(route, 200, { generatedAt: new Date().toISOString(), counts: { total: 0, dueToday: 0 }, partial: [], items: [] });
    }
    if (route.request().method() === 'GET' && pathname === '/api/team/lineup/advice') {
      return json(route, 200, { suggestions: [], openSlotFills: [], movePlan: [] });
    }
    return route.fallback();
  });
  await page.goto(MATCHUP_URL);
  await expect(page.getByRole('heading', { level: 1, name: 'Week 18 Matchup' })).toBeVisible();
}

test('a consolation Matchup shows the Consolation chip and no Playoff chip', async ({ page }) => {
  await open(page);

  await expect(page.getByTestId('matchup-consolation-chip')).toHaveText('Consolation');
  await expect(page.getByTestId('matchup-playoff-chip')).toHaveCount(0);
});
