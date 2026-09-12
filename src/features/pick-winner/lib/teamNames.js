/**
 * Team code -> full NFL team name (CONTEXT.md's Team code: the canonical
 * abbreviation). Static plumbing, no API call, scoped inside `pick-winner`
 * (#1265) rather than a shared lookup: nothing else in this ticket's write
 * set needs a team's full name, and `src/shared/lib` (the island's shared
 * non-presentational layer) is read-only here (#1272 holds its
 * promotions), so this stays local until a second feature needs it.
 *
 * Keyed exactly as `src/lib/nflTeamColors.js` is keyed (Team code, never a
 * raw spelling), so the two lookups never disagree on a team's identity.
 */
export const NFL_TEAM_NAMES = Object.freeze({
  ARI: 'Arizona Cardinals',
  ATL: 'Atlanta Falcons',
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',
  DET: 'Detroit Lions',
  GB: 'Green Bay Packers',
  HOU: 'Houston Texans',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs',
  LV: 'Las Vegas Raiders',
  LAC: 'Los Angeles Chargers',
  LAR: 'Los Angeles Rams',
  MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings',
  NE: 'New England Patriots',
  NO: 'New Orleans Saints',
  NYG: 'New York Giants',
  NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers',
  SF: 'San Francisco 49ers',
  SEA: 'Seattle Seahawks',
  TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',
  WAS: 'Washington Commanders',
});

/** The team's full name, or its own code for an unrecognized/missing one. */
export function getTeamName(code) {
  const key = String(code || '').toUpperCase();
  return NFL_TEAM_NAMES[key] || code || '';
}

export default getTeamName;
