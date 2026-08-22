// Deterministic data for the DraftBoard browser harness (issue #110). Every
// id, name and stat here is invented fixture data - nothing is read from a
// real league, the shared Supabase database, or a live NFL feed.

export type FixturePlayer = {
  id: number;
  name: string;
  position: string;
  nfl_team: string;
  adp: number | null;
  position_rank: number | null;
  projected_points: number | null;
  bye_week: number | null;
  injury_status?: string | null;
};

export type FixtureTeam = {
  id: number;
  name: string;
  owner: string;
  owner_id: number;
  draft_position: number;
};

export type FixturePick = {
  pick_number: number;
  team_id: number;
  player_id: number;
  name: string;
  position: string;
  nfl_team: string;
  is_keeper?: boolean;
};

export const FIXTURE_USER = { id: 501, username: 'harness-manager' };

export const FIXTURE_LEAGUE_ID = 4200;

export const FIXTURE_TEAMS: FixtureTeam[] = [
  { id: 1, name: 'Ridge Runners', owner: 'harness-manager', owner_id: 501, draft_position: 1 },
  { id: 2, name: 'Harbor Hawks', owner: 'harness-rival', owner_id: 502, draft_position: 2 },
];

// A small, deliberately mixed pool: enough spread across ADP/position rank/
// projection/bye week/injury status to exercise sorting, filtering, and
// hide-drafted without needing pagination.
export const FIXTURE_PLAYERS: FixturePlayer[] = [
  { id: 1, name: 'Bijan Robinson', position: 'RB', nfl_team: 'ATL', adp: 1.2, position_rank: 1, projected_points: 310.4, bye_week: 12 },
  { id: 2, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN', adp: 2.1, position_rank: 1, projected_points: 300.1, bye_week: 6 },
  { id: 3, name: 'Christian McCaffrey', position: 'RB', nfl_team: 'SF', adp: 1.5, position_rank: 2, projected_points: 305.0, bye_week: 9, injury_status: 'Q' },
  { id: 4, name: 'Patrick Mahomes', position: 'QB', nfl_team: 'KC', adp: 15.0, position_rank: 1, projected_points: 380.5, bye_week: 10 },
  { id: 5, name: 'Travis Kelce', position: 'TE', nfl_team: 'KC', adp: 20.2, position_rank: 1, projected_points: 210.0, bye_week: 10 },
  { id: 6, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF', adp: 10.0, position_rank: 2, projected_points: 375.0, bye_week: 7 },
  { id: 7, name: "Amon-Ra St. Brown", position: 'WR', nfl_team: 'DET', adp: 5.0, position_rank: 2, projected_points: 290.0, bye_week: 5 },
  { id: 8, name: "Ja'Marr Chase", position: 'WR', nfl_team: 'CIN', adp: 3.0, position_rank: 3, projected_points: 295.0, bye_week: 12 },
];

/** Josh Allen (id 6) is already off the board in the active/complete fixtures. */
export const ACTIVE_PICKS: FixturePick[] = [
  { pick_number: 1, team_id: 2, player_id: 6, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF' },
];

/** One pick per team per player, in draft order, for the completed fixture. */
export const COMPLETE_PICKS: FixturePick[] = FIXTURE_PLAYERS.map((player, index) => ({
  pick_number: index + 1,
  team_id: index % 2 === 0 ? FIXTURE_TEAMS[1].id : FIXTURE_TEAMS[0].id,
  player_id: player.id,
  name: player.name,
  position: player.position,
  nfl_team: player.nfl_team,
}));

type LeagueOverrides = Partial<{
  name: string;
  draft_status: 'pending' | 'active' | 'complete';
  draft_paused: boolean;
  pick_time_seconds: number;
  pick_deadline_at: string | null;
  owner_id: number;
  pickem_only: boolean;
  draft_date: string | null;
  draft_timezone: string | null;
}>;

export function buildLeague(overrides: LeagueOverrides = {}) {
  return {
    id: FIXTURE_LEAGUE_ID,
    name: 'Harness League',
    draft_status: 'pending',
    draft_paused: false,
    pick_time_seconds: 0,
    pick_deadline_at: null,
    owner_id: 999,
    pickem_only: false,
    draft_date: null,
    // Nullable (#116/#117): a legacy schedule with none confirmed displays
    // honestly as UTC rather than inferring one. See CONTEXT.md: Draft timezone.
    draft_timezone: null,
    ...overrides,
  };
}

export const PENDING_STATE = {
  league: buildLeague({ draft_status: 'pending' }),
  teams: FIXTURE_TEAMS.map((t) => ({ ...t, draft_ready: false })),
  picks: [] as FixturePick[],
  onTheClock: null,
};

export const ACTIVE_STATE = {
  league: buildLeague({ draft_status: 'active' }),
  teams: FIXTURE_TEAMS,
  picks: ACTIVE_PICKS,
  // Ridge Runners (the harness viewer's team, owner_id 501) is on the clock.
  onTheClock: FIXTURE_TEAMS[0],
};

export const COMPLETE_STATE = {
  league: buildLeague({ draft_status: 'complete' }),
  teams: FIXTURE_TEAMS,
  picks: COMPLETE_PICKS,
  onTheClock: null,
};
