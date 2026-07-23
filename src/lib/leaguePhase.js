export const LEAGUE_PHASE = Object.freeze({
  PRE_DRAFT: 'pre-draft',
  DRAFTING: 'drafting',
  IN_SEASON: 'in-season',
  PLAYOFFS: 'playoffs',
  COMPLETE: 'complete',
});

export function deriveLeaguePhase(league) {
  if (!league) return null;
  if (league.draft_status === 'pending') return LEAGUE_PHASE.PRE_DRAFT;
  if (league.draft_status === 'active') return LEAGUE_PHASE.DRAFTING;
  if (league.season_status === 'playoffs') return LEAGUE_PHASE.PLAYOFFS;
  if (league.season_status === 'complete') return LEAGUE_PHASE.COMPLETE;
  return LEAGUE_PHASE.IN_SEASON;
}

export const LEAGUE_PHASE_META = Object.freeze({
  [LEAGUE_PHASE.PRE_DRAFT]: { label: 'Pre-draft', color: 'default' },
  [LEAGUE_PHASE.DRAFTING]: { label: 'Draft live', color: 'warning' },
  [LEAGUE_PHASE.IN_SEASON]: { label: 'In season', color: 'success' },
  [LEAGUE_PHASE.PLAYOFFS]: { label: 'Playoffs', color: 'warning' },
  [LEAGUE_PHASE.COMPLETE]: { label: 'Complete', color: 'default' },
});

export function rosterActionForPhase(league) {
  const phase = deriveLeaguePhase(league);
  if (phase === LEAGUE_PHASE.PRE_DRAFT) {
    return { label: 'Draft not started', disabled: true, helper: 'Players are added through the Draft Room.' };
  }
  if (phase === LEAGUE_PHASE.DRAFTING) {
    return { label: 'Open Draft Room', disabled: true, helper: 'Draft picks must be made in the Draft Room.' };
  }
  if (phase === LEAGUE_PHASE.COMPLETE) {
    return { label: 'Season complete', disabled: true, helper: 'Roster moves are closed for this season.' };
  }
  return { label: 'Add free agent', disabled: false, helper: 'Add this available player immediately.' };
}
