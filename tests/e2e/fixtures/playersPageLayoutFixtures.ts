// Fixture harness for the Players page layout-density guard (#1975, spec
// #1973 P3 P4 P6-P9). Same catch-all-route shape as playersListFixtures.ts:
// one handler answers every endpoint PlayerManagement reads and 500s
// `unexpected mocked request` on anything else. Ten players across all four
// availability states, and a full roster (16 / 16) so the market chips render.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

const USER_ID = 61;
const LEAGUE_ID = 4400;
export const PLAYERS_LAYOUT_URL = '/#/player';
export const PLAYERS_LAYOUT_LEAGUE_NAME = 'Layout Guard League';

const ROSTER_COUNT = 16;
const ROSTER_CAPACITY = 16;

type Seed = { name: string; position: string; state: string; teamName?: string; weeksReason?: string };

// A player Unavailable for the whole season (no NFL team, practice squad):
// every week carries the reason code and no number (ADR 0040).
const SEASON_UNAVAILABLE_SEEDS: Seed[] = [
  { name: 'Ethan Fernea', position: 'WR', state: 'free_agent', weeksReason: 'no_team' },
  { name: 'Michael Trigg', position: 'TE', state: 'free_agent', weeksReason: 'practice_squad' },
];

const SEEDS: Seed[] = [
  { name: 'Jaylen Warren', position: 'RB', state: 'free_agent' },
  { name: 'Romeo Doubs', position: 'WR', state: 'waivers' },
  { name: 'Chris Godwin', position: 'WR', state: 'rostered', teamName: 'Rival Squad' },
  { name: 'Justin Herbert', position: 'QB', state: 'my_team' },
  { name: 'Tyler Allgeier', position: 'RB', state: 'free_agent' },
  { name: 'Jauan Jennings', position: 'WR', state: 'free_agent' },
  { name: 'Dalton Schultz', position: 'TE', state: 'waivers' },
  { name: 'Brandon Aubrey', position: 'K', state: 'free_agent' },
  { name: 'Seattle Seahawks', position: 'DEF', state: 'rostered', teamName: 'Gridiron Gang' },
  { name: 'Rhamondre Stevenson', position: 'RB', state: 'my_team' },
];

function leagueRow() {
  return {
    id: LEAGUE_ID,
    name: PLAYERS_LAYOUT_LEAGUE_NAME,
    draft_status: 'complete',
    season_status: 'regular',
    waiver_type: 'faab',
    best_ball: false,
    my_team_faab_remaining: 42,
    my_team_waiver_priority: null,
  };
}

function cardsPlayer(seed: Seed, index: number) {
  const points = 8 + index;
  const weeks = [];
  for (let week = 2; week <= 18; week += 1) {
    if (seed.weeksReason) weeks.push({ week, reason: seed.weeksReason });
    else weeks.push(week === 9 ? { week, reason: 'on bye' } : { week, points });
  }
  const { state } = seed;
  return {
    id: 9100 + index,
    name: seed.name,
    position: seed.position,
    nfl_team: 'GB',
    photo_url: null,
    injury_status: null,
    bye_week: 9,
    availability: {
      state,
      teamId: state === 'rostered' ? 55 : (state === 'my_team' ? 500 : null),
      teamName: state === 'rostered' ? seed.teamName ?? null : null,
      availableAt: state === 'waivers' ? '2026-09-17T07:00:00.000Z' : null,
    },
    projWeek: { week: 2, points },
    ros: { points: points * 16, perGame: points, posRank: 12, throughWeek: 17 },
    weeks,
    ownership: null,
    upgrade: state === 'my_team' ? null : { points: 3.2, overPlayer: { id: 1, name: 'Bench Guy' }, slot: seed.position },
  };
}

function playersResponse(seeds: Seed[]) {
  return {
    players: seeds.map(cardsPlayer),
    totalPages: 1,
    total: seeds.length,
    context: {
      leagueId: LEAGUE_ID,
      leagueName: PLAYERS_LAYOUT_LEAGUE_NAME,
      rosterCount: ROSTER_COUNT,
      rosterCapacity: ROSTER_CAPACITY,
      waiverType: 'faab',
      faabRemaining: 42,
      waiverPriority: null,
    },
  };
}

async function fulfilApi(route: Route, seeds: Seed[]) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (method === 'GET' && pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'e2e-viewer' });
  if (method === 'GET' && pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
  if (method === 'GET' && pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
  if (method === 'GET' && pathname === '/api/league') return json(route, 200, [leagueRow()]);
  if (method === 'GET' && pathname === '/api/team/roster') return json(route, 200, []);
  if (method === 'GET' && pathname === '/api/players') return json(route, 200, playersResponse(seeds));

  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

/**
 * `seasonUnavailable` swaps the last two players for two Unavailable every
 * week, still ten rows, so the Weeks strip's all-reason form is on the page.
 */
export async function setupPlayersPageLayout(page: Page, { seasonUnavailable = false } = {}) {
  const seeds = seasonUnavailable ? [...SEEDS.slice(0, -2), ...SEASON_UNAVAILABLE_SEEDS] : SEEDS;
  await page.route('**/api/**', (route) => fulfilApi(route, seeds));
}
