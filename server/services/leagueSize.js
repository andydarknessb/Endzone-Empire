/**
 * Pure league-size-limit rules, shared by the league router and covered by
 * leagueSize.test.js. Keeping them here (rather than inline in the router)
 * makes the enforcement unit-testable without a database.
 *
 * Fantasy leagues are capped by the head-to-head schedule (2-20); pick'em-only
 * leagues have no schedule to balance, so they take a looser cap (2-50) and
 * default their floor to the hard minimum.
 */

const MIN_ALLOWED = 2; // hard floor; the UI recommends 4+
const MAX_ALLOWED = 20;
const DEFAULT_MIN = 8;
const PICKEM_MAX_ALLOWED = 50;
const PICKEM_DEFAULT_MIN = 2;

/** The max-teams cap in force for a league of the given kind. */
function maxAllowedFor(pickemOnly) {
  return pickemOnly ? PICKEM_MAX_ALLOWED : MAX_ALLOWED;
}

/** Default the minimum to a sensible value that never exceeds the cap. */
function resolveMinTeams(minTeams, maxTeams, { pickemOnly = false } = {}) {
  const defaultMin = pickemOnly ? PICKEM_DEFAULT_MIN : DEFAULT_MIN;
  return minTeams === undefined ? Math.min(defaultMin, maxTeams) : Number(minTeams);
}

const isValidCount = (n, maxAllowed) =>
  Number.isInteger(n) && n >= MIN_ALLOWED && n <= maxAllowed;

/**
 * Validate a full (min, max) pair at creation time.
 * Returns an error string, or null when valid.
 */
function createSizeError({ minTeams, maxTeams, pickemOnly = false }) {
  const maxAllowed = maxAllowedFor(pickemOnly);
  if (!isValidCount(maxTeams, maxAllowed)) {
    return `maxTeams must be an integer between ${MIN_ALLOWED} and ${maxAllowed}`;
  }
  if (!Number.isInteger(minTeams) || minTeams < MIN_ALLOWED || minTeams > maxTeams) {
    return 'minTeams must be an integer between 2 and maxTeams';
  }
  return null;
}

/**
 * Validate an edit to the limits against the league's current state. `newMin`
 * / `newMax` are null when not being changed. Returns an error string or null.
 */
function editSizeError({ newMin, newMax, currentMin, currentMax, teamCount, pickemOnly = false }) {
  const maxAllowed = maxAllowedFor(pickemOnly);
  if (newMax !== null && !isValidCount(newMax, maxAllowed)) {
    return `maxTeams must be an integer between ${MIN_ALLOWED} and ${maxAllowed}`;
  }
  if (newMin !== null && !isValidCount(newMin, maxAllowed)) {
    return `minTeams must be an integer between ${MIN_ALLOWED} and ${maxAllowed}`;
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
  PICKEM_MAX_ALLOWED,
  PICKEM_DEFAULT_MIN,
  maxAllowedFor,
  resolveMinTeams,
  createSizeError,
  editSizeError,
  meetsMinimum,
};
