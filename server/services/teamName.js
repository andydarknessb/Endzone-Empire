/**
 * Team-name validation (#111, parent #108): the same trimmed, 1-120
 * character rule on every join path (creating a league, an invite code, an
 * immediate public join, a filed and later approved join request), per
 * CONTEXT.md's Team identity entry. A blank or whitespace-only name is
 * refused here at the server boundary; the database repeats the non-blank
 * half of this rule as a CHECK constraint on `teams.name`
 * (20260822000002_require_team_names.js migration), so a write that somehow
 * bypasses this validator still cannot land an empty Team name.
 *
 * Duplicate Team names are never checked here or anywhere else: CONTEXT.md's
 * Team identity entry is explicit that a duplicate name is still valid
 * identity, never a reason to fall back to anything else.
 */

const TEAM_NAME_MIN = 1;
const TEAM_NAME_MAX = 120;

const TEAM_NAME_REQUIRED = 'Team name is required';
const TEAM_NAME_TOO_LONG = `Team name must be ${TEAM_NAME_MAX} characters or fewer`;

/**
 * Trim and validate a candidate Team name. Returns `{ value }` with the
 * trimmed name, or `{ error }` (400-worthy, no em-dash, safe to show a
 * manager as written).
 */
function validateTeamName(raw) {
  if (typeof raw !== 'string') return { error: TEAM_NAME_REQUIRED };
  const value = raw.trim();
  if (value.length < TEAM_NAME_MIN) return { error: TEAM_NAME_REQUIRED };
  if (value.length > TEAM_NAME_MAX) return { error: TEAM_NAME_TOO_LONG };
  return { value };
}

module.exports = {
  TEAM_NAME_MIN,
  TEAM_NAME_MAX,
  TEAM_NAME_REQUIRED,
  TEAM_NAME_TOO_LONG,
  validateTeamName,
};
