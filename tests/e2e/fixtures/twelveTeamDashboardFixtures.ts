// Fixture for the League Dashboard's 12-team layout variant (#1993).
//
// `layoutGuardFixtures.ts` serves a six-team league, and at six teams the
// standings and the Recent activity rail beside them happen to be short. The
// regression this variant exists for showed only on a real 12-team league: the
// reads whose row count follows the team count (the league's teams, the
// standings, the week's matchups, and the 12 activity rows the rail shows one
// per Team) all grow, and the rail has to keep up with the standings. This file
// routes those four reads at twelve long-named Teams.
//
// Registered AFTER `setupLayoutGuard`, so each route wins over the guard's
// `/api/**` catch-all (Playwright tries the most recently registered route
// first). Everything else the dashboard reads (lineup, draft grades for the My
// Team tile, join requests) does not need to follow the team count and stays
// the guard's.
import type { Page } from '@playwright/test';
import { json } from './jsonRoute';
import { LEAGUE_ID, LEAGUE_ROW, TEAMS as SIX_TEAMS } from './layoutGuardFixtures';

const CURRENT_WEEK = 18;
const VIEWER_TEAM_ID = SIX_TEAMS[0].teamId;

// The guard's six Teams, then six more, all long enough that a name column
// which could not shrink would overflow (the shape of the guard's own names).
export const TWELVE_TEAMS = [
  ...SIX_TEAMS,
  { teamId: 107, teamName: 'Tallahassee Swamp Gator Wranglers' },
  { teamId: 108, teamName: 'Saskatchewan Prairie Thunderchickens' },
  { teamId: 109, teamName: 'Appalachian Trail Mix Marauders' },
  { teamId: 110, teamName: 'Mississippi Delta Blues Brothers' },
  { teamId: 111, teamName: 'Yellowstone Caldera Bison Herd' },
  { teamId: 112, teamName: 'Okefenokee Swamp Fog Lanterns' },
];

// One row per Team, best record first, as the standings route sends them.
function standings() {
  return {
    standings: TWELVE_TEAMS.map((t, i) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      rank: i + 1,
      wins: 12 - i,
      losses: i,
      ties: 0,
      pf: 1500 - i * 20,
      pa: 1200 + i * 15,
    })),
  };
}

// Twelve raw transaction rows, newest first (`GET /api/league/:id/transactions`,
// entities/activity's `activityFromRow` input shape): the Recent activity rail
// shows one row per Team up to 12, and the guard's own feed holds only 8.
function transactions() {
  const types = ['add', 'drop'];
  return Array.from({ length: 12 }, (_, i) => ({
    id: 9001 - i,
    type: types[i % 2],
    team_name: TWELVE_TEAMS[i % 12].teamName,
    player_name: i % 2 === 0 ? `Waiver Wire Wonder ${i + 1}` : `Bench Warmer ${i + 1}`,
    created_at: new Date(Date.UTC(2026, 8, 8, 20 - i, 0, 0)).toISOString(),
  }));
}

function matchupRow(id: number, week: number, home: (typeof TWELVE_TEAMS)[number], away: (typeof TWELVE_TEAMS)[number]) {
  return {
    id,
    season: 2026,
    week,
    final: false,
    status: 'played',
    first_kickoff_at: null,
    synced_at: null,
    home_team_id: home.teamId,
    home_team_name: home.teamName,
    home_score: 112.4,
    home_expected_final: 118.9,
    home_players_remaining: 2,
    away_team_id: away.teamId,
    away_team_name: away.teamName,
    away_score: 108.1,
    away_expected_final: 114.2,
    away_players_remaining: 3,
  };
}

// The viewer's Matchup every week (so the hero renders and every week has a
// radio), and in the current week six Matchups, one per pair of the twelve
// Teams: the Around the League strip then holds six tiles.
function matchups() {
  const rows = [];
  for (let week = 1; week < CURRENT_WEEK; week++) {
    rows.push(matchupRow(week, week, TWELVE_TEAMS[0], TWELVE_TEAMS[1]));
  }
  for (let pair = 0; pair < 6; pair++) {
    rows.push(matchupRow(500 + pair, CURRENT_WEEK, TWELVE_TEAMS[2 * pair], TWELVE_TEAMS[2 * pair + 1]));
  }
  return rows;
}

/**
 * Re-routes the four team-count-following reads at twelve Teams. Call after
 * `setupLayoutGuard` and before the first `page.goto`.
 */
export async function routeTwelveTeamLeague(page: Page) {
  const isGet = (pathname: string) => (u: URL) => u.pathname === pathname;
  const get = (pathname: string, body: () => unknown) =>
    page.route(isGet(pathname), (route) =>
      route.request().method() === 'GET' ? json(route, 200, body()) : route.fallback(),
    );

  await get(`/api/league/${LEAGUE_ID}`, () => ({
    league: LEAGUE_ROW,
    teams: TWELVE_TEAMS,
    viewerTeamId: VIEWER_TEAM_ID,
  }));
  await get(`/api/scoring/league/${LEAGUE_ID}/standings`, standings);
  await get(`/api/league/${LEAGUE_ID}/transactions`, transactions);
  await get(`/api/league/${LEAGUE_ID}/matchups`, matchups);
}
