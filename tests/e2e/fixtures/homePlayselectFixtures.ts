// Fixture harness for the Home "Play-select" spec (#2315). Same catch-all-route
// shape as myLeaguesLayoutFixtures.ts: one handler answers every endpoint Home
// and the shell read and 500s `unexpected mocked request` on anything else.
// Four states mirror the boards in docs/design/home/ (build-main.js,
// build-gameday.js, build-draftnightphone.js, build-firstrun.js). Response
// shapes follow server/services/homeStatus.service.js (leagueStatuses,
// matchupSummary, actionItem builders). Times are offsets from `now`, so a
// state always reads the same way whenever it runs.
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

export const HOME_URL = '/#/user';
export type HomeState = 'main' | 'gameday' | 'draftnight' | 'firstrun';
export type HomeTheme = 'light' | 'dark';

const USER_ID = 61;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const TNR = 71;
const OFFICE = 72;
const PICKEM = 73;

type Json = Record<string, unknown>;
const at = (now: number, ms: number) => new Date(now + ms).toISOString();

type MatchupOpts = {
  status: 'scheduled' | 'live';
  my: Json;
  opp: Json;
  id: number;
  opponent: string;
  winProbability?: number | null;
};
const matchup = ({ status, my, opp, id, opponent, winProbability = null }: MatchupOpts) => ({
  id,
  status,
  opponent: { teamId: id + 1000, name: opponent },
  my,
  opp,
  winProbability,
});

const pickem = (now: number, made: number, total: number, lockMs: number | null) => ({
  made,
  total,
  missing: total - made,
  nextLockAt: lockMs === null ? null : at(now, lockMs),
});

const fantasyRow = (now: number, over: Json, status: Json) => ({
  my_team_id: 10,
  draft_status: 'complete',
  season_status: 'regular',
  current_season: 2026,
  current_week: 6,
  is_owner: true,
  is_commissioner: true,
  statusError: false,
  ...over,
  status: { phase: 'in-season', week: 6, ...status },
});

const tnrRow = (now: number, matchupBody: Json, pickemBody: Json, lineup: Json) => fantasyRow(
  now,
  { id: TNR, name: 'Thursday Night Regulars', my_team_name: 'Polk High Legends', team_count: 10, max_teams: 10 },
  {
    record: { wins: 4, losses: 1, ties: 0 },
    standing: { rank: 2, of: 10 },
    matchup: matchupBody,
    lineup,
    pickem: pickemBody,
  }
);

const officeRow = (now: number, matchupBody: Json, lineup: Json) => fantasyRow(
  now,
  { id: OFFICE, name: 'Office League', my_team_id: 20, my_team_name: 'Cubicle Crew', team_count: 12, max_teams: 12, is_owner: false, is_commissioner: false },
  { record: { wins: 2, losses: 3, ties: 0 }, standing: { rank: 8, of: 12 }, matchup: matchupBody, lineup }
);

const pickemRow = (now: number, pickemBody: Json) => ({
  id: PICKEM,
  name: "Sunday Pick'em",
  my_team_id: 50,
  my_team_name: 'Cubicle Crew',
  draft_status: 'pending',
  season_status: 'regular',
  current_season: 2026,
  current_week: 6,
  pickem_only: true,
  is_owner: false,
  is_commissioner: false,
  team_count: 12,
  max_teams: 12,
  statusError: false,
  status: {
    phase: 'in-season',
    week: 6,
    standing: { rank: 4, of: 12 },
    pickem: pickemBody,
  },
});

const actionItem = (o: Json) => ({ detail: null, deadlineAt: null, progress: null, ...o });
const picksOpen = (now: number, leagueId: number, leagueName: string, lockMs: number, week: number, total: number) => actionItem({
  id: `picks_open:${leagueId}:2026-${week}`,
  type: 'picks_open',
  leagueId,
  leagueName,
  title: `${total} picks still open`,
  detail: `0 of ${total} made for week ${week}`,
  severity: 'timed',
  deadlineAt: at(now, lockMs),
  cta: { label: 'Make picks', to: `/league/${leagueId}/pickem` },
  progress: { done: 0, total, open: total },
});

function itemsBody(now: number, items: Json[]) {
  const counted = items.filter((i) => i.severity !== 'info');
  return { generatedAt: at(now, 0), counts: { total: counted.length, dueToday: 0 }, partial: [], items };
}

const note = (id: number, message: string, leagueName: string, ago: number, now: number) => ({
  id, type: 'info', message, league_id: TNR, league_name: leagueName, created_at: at(now, -ago), read: false,
});

export type HomeBodies = { leagues: Json[]; items: Json; notifications: Json };

/** The three bodies Home reads for a state, with every time offset from `now`. */
export function homeBodies(state: HomeState, now: number, opts: { tnrScore?: number } = {}): HomeBodies {
  const empty = { leagues: [], items: itemsBody(now, []), notifications: { notifications: [], unread: 0 } };
  if (state === 'firstrun') return empty;

  if (state === 'main') {
    const lock = 26 * HOUR;
    const lineup = { emptySlots: [], problems: [], nextLockAt: at(now, lock) };
    const pk = pickem(now, 0, 14, lock);
    return {
      leagues: [
        tnrRow(now, matchup({
          status: 'scheduled', id: 912, opponent: 'Gridiron Ghosts', winProbability: 0.64,
          my: { score: null, expectedFinal: 105.9, playersRemaining: 9 },
          opp: { score: null, expectedFinal: 98.4, playersRemaining: 9 },
        }), pk, lineup),
        officeRow(now, matchup({
          status: 'scheduled', id: 913, opponent: 'Fourth and Long', winProbability: 0.46,
          my: { score: null, expectedFinal: 98.2, playersRemaining: 9 },
          opp: { score: null, expectedFinal: 101.5, playersRemaining: 9 },
        }), lineup),
        pickemRow(now, pk),
      ],
      items: itemsBody(now, [
        picksOpen(now, PICKEM, "Sunday Pick'em", lock, 6, 14),
        picksOpen(now, TNR, 'Thursday Night Regulars', lock, 6, 14),
        actionItem({
          id: `waiver_claims:${TNR}`,
          type: 'waiver_claims',
          leagueId: TNR,
          leagueName: 'Thursday Night Regulars',
          title: '1 waiver claim pending',
          detail: 'Claims process at their clear time',
          severity: 'info',
          deadlineAt: at(now, 30 * HOUR),
          cta: { label: 'View claims', to: `/league/${TNR}/waivers` },
        }),
      ]),
      notifications: {
        unread: 3,
        notifications: [
          note(1, 'Your waiver claim for Woody Marks went through.', 'Thursday Night Regulars', 2 * HOUR, now),
          note(2, 'A Week 5 stat correction changed 2 scores.', 'Thursday Night Regulars', 26 * HOUR, now),
          note(3, 'Gridiron Ghosts and Blitz Brigade made a trade.', 'Thursday Night Regulars', 50 * HOUR, now),
        ],
      },
    };
  }

  if (state === 'gameday') {
    const tnrScore = opts.tnrScore ?? 87.4;
    const lineup = { emptySlots: [], problems: [], nextLockAt: null };
    const officeLineup = { emptySlots: [], problems: ['Puka Nacua (WR) is Out'], nextLockAt: at(now, 42 * MIN) };
    return {
      leagues: [
        tnrRow(now, matchup({
          status: 'live', id: 912, opponent: 'Gridiron Ghosts', winProbability: 0.78,
          my: { score: tnrScore, expectedFinal: 118.6, playersRemaining: 4 },
          opp: { score: 71.2, expectedFinal: 104.1, playersRemaining: 2 },
        }), pickem(now, 13, 14, null), lineup),
        officeRow(now, matchup({
          status: 'live', id: 913, opponent: 'Fourth and Long', winProbability: 0.41,
          my: { score: 64.0, expectedFinal: 98.2, playersRemaining: 6 },
          opp: { score: 78.9, expectedFinal: 101.5, playersRemaining: 3 },
        }), officeLineup),
        pickemRow(now, pickem(now, 12, 14, null)),
      ],
      items: itemsBody(now, [
        actionItem({
          id: `lineup_problem:${OFFICE}:2026-6`,
          type: 'lineup_problem',
          leagueId: OFFICE,
          leagueName: 'Office League',
          title: '1 starter is out',
          detail: 'Puka Nacua (WR) is Out and still in your lineup.',
          severity: 'timed',
          deadlineAt: at(now, 42 * MIN),
          cta: { label: 'Fix lineup', to: `/league/${OFFICE}/lineup` },
        }),
      ]),
      notifications: { notifications: [], unread: 0 },
    };
  }

  // draftnight: Thursday Night Regulars is drafting; tonight's pick locks in 38 min in two leagues.
  const lock = 38 * MIN;
  return {
    leagues: [
      {
        id: TNR,
        name: 'Thursday Night Regulars',
        my_team_id: 10,
        my_team_name: 'Polk High Legends',
        draft_status: 'active',
        season_status: 'regular',
        current_season: 2026,
        current_week: 1,
        draft_date: at(now, -10 * MIN),
        is_owner: true,
        is_commissioner: true,
        team_count: 10,
        max_teams: 10,
        statusError: false,
        status: {
          phase: 'drafting',
          pickem: pickem(now, 0, 16, lock),
          draft: { date: at(now, -10 * MIN), timezone: 'America/Chicago', seatsFilled: 10, maxTeams: 10 },
        },
      },
      {
        ...pickemRow(now, pickem(now, 0, 16, lock)),
        current_week: 1,
        status: { phase: 'in-season', week: 1, standing: { rank: 4, of: 12 }, pickem: pickem(now, 0, 16, lock) },
      },
    ],
    items: itemsBody(now, [
      picksOpen(now, PICKEM, "Sunday Pick'em", lock, 1, 16),
      picksOpen(now, TNR, 'Thursday Night Regulars', lock, 1, 16),
    ]),
    notifications: { notifications: [], unread: 0 },
  };
}

export type HomeHarness = {
  /** Counts of GET /api/league?include=status requests so far. */
  leagueRequests: () => number;
  /** Replace the leagues body the next /api/league request answers with. */
  setLeagues: (leagues: Json[]) => void;
};

/** Install the route table for one state and (optionally) the stored theme. Call before page.goto. */
export async function setupHome(page: Page, state: HomeState, opts: { theme?: HomeTheme; now?: number } = {}): Promise<HomeHarness> {
  const now = opts.now ?? Date.now();
  const bodies = homeBodies(state, now);
  let leagues = bodies.leagues;
  let leagueRequests = 0;
  if (opts.theme) {
    await page.addInitScript((theme) => {
      try { window.localStorage.setItem('endzone_theme', theme); } catch { /* storage blocked: the app falls back to its default */ }
    }, opts.theme);
  }

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (method === 'GET') {
      if (pathname === '/api/user') return json(route, 200, { id: USER_ID, username: 'andy1234' });
      if (pathname === '/api/league') { leagueRequests += 1; return json(route, 200, leagues); }
      if (pathname === '/api/user/action-items') return json(route, 200, bodies.items);
      if (pathname === '/api/notifications') return json(route, 200, bodies.notifications);
      if (pathname === '/api/notifications/prefs') return json(route, 200, { prefs: {} });
      if (pathname === '/api/user/postgame-cutscenes') return json(route, 200, { cutscenes: [] });
      if (pathname === '/api/draft/mine') return json(route, 200, []);
    }
    return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
  });

  return { leagueRequests: () => leagueRequests, setLeagues: (next) => { leagues = next; } };
}
