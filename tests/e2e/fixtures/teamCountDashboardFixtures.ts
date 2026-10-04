// Fixture for the League Dashboard's larger-league layout variants (#1993).
//
// `layoutGuardFixtures.ts` serves a six-team league, and at six teams the
// standings and the Recent activity rail beside them happen to be short. The
// regression behind this file showed only on a real 12-team league, and
// fantasy leagues go up to 20 teams: the reads whose row count follows the team
// count (the league's teams, the standings, the week's matchups, and the
// activity feed the rail draws its rows from) all grow, and the rail has to keep
// up with the standings. `routeLeagueOfSize` routes those four reads at N
// long-named Teams (7 to 20).
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

// The guard's six Teams, then fourteen more, all long enough that a name column
// which could not shrink would overflow (the shape of the guard's own names).
export const TWENTY_TEAMS = [
  ...SIX_TEAMS,
  { teamId: 107, teamName: 'Tallahassee Swamp Gator Wranglers' },
  { teamId: 108, teamName: 'Saskatchewan Prairie Thunderchickens' },
  { teamId: 109, teamName: 'Appalachian Trail Mix Marauders' },
  { teamId: 110, teamName: 'Mississippi Delta Blues Brothers' },
  { teamId: 111, teamName: 'Yellowstone Caldera Bison Herd' },
  { teamId: 112, teamName: 'Okefenokee Swamp Fog Lanterns' },
  { teamId: 113, teamName: 'Chesapeake Bay Blue Crab Bandits' },
  { teamId: 114, teamName: 'Upper Peninsula Pasty Eaters' },
  { teamId: 115, teamName: 'Rio Grande Valley Roadrunners' },
  { teamId: 116, teamName: 'Cuyahoga Falls Lake Effect' },
  { teamId: 117, teamName: 'Louisville Slugger Sluggers' },
  { teamId: 118, teamName: 'Mojave Desert Dust Devils' },
  { teamId: 119, teamName: 'Presque Isle Potato Kings' },
  { teamId: 120, teamName: 'Everglades Gator Tail Gang' },
];

type Team = (typeof TWENTY_TEAMS)[number];

// One row per Team, best record first, as the standings route sends them.
function standings(teams: Team[]) {
  return {
    standings: teams.map((t, i) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      rank: i + 1,
      wins: 20 - i,
      losses: i,
      ties: 0,
      pf: 1500 - i * 20,
      pa: 1200 + i * 15,
    })),
  };
}

// Twenty raw transaction rows, newest first (`GET /api/league/:id/transactions`,
// entities/activity's `activityFromRow` input shape): a feed with at least as
// many rows as the largest rail needs (ceil(20 * 5 / 6) = 17), which a league
// past its first weeks has. The guard's own feed holds only 8.
function transactions(teams: Team[]) {
  const types = ['add', 'drop'];
  return Array.from({ length: 20 }, (_, i) => ({
    id: 9001 - i,
    type: types[i % 2],
    team_name: teams[i % teams.length].teamName,
    player_name: i % 2 === 0 ? `Waiver Wire Wonder ${i + 1}` : `Bench Warmer ${i + 1}`,
    created_at: new Date(Date.UTC(2026, 8, 8, 20 - i, 0, 0)).toISOString(),
  }));
}

function matchupRow(id: number, week: number, home: Team, away: Team) {
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
// radio), and in the current week one Matchup per pair of Teams: the Around the
// League strip then holds N / 2 tiles.
function matchups(teams: Team[]) {
  const rows = [];
  for (let week = 1; week < CURRENT_WEEK; week++) {
    rows.push(matchupRow(week, week, teams[0], teams[1]));
  }
  for (let pair = 0; pair < teams.length / 2; pair++) {
    rows.push(matchupRow(500 + pair, CURRENT_WEEK, teams[2 * pair], teams[2 * pair + 1]));
  }
  return rows;
}

/**
 * Re-routes the four team-count-following reads at `teamCount` Teams (an even
 * number, 8 to 20). Call after `setupLayoutGuard` and before the first
 * `page.goto`.
 */
export async function routeLeagueOfSize(page: Page, teamCount: number) {
  const teams = TWENTY_TEAMS.slice(0, teamCount);
  const get = (pathname: string, body: () => unknown) =>
    page.route(
      (u: URL) => u.pathname === pathname,
      (route) => (route.request().method() === 'GET' ? json(route, 200, body()) : route.fallback()),
    );

  await get(`/api/league/${LEAGUE_ID}`, () => ({
    league: LEAGUE_ROW,
    teams,
    viewerTeamId: VIEWER_TEAM_ID,
  }));
  await get(`/api/scoring/league/${LEAGUE_ID}/standings`, () => standings(teams));
  await get(`/api/league/${LEAGUE_ID}/transactions`, () => transactions(teams));
  await get(`/api/league/${LEAGUE_ID}/matchups`, () => matchups(teams));
}
