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

// Team identity on the wire is teamId + teamName, camelCase, and a Team is
// the ONLY identity a league-shared payload carries (#113, contract #112).
// There is deliberately no owner/owner_id here: a fixture that still offered
// one would let a surface pass this harness while rendering an account.
export type FixtureTeam = {
  teamId: number;
  teamName: string;
  draft_position: number;
};

export type FixturePick = {
  pick_number: number;
  // A Pick names its own Team. Null is the real case of a manager who has
  // left the league: the server's join is LEFT so their Pick history
  // survives, and it reads back with no Team identity at all.
  teamId: number | null;
  teamName: string | null;
  player_id: number;
  name: string;
  position: string;
  nfl_team: string;
  is_keeper?: boolean;
};

// The account the harness browser is signed in as. It reaches /api/user and
// nothing else: which Team it holds in this league is answered by the
// draft:join acknowledgement's viewerTeamId, never by matching this id
// against a team's owner.
export const FIXTURE_USER = { id: 501, username: 'harness-manager' };

export const FIXTURE_LEAGUE_ID = 4200;

/** The Team the harness viewer holds, as the join acknowledgement answers it. */
export const VIEWER_TEAM_ID = 1;

export const FIXTURE_TEAMS: FixtureTeam[] = [
  { teamId: 1, teamName: 'Ridge Runners', draft_position: 1 },
  { teamId: 2, teamName: 'Harbor Hawks', draft_position: 2 },
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
  {
    pick_number: 1, teamId: 2, teamName: 'Harbor Hawks',
    player_id: 6, name: 'Josh Allen', position: 'QB', nfl_team: 'BUF',
  },
];

/** One pick per team per player, in draft order, for the completed fixture. */
export const COMPLETE_PICKS: FixturePick[] = FIXTURE_PLAYERS.map((player, index) => {
  const team = index % 2 === 0 ? FIXTURE_TEAMS[1] : FIXTURE_TEAMS[0];
  return {
    pick_number: index + 1,
    teamId: team.teamId,
    teamName: team.teamName,
    player_id: player.id,
    name: player.name,
    position: player.position,
    nfl_team: player.nfl_team,
  };
});

/**
 * A completed draft in which one Pick carries no Team identity. The contract
 * lets any LEFT-joined Team identity read back null; a Pick's cannot today,
 * since draft_picks.team_id is NOT NULL and cascades. This exists to pin what
 * the board renders for a null, not to claim the server can send one.
 */
export const COMPLETE_PICKS_WITH_NULL_TEAM: FixturePick[] = COMPLETE_PICKS.map((pick) =>
  (pick.pick_number === 1 ? { ...pick, teamId: null, teamName: null } : pick)
);

type LeagueOverrides = Partial<{
  name: string;
  draft_status: 'pending' | 'active' | 'complete';
  // snake: teams pick in turn on a clock. autopick: every pick is made by
  // autopick at once, no manual control ever exists. offline: the
  // commissioner records picks made elsewhere - see CONTEXT.md's Draft type
  // entry. auction has no live engine yet and is out of scope here.
  draft_type: 'snake' | 'autopick' | 'offline';
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
    draft_type: 'snake',
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
  // Ridge Runners (the harness viewer's Team, VIEWER_TEAM_ID) is on the clock.
  onTheClock: FIXTURE_TEAMS[0],
};

export const COMPLETE_STATE = {
  league: buildLeague({ draft_status: 'complete' }),
  teams: FIXTURE_TEAMS,
  picks: COMPLETE_PICKS,
  onTheClock: null,
};

// issue #120: pick-safety fixtures across draft type and turn ownership.
export const ACTIVE_NOT_MY_TURN_STATE = {
  league: buildLeague({ draft_status: 'active' }),
  teams: FIXTURE_TEAMS,
  picks: ACTIVE_PICKS,
  // Harbor Hawks, NOT the harness viewer's Team, is on the clock.
  onTheClock: FIXTURE_TEAMS[1],
};

export const ACTIVE_PAUSED_STATE = {
  league: buildLeague({ draft_status: 'active', draft_paused: true }),
  teams: FIXTURE_TEAMS,
  picks: ACTIVE_PICKS,
  onTheClock: FIXTURE_TEAMS[0],
};

export const ACTIVE_AUTOPICK_STATE = {
  league: buildLeague({ draft_status: 'active', draft_type: 'autopick' }),
  teams: FIXTURE_TEAMS,
  picks: ACTIVE_PICKS,
  // Nominally "on the clock" even so - autopick-type drafts are read-only
  // for every manager regardless of whose turn the rotation names.
  onTheClock: FIXTURE_TEAMS[0],
};

export const ACTIVE_OFFLINE_STATE = {
  league: buildLeague({ draft_status: 'active', draft_type: 'offline' }),
  teams: FIXTURE_TEAMS,
  picks: ACTIVE_PICKS,
  onTheClock: FIXTURE_TEAMS[0],
};
