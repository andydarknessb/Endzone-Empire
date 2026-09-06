// Fixture harness for the Game Center + Matchup Detail layout guard (#920).
//
// These two routes are not covered by the Draft-room harness, and this guard
// deliberately does NOT extend the Draft route table (draftRouteTable.js): the
// coverage guard walks only the Draft room's import closure, so registering
// here would buy nothing and make that table's stated contract untrue. It uses
// the base Playwright `test` for the same reason - the Draft harness's extended
// fixture asserts against the Draft REST installer and would pass vacuously on
// these pages.
//
// A single catch-all handler over `/api/**` fulfils the nine endpoints these
// two pages read and answers 500 `unexpected mocked request` on anything else,
// the convention tests/e2e/auth-offline.spec.ts established. The app's own test
// socket factory hook is installed on every load, so the score feed both pages
// subscribe to on mount never opens a real connection (the join event these
// pages emit is `league:join`, not the Draft room's `draft:join`).
import type { Page, Route } from '@playwright/test';
import { json } from './jsonRoute';

export const LEAGUE_ID = 4200;
export const MATCHUP_ID = 918;
export const USER_ID = 41;
export const VIEWER_TEAM_ID = 101;
const OPP_TEAM_ID = 102;

export const GAME_CENTER_URL = `/#/league/${LEAGUE_ID}/game-center`;
export const MATCHUP_URL = `/#/league/${LEAGUE_ID}/matchups/${MATCHUP_ID}`;

// The widest the h1, the LED board week cell and the season strip ever get.
export const CURRENT_WEEK = 18;

// Required fixture values, not niceties (#920): the strongest overflow
// candidates on Matchup Detail are team-name text guarded by `overflow: hidden`
// on `nowrap` text, so names must be long enough to spill if the guard were
// deleted - with "Ridge Runners" nothing spills even without the guard and the
// red-tells would be green for the wrong reason. Both are 30 characters; the
// long league name is what makes the Game Center title-column red-tell
// reachable.
const HOME_TEAM_NAME = 'Chattahoochee Valley Riverhogs'; // 30 chars (Matchup Detail only)
const AWAY_TEAM_NAME = 'Sasquatch of the Cascade Range'; // 30 chars (Matchup Detail only)
const LEAGUE_NAME = 'Greater Metropolitan Dynasty Fantasy League'; // 43 chars

// Game Center uses representative team names, NOT the 22+ char Matchup Detail
// ones. The 22+ char names are a Matchup Detail requirement (they make the LED
// board and scoreboard-strip clip red-tells reachable). Game Center threads a
// team name through the Scoring feed row's `nflTeam · teamName` line, whose
// NON-WRAPPING max-content inflates the rail's auto grid track; a 30-char name
// there overflows the 340px rail on a wide viewport, which is not a real-league
// state. The long LEAGUE name (breadcrumb) is what the Game Center title-column
// red-tell needs, and it is kept.
const GC_HOME_NAME = 'Riverhogs';
const GC_AWAY_NAME = 'Cascades';

// roster_slots in commissioner order (the slotOrder the entity pairs starters
// by); each side's starters carry matching slot keys, or the starters table
// stays empty forever and the readiness gate never opens.
const ROSTER_SLOTS = [
  { key: 'QB', count: 1 },
  { key: 'RB', count: 2 },
  { key: 'WR', count: 2 },
  { key: 'TE', count: 1 },
  { key: 'FLEX', count: 1 },
  { key: 'K', count: 1 },
  { key: 'DEF', count: 1 },
];

// The slot key for each starter row, expanded from the counts above.
const STARTER_SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'];

const HOME_STARTER_NAMES = [
  'Patrick Mahomes', 'Christian McCaffrey', 'Bijan Robinson',
  'Justin Jefferson', 'CeeDee Lamb', 'Sam LaPorta',
  'Amon-Ra St. Brown', 'Harrison Butker', 'San Francisco 49ers',
];
const AWAY_STARTER_NAMES = [
  'Josh Allen', 'Saquon Barkley', 'Jahmyr Gibbs',
  'Tyreek Hill', 'Ja\'Marr Chase', 'Travis Kelce',
  'Puka Nacua', 'Brandon Aubrey', 'Dallas Cowboys',
];

function startersFor(names: string[]) {
  return STARTER_SLOTS.map((slot, i) => ({
    id: 1000 + i + (names === AWAY_STARTER_NAMES ? 100 : 0),
    slot,
    name: names[i],
    position: slot === 'FLEX' ? 'RB' : slot,
    nfl_team: 'KC',
    points: 12.4 + i,
    projected: 11.8 + i,
    onBye: false,
    locked: true,
  }));
}

function benchFor(offset: number) {
  return Array.from({ length: 4 }).map((_, i) => ({
    id: 3000 + offset + i,
    slot: 'BENCH',
    name: `Bench Player ${offset + i}`,
    position: 'WR',
    nfl_team: 'KC',
    points: 3 + i,
  }));
}

// The league row: a falsy pick'em flag (or the fantasy-only gate paints a
// refusal card), best_ball false, current_week 18, and roster_slots as a
// non-empty key list in commissioner order.
const LEAGUE_ROW = {
  id: LEAGUE_ID,
  name: LEAGUE_NAME,
  season: 2026,
  current_week: CURRENT_WEEK,
  best_ball: false,
  pickem_only: false,
  roster_slots: ROSTER_SLOTS,
};

const TEAMS = [
  { teamId: VIEWER_TEAM_ID, teamName: HOME_TEAM_NAME },
  { teamId: OPP_TEAM_ID, teamName: AWAY_TEAM_NAME },
  { teamId: 103, teamName: 'Windy City Gridiron Goblins' },
  { teamId: 104, teamName: 'Emerald Coast Storm Chasers' },
  { teamId: 105, teamName: 'Kilimanjaro Ridge Wildebeests' },
  { teamId: 106, teamName: 'Patagonia Frostbite Penguins' },
];

// No sync instant: Game Center then renders NO sync line (syncLineText returns
// null), so the title column holds the h1 alone. This matches the condition the
// #921 jsdom case measured ("a week with no sync line"): a rendered sync line is
// wider than the h1's "CENTER" and would widen the title column, pushing the
// picker's first chevron clear of the h1 and hiding the title-column overflow
// the guard is meant to catch.
const SYNCED_AT: string | null = null;

// One list row (matchupFromListRow's snake_case shape). `played` is started, so
// every side's win-probability bar paints, and it carries the longest status
// chip label ("Awaiting final").
function listRow(id: number, week: number, homeId: number, homeName: string, awayId: number, awayName: string) {
  return {
    id,
    season: 2026,
    week,
    final: false,
    status: 'played',
    first_kickoff_at: null,
    synced_at: SYNCED_AT,
    home_team_id: homeId,
    home_team_name: homeName,
    home_score: 112.4,
    home_expected_final: 118.9,
    home_players_remaining: 2,
    away_team_id: awayId,
    away_team_name: awayName,
    away_score: 108.1,
    away_expected_final: 114.2,
    away_players_remaining: 3,
  };
}

// 18 weeks of matchup rows: the viewer's Matchup every week (so the hero always
// renders and a `Wk N` radio exists for every week), plus two extra Matchups in
// week 18 so the "League matchups" grid renders cards. The week segments are
// derived from this list, so a season claiming week 18 with no rows would
// render zero radios.
function matchupList() {
  const rows = [];
  for (let week = 1; week <= CURRENT_WEEK; week++) {
    rows.push(listRow(week, week, VIEWER_TEAM_ID, GC_HOME_NAME, OPP_TEAM_ID, GC_AWAY_NAME));
  }
  rows.push(listRow(500, CURRENT_WEEK, 103, TEAMS[2].teamName, 104, TEAMS[3].teamName));
  rows.push(listRow(501, CURRENT_WEEK, 105, TEAMS[4].teamName, 106, TEAMS[5].teamName));
  return rows;
}

// The detail body (matchupFromDetailBody's shape): one `played` Matchup at week
// 18, both sides with 22+ char names, starters carrying the league's slot keys
// and empty NFL game ids (so the Supabase path stays silent regardless of a
// developer's local environment).
function matchupDetail() {
  return {
    matchup: {
      id: MATCHUP_ID,
      season: 2026,
      week: CURRENT_WEEK,
      final: false,
      status: 'played',
      is_playoff: false,
      first_kickoff_at: null,
      synced_at: SYNCED_AT,
      home_score: 112.4,
      away_score: 108.1,
    },
    home: {
      teamId: VIEWER_TEAM_ID,
      name: HOME_TEAM_NAME,
      expectedFinal: 118.9,
      playersRemaining: 2,
      starters: startersFor(HOME_STARTER_NAMES),
      bench: benchFor(0),
    },
    away: {
      teamId: OPP_TEAM_ID,
      name: AWAY_TEAM_NAME,
      expectedFinal: 114.2,
      playersRemaining: 3,
      starters: startersFor(AWAY_STARTER_NAMES),
      bench: benchFor(50),
    },
    viewerTeamId: VIEWER_TEAM_ID,
    viewerWhatIf: null,
    nflGameIds: [],
  };
}

// League rosters, so the score feed's plays attribute to a fantasy Team (Game
// Center reads playerId -> team from here). Two rostered players per side of the
// viewer's Matchup, enough for the feed to render rows.
const ROSTER_PLAYER_IDS = { home: [2001, 2002], away: [2101, 2102] };
function rosters() {
  return [
    {
      teamId: VIEWER_TEAM_ID,
      teamName: GC_HOME_NAME,
      players: ROSTER_PLAYER_IDS.home.map((id, i) => ({ id, name: `Home Scorer ${i + 1}` })),
    },
    {
      teamId: OPP_TEAM_ID,
      teamName: GC_AWAY_NAME,
      players: ROSTER_PLAYER_IDS.away.map((id, i) => ({ id, name: `Away Scorer ${i + 1}` })),
    },
  ];
}

// The live plays the score feed delivers over the socket for week 18. A `played`
// week has plays, and a populated feed renders clipped rows (nowrap + ellipsis
// inside a min-width:0 column); an EMPTY feed instead renders one long idle
// sentence that sizes to its max-content and overflows the 340px rail, which is
// a fixture artifact of an empty feed, not the live state this guard measures.
const SCORE_PLAYS = [
  { playerId: 2001, name: 'Home Scorer 1', type: 'TD', nflTeam: 'KC', pointsDelta: 6 },
  { playerId: 2101, name: 'Away Scorer 1', type: 'FG', nflTeam: 'DAL', pointsDelta: 3 },
  { playerId: 2002, name: 'Home Scorer 2', type: 'TD', nflTeam: 'KC', pointsDelta: 6 },
  { playerId: 2102, name: 'Away Scorer 2', type: 'TD', nflTeam: 'DAL', pointsDelta: 6 },
];

// Standings, so a record and rank print under each Team name (part of the real
// rendered width).
function standings() {
  return {
    standings: TEAMS.map((t, i) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      rank: i + 1,
      wins: 10 - i,
      losses: i,
      ties: 0,
      pointsFor: 1500 - i * 20,
    })),
  };
}

/**
 * The one catch-all `/api/**` route. Answers the nine endpoints the two pages
 * read and 500s on anything unrecognised.
 */
async function fulfilApi(route: Route) {
  const request = route.request();
  const { pathname } = new URL(request.url());
  const method = request.method();

  if (method === 'GET' && pathname === '/api/user') {
    return json(route, 200, { id: USER_ID, username: 'layout-guard-viewer' });
  }
  if (method === 'GET' && pathname === '/api/notifications') {
    return json(route, 200, { notifications: [], unread: 0 });
  }
  if (method === 'GET' && pathname === '/api/notifications/prefs') {
    return json(route, 200, { prefs: {} });
  }
  if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}`) {
    return json(route, 200, { league: LEAGUE_ROW, teams: TEAMS, viewerTeamId: VIEWER_TEAM_ID });
  }
  if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}/matchups`) {
    return json(route, 200, matchupList());
  }
  if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}/matchups/${MATCHUP_ID}`) {
    return json(route, 200, matchupDetail());
  }
  if (method === 'GET' && pathname === `/api/league/${LEAGUE_ID}/rosters`) {
    return json(route, 200, rosters());
  }
  if (method === 'GET' && pathname === `/api/scoring/league/${LEAGUE_ID}/standings`) {
    return json(route, 200, standings());
  }
  if (method === 'GET' && pathname === '/api/team/hindsight') {
    return json(route, 200, { pointsLeftOnBench: 0 });
  }

  return json(route, 500, { error: `unexpected mocked request: ${method} ${pathname}` });
}

/**
 * The app's own test socket factory hook (`window.__ENDZONE_TEST_SOCKET_FACTORY__`,
 * see src/api/socket.js). Both pages create a score-feed socket on mount; with
 * no factory installed it opens a real connection to the page's own origin,
 * which the `/api/**` route does not intercept. The fake needs five members
 * only: `emit`, `on`, `disconnect`, and `io.on` / `io.off`.
 */
async function installSocketStub(page: Page) {
  await page.addInitScript((plays) => {
    (window as unknown as { __ENDZONE_TEST_SOCKET_FACTORY__: unknown }).__ENDZONE_TEST_SOCKET_FACTORY__ =
      () => {
        const handlers: Record<string, Array<(payload?: unknown) => void>> = {};
        const socket = {
          emit() {},
          on(event: string, cb: (payload?: unknown) => void) {
            (handlers[event] = handlers[event] || []).push(cb);
          },
          disconnect() {},
          io: { on() {}, off() {} },
        };
        // Deliver one score pass on the next tick, after the subscriber has
        // registered its `scores:updated` handler, so the Scoring feed renders
        // live rows for week 18 (scored is empty, so no scoreboard total moves).
        setTimeout(() => {
          (handlers['scores:updated'] || []).forEach((cb) => cb({ week: 18, scored: [], plays }));
        }, 0);
        return socket;
      };
  }, SCORE_PLAYS);
}

/**
 * The Scoreboard view is remembered per viewer in localStorage under a key that
 * carries the viewer id (`user:<id>`), with an `anon` fallback for before the
 * user id lands. The key changes mid-load when the user id arrives, so seeding
 * only one flips the view after first paint; seed BOTH.
 */
async function seedScoreboardView(page: Page) {
  await page.addInitScript((userId) => {
    try {
      localStorage.setItem('endzone.matchupView.anon', 'scoreboard');
      localStorage.setItem(`endzone.matchupView.user:${userId}`, 'scoreboard');
    } catch {
      // A browser blocking storage: the view falls back to Standard, and the
      // Scoreboard pass would then fail its readiness wait rather than measure
      // the wrong view silently.
    }
  }, USER_ID);
}

/**
 * Installs the API route and the socket stub on `page`. Pass `view: 'scoreboard'`
 * to also seed the Matchup view memory so Matchup Detail opens in the Scoreboard
 * view. Must be called before the first `page.goto`.
 */
export async function setupLayoutGuard(page: Page, { view }: { view?: 'standard' | 'scoreboard' } = {}) {
  await installSocketStub(page);
  if (view === 'scoreboard') await seedScoreboardView(page);
  await page.route('**/api/**', fulfilApi);
}
