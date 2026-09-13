// Fixture harness for the Decision card's 390px layout guard (#1307, ADR
// 0040's premise-check ruling item 5: "the 390 px layout criterion is met
// with the Playwright config playwright.e2e.config.js ... with API
// responses stubbed through page.route, as the tests/e2e/draft-*.spec.ts
// specs do"). Modeled on layoutGuardFixtures.ts's catch-all-route shape: one
// handler answers every endpoint WaiverWire and the Decision card read and
// 500s `unexpected mocked request` on anything else.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

export const LEAGUE_ID = 4300;
const USER_ID = 51;
const PLAYER_ID = 9001;
export const PLAYER_NAME = 'Breece Hall';

export const WAIVERS_URL = `/#/league/${LEAGUE_ID}/waivers`;

// A full card payload (#1306/#1331 shape), rich enough to exercise every
// section this ticket adds - the decision strip, all 18 weekly bars, a
// game log row and a news item - so the 390px guard measures real content,
// not an empty drawer.
function cardPayload() {
  const weeks = [];
  for (let week = 1; week <= 18; week++) {
    if (week === 9) weeks.push({ week, opponent: null, kind: 'bye' });
    else if (week === 3) weeks.push({ week, opponent: 'KC', kind: 'unavailable', reason: 'out' });
    else if (week <= 4) weeks.push({ week, opponent: 'KC', kind: 'actual', points: 14.2 });
    else weeks.push({ week, opponent: 'KC', kind: 'projected', points: 12.8 });
  }
  return {
    player: {
      id: PLAYER_ID,
      name: PLAYER_NAME,
      position: 'RB',
      teamCode: 'NYJ',
      jerseyNumber: 20,
      photoUrl: null,
      byeWeek: 9,
      injury: { designation: null, detail: null },
    },
    availability: {
      state: 'waivers',
      teamId: null,
      teamName: null,
      availableAt: '2026-09-17T07:00:00.000Z',
      rosterCapacity: 16,
      rosterCount: 14,
      faabRemaining: 85,
      waiverPriority: null,
    },
    decision: {
      projWeek: { week: 4, points: 12.8, opponent: 'KC', opponentRankVsPosition: null },
      ros: { points: 142.6, perGame: 11.9, posRank: null, throughWeek: 17 },
      upgrade: { points: 4.1, overPlayer: 'Bench Warmer', slot: 'FLEX' },
      usage: {
        weeks: [{ season: 2026, week: 3, targets: 4, carries: 12, airYards: 30, targetShare: 0.12, fantasyPoints: 9.4 }],
        seasonAverage: { targets: 3.5, carries: 10.2, airYards: 28, targetShare: 0.11, fantasyPoints: 8.7 },
      },
    },
    weeks,
    seasonEnd: 17,
    news: [{ headline: 'Questionable for Sunday with an ankle injury', source: 'espn', publishedAt: '2026-09-10T00:00:00.000Z' }],
    log: {
      current: [{ week: 1, opponent: 'BUF', statLine: { rushingYards: 82, rushingTDs: 1 }, points: 14.2 }],
      previousSeasons: [],
    },
    bio: null,
    depth: null,
    ownership: null,
  };
}

function waiversResponse() {
  return {
    league: { waiver_type: 'faab', waiver_period_hours: 24, faab_budget: 100, waivers_clear_at: null },
    myTeam: { id: 500, waiver_priority: null, faab_remaining: 85 },
    onWaivers: [
      { id: PLAYER_ID, name: PLAYER_NAME, position: 'RB', nfl_team: 'New York Jets', available_at: '2026-09-17T07:00:00.000Z' },
    ],
    myClaims: [],
  };
}

function rosterRows() {
  return [
    { id: 20, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills', projected_weekly_points: 22.4 },
    { id: 21, name: 'Bench Warmer', position: 'WR', nfl_team: 'Free Agent', projected_weekly_points: 3.2 },
  ];
}

async function fulfilApi(route: Route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (method === 'GET' && pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'e2e-viewer' });
  if (method === 'GET' && pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
  if (method === 'GET' && pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
  if (method === 'GET' && pathname === '/api/waivers') return json(route, 200, waiversResponse());
  if (method === 'GET' && pathname === '/api/waivers/suggestions') return json(route, 200, { suggestions: [] });
  if (method === 'GET' && pathname === '/api/team/roster') return json(route, 200, rosterRows());
  if (method === 'GET' && pathname === `/api/players/${PLAYER_ID}/card`) return json(route, 200, cardPayload());
  if (method === 'GET' && pathname === `/api/team/lineup/${PLAYER_ID}/context`) {
    return json(route, 200, { line: null, weather: null, usage: null });
  }

  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

export async function setupDecisionCardLayoutGuard(page: Page) {
  await page.route('**/api/**', fulfilApi);
}
