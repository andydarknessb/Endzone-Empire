// Route-mocked fixture for the wave 3 Lineup spec (ADR 0067, spec #2347; tests/e2e/league-wave3-lineup.spec.ts). It
// serves the reads the Lineup page makes (`/#/team?leagueId=7`) the way fixtures/lineupLedgerFixtures.ts does (one
// catch-all over `/api/**`, 500 on anything unmocked) with the boards' fixture: Thursday Night Regulars, Week 7,
// Darkness Falls, Sunday morning. Two moments:
//
//  - 'pre' (Sun 9:10 AM): every game is still to come. WR 1 holds Puka Nacua, ruled Out, so the cursor sits on him;
//    FLEX is empty and the Forecast has a two-move plan (Addison in for Nacua, Spears into FLEX), so Apply is the one
//    filled action.
//  - 'live' (Sun 2:40 PM): the early games are on (those entries carry the server's `locked` flag and live points),
//    FLEX is empty and every bench player is locked, Out or on bye, so no one can fill it: the cursor sits on FLEX
//    and carries the lineup note, there is no move plan and so no filled action. The next kickoff is 45 minutes away,
//    so the cursor frame is Danger.
//
// Realtime (`live_game_states`) is a stub host in e2e (playwright.e2e.config.js), and this fixture answers none of its
// reads, so the live moment is built from what the lineup wire itself carries: the entries' `locked` flag and kickoff,
// their live points, and the server's own pace Edge line ("90% of projection so far"). Live score and clock on the Game
// cell need a live row, which the one spec that checks them routes itself (rest/v1/live_game_states).
import type { Page } from '@playwright/test';
import { json } from './jsonRoute';

export const WAVE3_LEAGUE_ID = 7;
export const WAVE3_LINEUP_URL = `/#/team?leagueId=${WAVE3_LEAGUE_ID}`;
export type Moment = 'pre' | 'live';

const TEAM_ID = 70;
const OPP_ID = 71;
const WEEK = 7;
const HOUR = 60 * 60 * 1000;

const ROSTER_SLOTS = [
  { key: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

type Seed = {
  id: number;
  name: string;
  position: string;
  slot: string;
  team: string;
  opp: string | null;
  proj: number | null;
  wave: 'early' | 'late' | 'none';
  points?: number;
  injury?: 'Q' | 'O' | 'IR';
  unavailable?: 'out' | 'bye' | 'ir';
  bye?: number;
};

// FLEX is left empty on purpose. `wave` is the game window: early (Sun 12:00 PM), late (Sun 3:25 PM) or none (bye, IR).
const SEEDS: Seed[] = [
  { id: 101, name: 'Josh Allen', position: 'QB', slot: 'QB', team: 'BUF', opp: 'MIA', proj: 22.1, wave: 'early', points: 19.8 },
  { id: 102, name: 'Jahmyr Gibbs', position: 'RB', slot: 'RB', team: 'DET', opp: 'TB', proj: 19.6, wave: 'early', points: 16.9, bye: 8 },
  { id: 103, name: 'Woody Marks', position: 'RB', slot: 'RB', team: 'HOU', opp: 'SEA', proj: 11.8, wave: 'early', points: 9.1, injury: 'Q' },
  { id: 104, name: 'Puka Nacua', position: 'WR', slot: 'WR', team: 'LAR', opp: 'JAX', proj: null, wave: 'early', injury: 'O', unavailable: 'out', bye: 8 },
  { id: 105, name: "Ja'Marr Chase", position: 'WR', slot: 'WR', team: 'CIN', opp: 'NYJ', proj: 16.9, wave: 'early', points: 15.2 },
  { id: 106, name: 'Trey McBride', position: 'TE', slot: 'TE', team: 'ARI', opp: 'SF', proj: 8.9, wave: 'late', bye: 8 },
  { id: 107, name: 'Brandon Aubrey', position: 'K', slot: 'K', team: 'DAL', opp: 'DEN', proj: 8.1, wave: 'late' },
  { id: 108, name: 'Broncos', position: 'DEF', slot: 'DEF', team: 'DEN', opp: 'DAL', proj: 6.4, wave: 'late' },
  { id: 201, name: 'Tyjae Spears', position: 'RB', slot: 'BENCH', team: 'TEN', opp: 'IND', proj: 12.9, wave: 'early', points: 13.4 },
  { id: 202, name: 'Jordan Addison', position: 'WR', slot: 'BENCH', team: 'MIN', opp: 'PHI', proj: 10.1, wave: 'early', points: 9.2 },
  { id: 203, name: 'Dalton Kincaid', position: 'TE', slot: 'BENCH', team: 'BUF', opp: 'MIA', proj: 7.4, wave: 'early', points: 6.1 },
  { id: 204, name: 'Tank Bigsby', position: 'RB', slot: 'BENCH', team: 'JAX', opp: 'LAR', proj: 6.2, wave: 'early', points: 4.4, bye: 8 },
  { id: 205, name: 'Tyler Allgeier', position: 'RB', slot: 'BENCH', team: 'ATL', opp: 'CAR', proj: 5.8, wave: 'early', points: 7.2 },
  { id: 206, name: 'Chris Olave', position: 'WR', slot: 'BENCH', team: 'NO', opp: null, proj: null, wave: 'none', unavailable: 'bye' },
  { id: 301, name: 'Rome Odunze', position: 'WR', slot: 'IR', team: 'CHI', opp: null, proj: null, wave: 'none', injury: 'IR', unavailable: 'ir' },
];

const wireEntry = (seed: Seed, moment: Moment, now: number) => {
  const live = moment === 'live';
  // Live, the early window is on (kicked off 2h40m ago); the late one is 45 minutes away. Before kickoff both are ahead.
  const kickoff = seed.wave === 'early'
    ? new Date(now + (live ? -(2 * HOUR + 40 * 60 * 1000) : 3 * HOUR)).toISOString()
    : seed.wave === 'late'
      ? new Date(now + (live ? 45 * 60 * 1000 : 6 * HOUR + 15 * 60 * 1000)).toISOString()
      : null;
  const locked = live && seed.wave === 'early';
  return {
    id: seed.id,
    name: seed.name,
    position: seed.position,
    nfl_team: seed.team,
    slot: seed.slot,
    projected_points: seed.proj,
    projection: seed.proj,
    floor: seed.proj == null ? null : Math.max(0, seed.proj - 8),
    ceiling: seed.proj == null ? null : seed.proj + 9,
    actualPoints: live && locked && !seed.unavailable ? seed.points ?? null : null,
    injury_status: seed.injury ?? null,
    startVerdict: seed.unavailable
      ? { outcome: 'unavailable', reason: seed.unavailable, numberTrusted: true }
      : { outcome: 'recommendable', reason: null, numberTrusted: true },
    opponent: seed.opp,
    kickoff,
    game_key: kickoff ? `g-${seed.team}` : null,
    line: seed.opp ? { favoured: seed.team, spread: 3.5, total: 45.5 } : null,
    weather: seed.opp ? { indoor: true } : null,
    locked,
    onBye: false,
    bye_week: seed.bye ?? null,
    valid_stash: seed.slot === 'IR',
    edge: seed.injury === 'O'
      ? { kind: 'injury', text: 'out' }
      : seed.injury === 'Q'
        ? { kind: 'injury', text: 'questionable' }
        : live && locked && seed.points != null && seed.proj
          ? { kind: 'pace', text: `${Math.round((seed.points / seed.proj) * 100)}% of projection so far (${seed.points.toFixed(1)} of ${seed.proj.toFixed(1)} pts)` }
          : null,
  };
};

const lineupBody = (moment: Moment, now: number) => ({
  leagueId: WAVE3_LEAGUE_ID,
  teamId: TEAM_ID,
  season: 2026,
  week: WEEK,
  currentWeek: WEEK,
  rosterSlots: ROSTER_SLOTS,
  benchSlots: 6,
  irSlots: 1,
  entries: SEEDS.map((seed) => wireEntry(seed, moment, now)),
});

// The Forecast before kickoff: Addison in for Nacua (Out) and Spears into the empty FLEX. Live there is no move.
const adviceBody = (moment: Moment) => (moment === 'live'
  ? {
    season: 2026, week: WEEK, projectedTotal: 91.7, optimalTotal: 91.7, suggestions: [], openSlotFills: [], movePlan: [], pointsLeft: { total: 38.6, rank: 4, teams: 12 },
  }
  : {
    season: 2026,
    week: WEEK,
    projectedTotal: 70.8,
    optimalTotal: 93.8,
    pointsLeft: { total: 38.6, rank: 4, teams: 12 },
    overrideRecord: { hits: 3, misses: 2 },
    calledShotRecord: { hits: 2, resolved: 3, streak: 1 },
    suggestions: [{
      slot: 'WR',
      gain: 10.1,
      verdict: 'strong',
      probabilityBetter: 0.9,
      current: {
        playerId: 104, name: 'Puka Nacua', projection: 0, opponent: 'JAX', startVerdict: { outcome: 'unavailable', reason: 'out' }, distribution: { p10: 0, p90: 0 },
      },
      suggested: {
        playerId: 202, name: 'Jordan Addison', projection: 10.1, opponent: 'PHI', distribution: { p10: 3.2, p90: 19.4 },
      },
    }],
    openSlotFills: [{ playerId: 201, name: 'Tyjae Spears', slot: 'FLEX', projection: 12.9 }],
    movePlan: [
      { playerId: 104, fromSlot: 'WR', toSlot: 'BENCH' },
      { playerId: 202, fromSlot: 'BENCH', toSlot: 'WR' },
      { playerId: 201, fromSlot: 'BENCH', toSlot: 'FLEX' },
    ],
  });

const TEAMS = [
  { teamId: TEAM_ID, id: TEAM_ID, teamName: 'Darkness Falls', avatar_url: null, avatar_static_url: null },
  { teamId: OPP_ID, id: OPP_ID, teamName: 'Sunday Scaries', avatar_url: null, avatar_static_url: null },
];

const matchupRow = (moment: Moment) => ({
  id: 551,
  week: WEEK,
  season: 2026,
  final: false,
  status: moment === 'live' ? 'live' : 'scheduled',
  home_team_id: TEAM_ID,
  away_team_id: OPP_ID,
  home_score: moment === 'live' ? '61.0' : '0.0',
  away_score: moment === 'live' ? '58.9' : '0.0',
  home_expected_final: moment === 'live' ? '91.7' : '93.8',
  away_expected_final: moment === 'live' ? '99.6' : '98.6',
  home_players_remaining: moment === 'live' ? 7 : 8,
  away_players_remaining: moment === 'live' ? 9 : 9,
  first_kickoff_at: new Date(Date.now() + 3 * HOUR).toISOString(),
});

/** Seeds the session and mocks every read the Lineup page makes at one moment. */
export async function setupWave3Lineup(page: Page, moment: Moment, theme: 'light' | 'dark') {
  const now = Date.now();
  await page.addInitScript((t) => {
    localStorage.setItem('endzone_token', 'wave3-access-token');
    localStorage.setItem('endzone_refresh', 'wave3-refresh-token');
    try { window.localStorage.setItem('endzone_theme', t); } catch { /* storage blocked: the app falls back to its default */ }
  }, theme);
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      if (url.pathname === '/api/user') return json(route, 200, { id: 41, username: 'andy1234' });
      if (url.pathname === '/api/league') {
        return json(route, 200, [{
          id: WAVE3_LEAGUE_ID, name: 'Thursday Night Regulars', best_ball: false, draft_status: 'complete', my_team_id: TEAM_ID, my_team_name: 'Darkness Falls',
        }]);
      }
      if (url.pathname === `/api/league/${WAVE3_LEAGUE_ID}`) {
        return json(route, 200, {
          league: {
            id: WAVE3_LEAGUE_ID, name: 'Thursday Night Regulars', best_ball: false, current_week: WEEK, draft_status: 'complete', waiver_period_hours: 48,
          },
          teams: TEAMS,
          viewerTeamId: TEAM_ID,
        });
      }
      if (url.pathname === `/api/league/${WAVE3_LEAGUE_ID}/matchups`) return json(route, 200, [matchupRow(moment)]);
      if (url.pathname === '/api/team/lineup') return json(route, 200, lineupBody(moment, now));
      if (url.pathname === '/api/team/lineup/advice') return json(route, 200, adviceBody(moment));
      if (url.pathname === '/api/waivers') {
        return json(route, 200, {
          league: { waiver_type: 'faab', waivers_clear_at: new Date(now + 3 * 24 * HOUR).toISOString() }, myTeam: { id: TEAM_ID }, onWaivers: [], myClaims: [],
        });
      }
      if (url.pathname === '/api/team/roster') return json(route, 200, []);
    }
    return json(route, 500, { error: `unexpected mocked request: ${request.method()} ${url.pathname}` });
  });
}
