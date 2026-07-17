/**
 * Pure league-size-limit rules, shared by the league router and covered by
 * leagueSize.test.js. Keeping them here (rather than inline in the router)
 * makes the enforcement unit-testable without a database.
 */

const MIN_ALLOWED = 2; // hard floor; the UI recommends 4+
const MAX_ALLOWED = 20;
const DEFAULT_MIN = 8;

/** Default the minimum to a sensible value that never exceeds the cap. */
function resolveMinTeams(minTeams, maxTeams) {
  return minTeams === undefined ? Math.min(DEFAULT_MIN, maxTeams) : Number(minTeams);
}

const isValidCount = (n) => Number.isInteger(n) && n >= MIN_ALLOWED && n <= MAX_ALLOWED;

/**
 * Validate a full (min, max) pair at creation time.
 * Returns an error string, or null when valid.
 */
function createSizeError({ minTeams, maxTeams }) {
  if (!isValidCount(maxTeams)) return 'maxTeams must be an integer between 2 and 20';
  if (!Number.isInteger(minTeams) || minTeams < MIN_ALLOWED || minTeams > maxTeams) {
    return 'minTeams must be an integer between 2 and maxTeams';
  }
  return null;
}

/**
 * Validate an edit to the limits against the league's current state. `newMin`
 * / `newMax` are null when not being changed. Returns an error string or null.
 */
function editSizeError({ newMin, newMax, currentMin, currentMax, teamCount }) {
  if (newMax !== null && !isValidCount(newMax)) {
    return 'maxTeams must be an integer between 2 and 20';
  }
  if (newMin !== null && !isValidCount(newMin)) {
    return 'minTeams must be an integer between 2 and 20';
  }
  const effMax = newMax !== null ? newMax : currentMax;
  const effMin = newMin !== null ? newMin : currentMin;
  if (effMin > effMax) return 'minTeams cannot exceed maxTeams';
  if (effMax < teamCount) {
    return `maxTeams cannot be below the ${teamCount} team(s) already in the league`;
  }
  return null;
}

/** Whether a league has enough teams to start its draft. */
function meetsMinimum(teamCount, minTeams) {
  return teamCount >= minTeams;
}

module.exports = {
  MIN_ALLOWED,
  MAX_ALLOWED,
  DEFAULT_MIN,
  resolveMinTeams,
  createSizeError,
  editSizeError,
  meetsMinimum,
};
