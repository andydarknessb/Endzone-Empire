// Route-mocked fixture for the Trade Center on Play-select (ADR 0067 wave 3, spec #2347): the first trades
// e2e. It layers the trade reads onto the layout-guard harness (layoutGuardFixtures.ts), which answers the
// app shell, `GET /api/user` and the league row (the viewer, team 101, is its commissioner; the trade
// deadline is Week 11), and registers AFTER it so these routes win.
//
// The viewer's team is the harness's own long-named Chattahoochee Valley Riverhogs (30 characters), and the
// other teams carry the harness's long names too, so the card titles are as wide as a real league's.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import { LEAGUE_ID, setupLayoutGuard, TEAMS } from './layoutGuardFixtures';

export const TRADES_URL = `/#/league/${LEAGUE_ID}/trades`;
export const VIEWER_TEAM_ID = 101;
const HOUR = 60 * 60 * 1000;

type Pos = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';
const player = (id: number, name: string, position: Pos, nfl: string, wk: number | null, ros: number | null) => ({
  id, name, position, nfl_team: nfl, projected_weekly_points: wk, rest_of_season_points: ros,
});

const ROSTERS = [
  {
    teamId: VIEWER_TEAM_ID,
    teamName: TEAMS[0].teamName,
    players: [
      player(1001, 'Josh Allen', 'QB', 'BUF', 22.1, 243.1),
      player(1002, 'Jahmyr Gibbs', 'RB', 'DET', 19.6, 215.6),
      player(1003, 'Tyjae Spears', 'RB', 'TEN', 12.9, 141.9),
      player(1004, 'Puka Nacua', 'WR', 'LAR', 0, 188.8),
      player(1005, 'Chris Olave', 'WR', 'NO', 12.1, 133.1),
      player(1006, 'Dalton Kincaid', 'TE', 'BUF', 7.4, 81.4),
      player(1007, 'Brandon Aubrey', 'K', 'DAL', 8.1, 89.1),
      player(1008, 'Broncos', 'DEF', 'DEN', 6.4, 70.4),
    ],
  },
  {
    teamId: 102,
    teamName: TEAMS[1].teamName,
    players: [
      player(2001, 'Garrett Wilson', 'WR', 'NYJ', 13.7, 150),
      player(2002, 'Breece Hall', 'RB', 'NYJ', 14.2, 156.2),
      player(2003, 'Brock Bowers', 'TE', 'LV', 12.3, 135.3),
    ],
  },
  {
    teamId: 105,
    teamName: TEAMS[4].teamName,
    players: [player(3001, 'Zay Flowers', 'WR', 'BAL', 0, 134), player(3002, 'Tyler Allgeier', 'RB', 'ATL', 6.2, 64)],
  },
];

const item = (tradeId: number, from: number, to: number, id: number, name: string, position: Pos, nfl: string, opp: string | null) => ({
  trade_id: tradeId, from_team_id: from, to_team_id: to, player_id: id, name, position, nfl_team: nfl, nfl_opponent: opp,
});

const teamRow = (index: number, side: 'proposing' | 'receiving') => ({
  [`${side}_team_id`]: TEAMS[index].teamId,
  [`${side}_team_name`]: TEAMS[index].teamName,
  [`${side}_team_avatar_url`]: null,
  [`${side}_team_avatar_static_url`]: null,
});

// Newest first, as the API orders them. Trade 12 is the incoming offer (the cursor), 11 a league trade in
// review the viewer is not in (the Commissioner row), 9 the viewer's own outgoing offer.
function trades(now: number, { incoming = true }: { incoming?: boolean } = {}) {
  const base = { review_ends_at: null, league_id: LEAGUE_ID };
  const list = [
    {
      ...base, id: 12, status: 'pending', created_at: new Date(now - 2 * HOUR).toISOString(), ...teamRow(1, 'proposing'), ...teamRow(0, 'receiving'),
      items: [
        item(12, 102, 101, 2001, 'Garrett Wilson', 'WR', 'NYJ', 'CIN'),
        item(12, 101, 102, 1003, 'Tyjae Spears', 'RB', 'TEN', 'IND'),
        item(12, 101, 102, 1006, 'Dalton Kincaid', 'TE', 'BUF', null),
      ],
    },
    {
      ...base, id: 11, status: 'accepted', created_at: new Date(now - 13 * HOUR).toISOString(), review_ends_at: new Date(now + 10 * HOUR).toISOString(), ...teamRow(2, 'proposing'), ...teamRow(3, 'receiving'),
      items: [
        item(11, 103, 104, 4001, 'Jaylen Waddle', 'WR', 'MIA', 'BUF'),
        item(11, 104, 103, 4002, 'Rachaad White', 'RB', 'TB', 'DET'),
      ],
    },
    {
      ...base, id: 9, status: 'pending', created_at: new Date(now - 30 * HOUR).toISOString(), ...teamRow(0, 'proposing'), ...teamRow(4, 'receiving'),
      items: [
        item(9, 105, 101, 3001, 'Zay Flowers', 'WR', 'BAL', null),
        item(9, 101, 105, 1005, 'Chris Olave', 'WR', 'NO', 'CAR'),
      ],
    },
  ];
  return incoming ? list : list.filter((t) => t.id !== 12);
}

// A favors-proposer analysis of trade 12, two decimals on the wire (the page prints one).
export const ANALYSIS = {
  verdict: 'favors_proposer',
  proposerGives: 127.54,
  proposerGets: 223.3,
  receiverGives: 223.3,
  receiverGets: 127.54,
  players: [
    { playerId: 2001, name: 'Garrett Wilson', position: 'WR', rosValue: 150, fitAdjustedValue: 127.5 },
    { playerId: 1003, name: 'Tyjae Spears', position: 'RB', rosValue: 141.9, fitAdjustedValue: 141.9 },
    { playerId: 1006, name: 'Dalton Kincaid', position: 'TE', rosValue: 81.4, fitAdjustedValue: 81.4 },
  ],
};

export type TradesFixtureOptions = {
  theme: 'light' | 'dark';
  /** false: the viewer has no incoming offer, so the page has no cursor. */
  incoming?: boolean;
  /** The server's answer to POST /api/trades (a refusal reproduces the dialog's alert). */
  proposeRefusal?: string;
};

/** Registers the harness and the trade reads; call before `page.goto(TRADES_URL)`. */
export async function setupTradesFixture(page: Page, { theme, incoming = true, proposeRefusal }: TradesFixtureOptions) {
  await setupLayoutGuard(page);
  await page.addInitScript((t) => {
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  const now = Date.now();
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method === 'GET' && pathname === '/api/trades') {
      return json(route, 200, { myTeamId: VIEWER_TEAM_ID, trades: trades(now, { incoming }) });
    }
    if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}/rosters`) return json(route, 200, ROSTERS);
    if (method === 'POST' && pathname === '/api/trades/analyze') return json(route, 200, ANALYSIS);
    if (method === 'POST' && pathname === '/api/trades') {
      return proposeRefusal ? json(route, 409, { error: proposeRefusal }) : json(route, 201, { id: 13 });
    }
    return route.fallback();
  });
}
