// Fixture harness for the League Dashboard "Play-select" spec (#2330). It layers on the
// layout-guard harness (layoutGuardFixtures.ts: user, standings, draft grades, lineup,
// transactions, join requests, the score-feed socket stub) with one override route that
// owns what a dashboard state changes: the league row, the week's matchups, the viewer's
// action items and the pick'em / recap reads. Anything the override does not answer falls
// back to the guard's catch-all (which 500s `unexpected mocked request`).
// Six states mirror the boards in docs/design/league/. Times are offsets from `now`, so a
// state always reads the same way whenever it runs.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';
import { LEAGUE_ID, LEAGUE_ROW, TEAMS, setupLayoutGuard } from './layoutGuardFixtures';
import { routeWeek17Trophies } from './trophyCaseFixtures';

export const DASH_URL = `/#/league/${LEAGUE_ID}`;
export type DashState = 'inseason' | 'gamedayUrgent' | 'gamedaySet' | 'predraft' | 'complete' | 'pickemonly';
export type DashTheme = 'light' | 'dark';

/** The cursors and filled actions each state carries (the page's one lead play, or none). */
export const EXPECTED_CURSORS: Record<DashState, number> = {
  inseason: 1,
  gamedayUrgent: 1,
  gamedaySet: 0,
  predraft: 1,
  complete: 0,
  pickemonly: 1,
};

const VIEWER_TEAM_ID = 101;
const WEEK = 6;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (now: number, ms: number) => new Date(now + ms).toISOString();

// Twelve teams so the phone standings fold has something to fold: the viewer ranks sixth,
// two teams either side stay in view.
const EXTRA_TEAMS = [
  { teamId: 107, teamName: 'Tallahassee Swamp Gator Wranglers' },
  { teamId: 108, teamName: 'Saskatchewan Prairie Thunderchickens' },
  { teamId: 109, teamName: 'Appalachian Trail Mix Marauders' },
  { teamId: 110, teamName: 'Mississippi Delta Blues Brothers' },
  { teamId: 111, teamName: 'Northern Lights Aurora Borealis' },
  { teamId: 112, teamName: 'Rocky Mountain Oyster Bandits' },
];
export const DASH_TEAMS = [...TEAMS, ...EXTRA_TEAMS];

type DashTeam = { teamId: number; teamName: string };

/** Rank order with the viewer sixth. */
const rankedOf = (teams: DashTeam[]) => [
  ...teams.filter((t) => t.teamId !== VIEWER_TEAM_ID).slice(0, 5),
  teams.find((t) => t.teamId === VIEWER_TEAM_ID)!,
  ...teams.filter((t) => t.teamId !== VIEWER_TEAM_ID).slice(5),
];

function standingsBody(pregame: boolean, ranked: DashTeam[]) {
  return {
    standings: ranked.map((t, i) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      rank: i + 1,
      wins: pregame ? 0 : Math.max(0, 10 - i),
      losses: pregame ? 0 : Math.min(10, i),
      ties: 0,
      pf: pregame ? 0 : 1500 - i * 20,
      pa: pregame ? 0 : 1200 + i * 15,
    })),
  };
}

// The pick'em standings read (GET /api/pickem/league/:id/standings): rows in points order, the viewer's
// team id beside them. Two weeks played so the heat strip and the trend have something to draw.
function pickemStandingsBody(ranked: DashTeam[]) {
  return {
    viewerTeamId: VIEWER_TEAM_ID,
    standings: ranked.map((t, i) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      rank: i + 1,
      previousRank: i + 1,
      points: 90 - i * 4,
      correct: 60 - i * 3,
      incorrect: 12 + i * 2,
      weekly: { [WEEK - 2]: 40 - i, [WEEK - 1]: 50 - i * 2 },
    })),
  };
}

// The league recap (GET /api/scoring/league/:id/recap): one generated narrative and four fact rows.
function recapBody(now: number, teams: DashTeam[]) {
  const nameOf = (id: number) => teams.find((t) => t.teamId === id)!.teamName;
  return {
    season: 2026,
    week: WEEK - 1,
    data: {
      generatedAt: at(now, -20 * HOUR),
      narrative: [
        `${nameOf(VIEWER_TEAM_ID)} rode a 41 point Sunday from the flex spot to take the week by 16, and ${nameOf(102)}`,
        `left a starting lineup of questionable players in a bad spot all afternoon. ${nameOf(105)} won the week 142 to 139.`,
      ].join(' '),
      facts: {
        highestScorer: { team: nameOf(106), points: 142.6 },
        benchBlunder: { team: nameOf(102), pointsLeftOnBench: 31.4 },
        waiverSteal: { player: 'Jordan Addison', team: nameOf(VIEWER_TEAM_ID), points: 24.1 },
        closestMatchup: { home: nameOf(103), away: nameOf(104), margin: 0.8 },
      },
    },
  };
}

function leagueRow(state: DashState) {
  const base = {
    ...LEAGUE_ROW,
    current_week: WEEK,
    draft_status: 'complete',
    season_status: 'regular',
    invite_code: 'abc123',
    is_commissioner: true,
  };
  if (state === 'predraft') return { ...base, draft_status: 'pending', current_week: 1 };
  if (state === 'complete') return { ...base, season_status: 'complete', current_week: 18, is_commissioner: false };
  if (state === 'pickemonly') return { ...base, pickem_only: true, draft_status: 'pending', is_commissioner: false };
  if (state === 'gamedaySet') return { ...base, is_commissioner: false };
  return base;
}

// One list row in matchupFromListRow's snake_case shape.
function matchupRow(
  id: number,
  homeId: number,
  awayId: number,
  status: 'scheduled' | 'live' | 'final',
  week = WEEK,
  teams = DASH_TEAMS,
) {
  const started = status !== 'scheduled';
  const names = (teamId: number) => teams.find((t) => t.teamId === teamId)!.teamName;
  return {
    id,
    season: 2026,
    week,
    final: status === 'final',
    status,
    first_kickoff_at: null,
    synced_at: null,
    home_team_id: homeId,
    home_team_name: names(homeId),
    home_score: started ? 87.4 : null,
    home_expected_final: 118.6,
    home_players_remaining: status === 'final' ? 0 : 4,
    away_team_id: awayId,
    away_team_name: names(awayId),
    away_score: started ? 71.2 : null,
    away_expected_final: 104.1,
    away_players_remaining: status === 'final' ? 0 : 2,
  };
}

function matchupsBody(state: DashState, teams = DASH_TEAMS) {
  const status = state === 'gamedayUrgent' || state === 'gamedaySet' ? 'live' : state === 'complete' ? 'final' : 'scheduled';
  const week = state === 'complete' ? 18 : WEEK;
  return [
    matchupRow(918, VIEWER_TEAM_ID, 102, status, week, teams),
    matchupRow(919, 103, 104, status, week, teams),
    matchupRow(920, 105, 106, status, week, teams),
    matchupRow(921, 107, 108, status, week, teams),
    matchupRow(922, 109, 110, status, week, teams),
    matchupRow(923, 111, 112, status, week, teams),
  ];
}

const item = (o: Record<string, unknown>) => ({ detail: null, deadlineAt: null, progress: null, ...o });

function itemsFor(state: DashState, now: number) {
  const L = LEAGUE_ID;
  const name = LEAGUE_ROW.name;
  if (state === 'inseason') {
    return [
      item({
        id: `lineup_problem:${L}:2026-${WEEK}`, type: 'lineup_problem', leagueId: L, leagueName: name,
        title: '1 starter is out', detail: 'Puka Nacua (WR) is Out and still in your lineup.', severity: 'timed',
        deadlineAt: at(now, 26 * HOUR), cta: { label: 'Fix lineup', to: `/league/${L}/lineup` },
      }),
      item({
        id: `picks_open:${L}:2026-${WEEK}`, type: 'picks_open', leagueId: L, leagueName: name,
        title: '14 picks still open', detail: `0 of 14 made for week ${WEEK}`, severity: 'timed',
        deadlineAt: at(now, 26 * HOUR), cta: { label: 'Make picks', to: `/league/${L}/pickem` },
        progress: { done: 0, total: 14, open: 14 },
      }),
    ];
  }
  if (state === 'gamedayUrgent') {
    return [
      item({
        id: `lineup_problem:${L}:2026-${WEEK}`, type: 'lineup_problem', leagueId: L, leagueName: name,
        title: '1 starter is out', detail: 'Puka Nacua (WR) is Out and still in your lineup.', severity: 'timed',
        deadlineAt: at(now, 45 * MIN), cta: { label: 'Fix lineup', to: `/league/${L}/lineup` },
      }),
    ];
  }
  if (state === 'predraft') {
    return [
      item({
        // A join request is sideline, never a Play; an unfilled league before its draft is.
        id: `seats_open:${L}`, type: 'seats_open', leagueId: L, leagueName: name,
        title: 'Fill the open seats', detail: '2 seats left', severity: 'timed',
        deadlineAt: at(now, 3 * 24 * HOUR), cta: { label: 'Invite managers', to: `/league/${L}/commissioner` },
      }),
    ];
  }
  if (state === 'pickemonly') {
    return [
      item({
        id: `picks_open:${L}:2026-${WEEK}`, type: 'picks_open', leagueId: L, leagueName: name,
        title: '14 picks still open', detail: `0 of 14 made for week ${WEEK}`, severity: 'timed',
        deadlineAt: at(now, 26 * HOUR), cta: { label: 'Make picks', to: `/league/${L}/pickem` },
        progress: { done: 0, total: 14, open: 14 },
      }),
    ];
  }
  return [];
}

export type DashHarness = { items: () => Record<string, unknown>[] };

/**
 * Install the guard harness plus the override for one dashboard state, and (optionally) the
 * stored theme. Call before page.goto.
 */
export async function setupDashboard(
  page: Page,
  state: DashState,
  opts: { theme?: DashTheme; now?: number; teamNames?: Record<number, string> } = {},
): Promise<DashHarness> {
  const now = opts.now ?? Date.now();
  // A per-call copy: DASH_TEAMS is shared by every test in the worker.
  const teams = DASH_TEAMS.map((t) => ({ ...t, teamName: opts.teamNames?.[t.teamId] ?? t.teamName }));
  const ranked = rankedOf(teams);
  if (opts.theme) {
    await page.addInitScript((theme) => {
      try { window.localStorage.setItem('endzone_theme', theme); } catch { /* storage blocked: the app falls back to its default */ }
    }, opts.theme);
  }
  await setupLayoutGuard(page);
  await routeWeek17Trophies(page, 12);

  const items = itemsFor(state, now);
  const pregame = state === 'predraft' || state === 'pickemonly';
  const pickemOn = state === 'inseason' || state === 'pickemonly' || state === 'gamedayUrgent';
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    // The chat drawer marks the league read on open (a POST).
    if (request.method() === 'POST' && pathname === `/api/league/${LEAGUE_ID}/chat/read`) return json(route, 200, {});
    if (request.method() !== 'GET') return route.fallback();
    if (pathname === `/api/league/${LEAGUE_ID}`) {
      return json(route, 200, { league: leagueRow(state), teams, viewerTeamId: VIEWER_TEAM_ID });
    }
    if (pathname === `/api/league/${LEAGUE_ID}/matchups`) return json(route, 200, matchupsBody(state, teams));
    if (pathname === `/api/scoring/league/${LEAGUE_ID}/standings`) return json(route, 200, standingsBody(pregame, ranked));
    if (pathname === '/api/user/action-items') {
      const counted = items.filter((i) => i.severity !== 'info');
      return json(route, 200, { generatedAt: at(now, 0), counts: { total: counted.length, dueToday: 0 }, partial: [], items });
    }
    if (pathname === `/api/scoring/league/${LEAGUE_ID}/recap`) {
      return state === 'predraft' || state === 'pickemonly' ? json(route, 404, { error: 'no recap yet' }) : json(route, 200, recapBody(now, teams));
    }
    if (pathname === `/api/scoring/league/${LEAGUE_ID}/power-rankings`) {
      const rankings = ranked.map((t, i) => ({ teamId: t.teamId, name: t.teamName, rank: i + 1 }));
      return json(route, 200, { season: 2026, week: WEEK, viewerTeamId: VIEWER_TEAM_ID, data: { computedAt: at(now, -HOUR), rankings } });
    }
    if (pathname === '/api/team/lineup/advice') {
      return json(route, 200, {
        suggestions: [{
          slot: 'WR', gain: 23.04, verdict: 'start', current: { playerId: 1004, name: 'Puka Nacua' }, suggested: { playerId: 2004, name: 'Jordan Addison' },
        }],
        movePlan: [],
      });
    }
    if (pathname === `/api/league/${LEAGUE_ID}/chat`) return json(route, 200, []);
    if (pathname === `/api/league/${LEAGUE_ID}/chat/unread`) return json(route, 200, { unread: 0 });
    if (pathname === `/api/pickem/league/${LEAGUE_ID}/standings`) return json(route, 200, pickemStandingsBody(ranked));
    if (pathname === `/api/pickem/league/${LEAGUE_ID}/settings`) {
      return json(route, 200, pickemOn ? { enabled: true, mode: 'straight' } : { enabled: false });
    }
    return route.fallback();
  });
  return { items: () => items };
}
