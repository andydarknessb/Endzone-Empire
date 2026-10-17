// Fixture for the wave 3 Waivers e2e (ADR 0067, spec #2347 AC 11): the WaiversStates and Waivers boards'
// shape. Thursday Night Regulars, FAAB, 14 players on waivers (10 on the page), two pending claims that
// share a drop, Week 6 results, a full roster. The cursor row is Michael Wilson: the largest positive
// Upgrade among the rows the manager has not claimed (Rashid Shaheed's is larger, but he has a pending
// claim). A catch-all route answers every endpoint the page reads and 500s anything else.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

const USER_ID = 61;
export const LEAGUE_ID = 7700;
export const WAIVERS_URL = `/#/league/${LEAGUE_ID}/waivers`;
export const CURSOR_NAME = 'Michael Wilson';
export const CLAIMED_NAMES = ['Rashid Shaheed', 'Jalen McMillan'];

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600 * 1000).toISOString();

type Row = [id: number, name: string, position: string, team: string, opp: string | null, proj: number, ros: number, own: number, up: number | null, upWeek: number, injury?: string];
const ROWS: Row[] = [
  [101, 'Rashid Shaheed', 'WR', 'SEA', 'HOU', 14.6, 161.8, 38, 4.2, 8],
  [102, 'Michael Wilson', 'WR', 'ARI', 'SF', 13.8, 153.7, 29, 2.4, 9],
  [103, 'Jaylen Wright', 'RB', 'MIA', 'BUF', 12.4, 138.4, 17, 2.2, 8, 'Q'],
  [104, 'Dalton Schultz', 'TE', 'HOU', 'SEA', 9.8, 118.3, 41, 2.2, 8],
  [105, 'Kimani Vidal', 'RB', 'LAC', null, 0, 132.9, 22, 1.8, 8],
  [106, 'Seahawks', 'DEF', 'SEA', 'HOU', 8.2, 90.9, 12, 1.7, 8],
  [107, 'Jalen McMillan', 'WR', 'TB', 'DET', 11.6, 127.7, 14, 1.4, 8],
  [108, 'Cairo Santos', 'K', 'CHI', 'GB', 8.8, 106.2, 18, 0.7, 8],
  [109, 'Gardner Minshew', 'QB', 'LV', 'KC', 14.6, 162.6, 6, null, 8],
  [110, 'Ty Chandler', 'RB', 'MIN', 'PHI', 8.4, 92.3, 9, null, 8],
];

function cardsPlayer([id, name, position, team, opp, proj, ros, own, up, upWeek, injury]: Row) {
  const weeks = [];
  for (let week = 7; week <= 18; week += 1) {
    weeks.push(week === 7 && opp === null ? { week, reason: 'bye' } : { week, points: Math.max(2, proj + ((week * 7 + id) % 5) - 2) });
  }
  return {
    id,
    name,
    position,
    nfl_team: team,
    nfl_opponent: opp,
    photo_url: null,
    injury_status: injury || null,
    bye_week: opp === null ? 7 : 11,
    availability: { state: 'waivers', teamId: null, teamName: null, availableAt: hoursFromNow(64) },
    projWeek: opp === null ? { week: 7, reason: 'bye' } : { week: 7, points: proj },
    ros: { points: ros, perGame: Math.round((ros / 11) * 10) / 10, posRank: 12, throughWeek: 17 },
    weeks,
    ownership: { share: own, change: 0 },
    upgrade: up == null ? null : { points: up, week: upWeek, overPlayer: { id: 5001, name: 'Chris Olave', points: 12.4 }, slot: position },
    watching: false,
  };
}

const playersResponse = () => ({
  players: ROWS.map(cardsPlayer),
  totalPages: 2,
  total: 14,
  context: {
    leagueId: LEAGUE_ID,
    leagueName: 'Thursday Night Regulars',
    rosterCount: 15,
    rosterCapacity: 15,
    waiverType: 'faab',
    faabRemaining: 62,
    waiverPriority: 5,
    dropSuggestion: { id: 5004, name: 'Tyler Allgeier' },
  },
});

const claim = (id: number, playerId: number, name: string, bid: number, order: number) => ({
  id,
  player_id: playerId,
  player_name: name,
  drop_player_id: 5004,
  drop_player_name: 'Tyler Allgeier',
  bid,
  status: 'pending',
  note: null,
  claim_order: order,
  created_at: `2026-10-1${order}T00:00:00Z`,
  processed_at: null,
  clear_at: hoursFromNow(64),
});
const resolved = (id: number, name: string, status: string, week: number | null, extra: Record<string, unknown>) => ({
  id,
  player_id: 9000 + id,
  player_name: name,
  drop_player_id: null,
  drop_player_name: null,
  bid: 0,
  status,
  note: null,
  claim_order: null,
  created_at: '2026-10-01T00:00:00Z',
  processed_at: '2026-10-08T07:00:00Z',
  week,
  ...extra,
});

const waiversResponse = () => ({
  league: { waiver_type: 'faab', waiver_period_hours: 48, faab_budget: 100, waivers_clear_at: hoursFromNow(64), current_season: 2026 },
  myTeam: { id: 500, waiver_priority: 5, faab_remaining: 81 },
  onWaivers: [],
  myClaims: [
    claim(1, 101, 'Rashid Shaheed', 14, 1),
    claim(2, 107, 'Jalen McMillan', 5, 2),
    resolved(3, 'Woody Marks', 'won', 6, { bid: 12 }),
    resolved(4, 'Elijah Moore', 'lost', 6, { bid: 9, winning_team_name: 'Waiver Wolves', winning_bid: 17 }),
    resolved(5, 'Jalen Nailor', 'won', null, { bid: 7 }),
  ],
});

const leagueRow = () => ({
  id: LEAGUE_ID,
  name: 'Thursday Night Regulars',
  draft_status: 'complete',
  season_status: 'regular',
  waiver_type: 'faab',
  waiver_period_hours: 48,
  best_ball: false,
  my_team_faab_remaining: 81,
  my_team_waiver_priority: 5,
});

const rosterResponse = () => [
  ['Chris Olave', 'WR', 12.4], ['Puka Nacua', 'WR', 16.2], ['Romeo Doubs', 'WR', 9.0], ['Tyler Allgeier', 'RB', 6.8], ['Tank Bigsby', 'RB', 6.4],
  ['Josh Allen', 'QB', 22.1], ['Jahmyr Gibbs', 'RB', 19.6], ['Trey McBride', 'TE', 8.9], ['Brandon Aubrey', 'K', 9.4], ['Broncos', 'DEF', 8.0],
].map(([name, position, projected_weekly_points], i) => ({
  id: 5001 + i, name, position, projected_weekly_points, nfl_team: 'AAA', status: 'bench',
}));

const lineupResponse = () => {
  const entry = (id: number, name: string, position: string, bye: number) => ({
    id, name, position, slot: position, bye_week: bye, nfl_team: 'AAA', projected_points: 10,
  });
  return {
    week: 7,
    currentWeek: 7,
    season: 2026,
    teamId: 500,
    rosterSlots: [],
    entries: [
      entry(1, 'Jahmyr Gibbs', 'RB', 8), entry(2, 'Puka Nacua', 'WR', 8), entry(3, 'Trey McBride', 'TE', 8), entry(4, 'Tank Bigsby', 'RB', 8),
      entry(5, 'Josh Allen', 'QB', 12), entry(6, 'Chris Olave', 'WR', 11),
    ],
  };
};

const cardResponse = () => ({
  news: [
    { headline: 'Wilson logged a full practice on Friday.', url: null, blurb: null, publishedAt: '2026-10-16T12:00:00Z' },
    { headline: 'Arizona lists Wilson as its No. 2 receiver on the Week 7 depth chart.', url: null, blurb: null, publishedAt: '2026-10-16T12:00:00Z' },
  ],
});

async function fulfilApi(route: Route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();
  if (method === 'GET' && pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'e2e-viewer' });
  if (method === 'GET' && pathname === '/api/notifications') return json(route, 200, { notifications: [], unread: 0 });
  if (method === 'GET' && pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
  if (method === 'GET' && pathname === '/api/league') return json(route, 200, [leagueRow()]);
  if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}`) return json(route, 200, { league: leagueRow(), teams: [], viewerTeamId: 500 });
  if (method === 'GET' && pathname === '/api/team/roster') return json(route, 200, rosterResponse());
  if (method === 'GET' && pathname === '/api/team/lineup') return json(route, 200, lineupResponse());
  if (method === 'GET' && pathname === '/api/waivers') return json(route, 200, waiversResponse());
  if (method === 'GET' && pathname === '/api/players') return json(route, 200, playersResponse());
  if (method === 'GET' && /^\/api\/players\/\d+\/card$/.test(pathname)) return json(route, 200, cardResponse());
  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

export async function setupWave3Waivers(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  await page.route('**/api/**', fulfilApi);
}
