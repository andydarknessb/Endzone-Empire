// Route-mocked fixture for League rules on Play-select (ADR 0067 wave 5, spec #2433): it layers the league row
// and the scoring defaults onto the layout-guard harness (layoutGuardFixtures.ts) and registers AFTER it, so
// these routes win. `pickemOnly` serves the same league as a pick'em-only pool.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import {
  LEAGUE_ID, LEAGUE_ROW, setupLayoutGuard, TEAMS, VIEWER_TEAM_ID,
} from './layoutGuardFixtures';

export const RULES_URL = `/#/league/${LEAGUE_ID}/rules`;

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

const RULES_ROW = {
  scoring_preset: 'half_ppr',
  scoring_rules: null,
  dp_enabled: true,
  bench_slots: 6,
  ir_slots: 1,
  position_caps: { QB: 3, K: 1 },
  faab_budget: 100,
  trade_veto_votes: 4,
  regular_season_weeks: 14,
  playoff_teams: 6,
  playoff_consolation: true,
  keepers_enabled: true,
  keeper_count: 2,
  owner_id: 1,
  ownerTeamName: TEAMS[0].teamName,
  co_commissioners: [{ teamId: 102, teamName: TEAMS[1].teamName }],
};

export type RulesFixtureOptions = { theme: 'light' | 'dark'; pickemOnly?: boolean };

/** Registers the harness and the rules reads; call before `page.goto(RULES_URL)`. */
export async function setupRulesFixture(page: Page, { theme, pickemOnly = false }: RulesFixtureOptions) {
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
        league: { ...LEAGUE_ROW, ...RULES_ROW, pickem_only: pickemOnly },
        teams: TEAMS,
        viewerTeamId: VIEWER_TEAM_ID,
      });
    }
    if (pathname === '/api/scoring/rules') return json(route, 200, { defaults: SCORING_DEFAULTS, presets: {} });
    if (pathname === `/api/pickem/league/${LEAGUE_ID}/settings`) {
      return json(route, 200, { enabled: true, mode: 'straight', isCommissioner: false });
    }
    return route.fallback();
  });
}
