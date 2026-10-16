// Fixture harness for the Pick'em wave 2 spec (#2334, ADR 0067). It layers on the layout-guard
// harness (layoutGuardFixtures.ts: user, league row, teams, the socket stub) with one override route
// that owns the Pick'em reads and the save: a route-mocked week 7 in the state of the approved boards
// (docs/design/league/Pickem.dc.html), Sunday 2:40 PM CDT: the Sunday Early games are live, Thursday
// is final, the 3:25 PM games lock in 45 minutes. The page clock is fixed at that instant so the
// kickoff windows, the lock words and the cursor read the same whenever the spec runs.
//
// The route is a small fake server: a PUT of picks changes what the next week GET returns, the way
// the real one does, and `picks` / `puts` expose the state to the spec.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import { LEAGUE_ID, LEAGUE_ROW, TEAMS, setupLayoutGuard } from './layoutGuardFixtures';

export const PICKEM_URL = `/#/league/${LEAGUE_ID}/pickem`;
export const STANDINGS_URL = `${PICKEM_URL}?tab=standings`;
export type PickemTheme = 'light' | 'dark';

// Sunday Oct 18 2026, 2:40 PM CDT.
export const NOW = Date.parse('2026-10-18T19:40:00Z');
const VIEWER_TEAM_ID = 101;
const WEEK = 7;

const TNF = '2026-10-16T00:15:00Z'; // Thu 8:15 PM ET
const EARLY = '2026-10-18T17:00:00Z'; // Sun 1:00 PM ET
const LATE = '2026-10-18T20:25:00Z'; // Sun 4:25 PM ET, 45 minutes after NOW
const SNF = '2026-10-19T00:20:00Z';
const MNF = '2026-10-20T00:15:00Z';

type Wire = Record<string, unknown>;
const game = (key: string, kickoffAt: string, overrides: Wire = {}): Wire => {
  const [awayTeam, homeTeam] = key.split('|');
  return {
    gameKey: key,
    teams: [awayTeam, homeTeam],
    kickoffAt,
    homeTeam,
    awayTeam,
    status: 'scheduled',
    homeScore: null,
    awayScore: null,
    quarter: null,
    timeRemaining: null,
    locked: false,
    winner: null,
    isTie: false,
    pickedCount: 7,
    line: { spread: -3.5, total: 44.5 },
    weather: null,
    venue: null,
    broadcast: 'CBS',
    records: { home: '3-3', away: '4-2' },
    situation: null,
    linescores: null,
    headline: null,
    ...overrides,
  };
};
const live = (key: string): Wire => game(key, EARLY, {
  locked: true,
  status: 'in_progress',
  quarter: 'Q4',
  timeRemaining: '4:21',
  homeScore: 24,
  awayScore: 17,
  line: null,
  situation: { possession: key.split('|')[1], downDistance: '2nd & 10 at the 25', homeWinProbability: 0.62 },
});

const EARLY_KEYS = ['JAX|LAR', 'CIN|NYJ', 'ATL|CAR', 'TEN|IND', 'BUF|MIA', 'DET|TB', 'HOU|SEA', 'MIN|PHI'];
const slate = (): Wire[] => [
  game('CLE|PIT', TNF, {
    locked: true, status: 'final', homeScore: 20, awayScore: 10, winner: 'PIT', line: null, headline: 'Steelers close it out in Cleveland.',
  }),
  ...EARLY_KEYS.map(live),
  game('ARI|SF', LATE, { line: { spread: -6.5, total: 47.5 } }),
  game('DAL|DEN', LATE),
  game('KC|LV', LATE),
  game('CHI|GB', SNF),
  game('NYG|WAS', MNF),
];

type Pick = { gameKey: string; pickedTeam: string; confidence: number | null };
/** The board's nine: Thursday, five of the eight Sunday Early games, KC, GB and WAS. ARI|SF and DAL|DEN are open and unpicked. */
export const NINE: Pick[] = [
  ['CLE|PIT', 'PIT'], ['JAX|LAR', 'JAX'], ['CIN|NYJ', 'CIN'], ['ATL|CAR', 'ATL'], ['TEN|IND', 'TEN'], ['BUF|MIA', 'BUF'],
  ['KC|LV', 'KC'], ['CHI|GB', 'GB'], ['NYG|WAS', 'WAS'],
].map(([gameKey, pickedTeam]) => ({ gameKey, pickedTeam, confidence: null }));

const NAMES = [
  ...TEAMS.map((t) => t.teamName),
  'Tallahassee Swamp Gator Wranglers', 'Saskatchewan Prairie Thunderchickens', 'Appalachian Trail Mix Marauders',
  'Mississippi Delta Blues Brothers', 'Northern Lights Aurora Borealis', 'Rocky Mountain Oyster Bandits',
];
const TEAM_IDS = [...TEAMS.map((t) => t.teamId), 107, 108, 109, 110, 111, 112];

function standingsBody() {
  return {
    viewerTeamId: VIEWER_TEAM_ID,
    mode: 'straight',
    standings: NAMES.map((teamName, i) => ({
      teamId: TEAM_IDS[i],
      teamName,
      rank: i + 1,
      previousRank: i === 3 ? 5 : i + 1,
      points: 58 - i * 2,
      correct: 58 - i * 2,
      incorrect: 30 + i,
      pushes: 0,
      pending: 8 + (i % 4),
      made: 90,
      weekly: { 1: 9, 2: 10, 3: 7, 4: 10, 5: 7, 6: 8, 7: 1 },
    })),
  };
}

export type PickemHarness = {
  picks: () => Pick[];
  puts: () => { picks: Pick[] }[];
};

/**
 * Install the guard harness plus the Pick'em override and the fixed clock, and (optionally) the stored
 * theme. Call before page.goto.
 */
export async function setupPickem(
  page: Page,
  opts: { theme?: PickemTheme; mode?: 'straight' | 'confidence'; picks?: Pick[]; failPuts?: boolean } = {},
): Promise<PickemHarness> {
  const { theme, mode = 'straight', failPuts = false } = opts;
  let picks: Pick[] = [...(opts.picks ?? NINE)];
  const puts: { picks: Pick[] }[] = [];
  if (theme) {
    await page.addInitScript((value) => {
      try { window.localStorage.setItem('endzone_theme', value); } catch { /* storage blocked: the app falls back to its default */ }
    }, theme);
  }
  await page.clock.setFixedTime(NOW);
  await setupLayoutGuard(page);

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}`) {
      return json(route, 200, {
        league: { ...LEAGUE_ROW, current_week: WEEK, is_commissioner: false, name: 'Thursday Night Regulars' },
        teams: NAMES.map((teamName, i) => ({ teamId: TEAM_IDS[i], teamName })),
        viewerTeamId: VIEWER_TEAM_ID,
      });
    }
    if (method === 'GET' && pathname === `/api/pickem/league/${LEAGUE_ID}/settings`) {
      return json(route, 200, { enabled: true, mode, isCommissioner: false });
    }
    if (method === 'GET' && pathname === `/api/pickem/league/${LEAGUE_ID}/week/${WEEK}`) {
      return json(route, 200, {
        season: 2026, week: WEEK, mode, games: slate(), myPicks: picks, othersPicks: {},
      });
    }
    if (method === 'GET' && pathname === `/api/pickem/league/${LEAGUE_ID}/standings`) return json(route, 200, standingsBody());
    if (method === 'PUT' && pathname === `/api/pickem/league/${LEAGUE_ID}/week/${WEEK}/picks`) {
      const body = request.postDataJSON() as { picks: Pick[] };
      puts.push(body);
      if (failPuts) return json(route, 500, { error: 'boom' });
      for (const pick of body.picks) {
        picks = picks.filter((entry) => entry.gameKey !== pick.gameKey);
        if (pick.pickedTeam != null) picks.push({ ...pick, confidence: pick.confidence ?? null });
      }
      return json(route, 200, { saved: body.picks.length, cleared: [], myPicks: body.picks });
    }
    return route.fallback();
  });
  return { picks: () => picks, puts: () => puts };
}
