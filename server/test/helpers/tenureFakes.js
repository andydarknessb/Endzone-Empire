/**
 * Fake-pool handlers for the two reads behind the score-of-record exclusion
 * and the `removeLineupEntries` spare (#228): the week's schedule, and the
 * tenure predicate over it.
 *
 * WHY THIS IS SHARED RATHER THAN COPIED INTO EACH SUITE. The predicate lives
 * in SQL, so a fake necessarily re-implements it, and a re-implementation
 * that drifts from the statement turns every suite using it into a test of
 * the fixture. One implementation, used everywhere, drifts once or not at all.
 *
 * WHY IT READS THE OPERATORS OUT OF THE SQL. A fake that dispatches on
 * statement text and answers from a canned array reports on WHICH HANDLER
 * MATCHED, not on what the code decided: mutate the predicate and a different
 * fake replies, so a red proves the routing changed and a green proves
 * nothing at all. That cost #190 a day and a retracted claim. Here the
 * comparison is lifted from the emitted statement and applied to real
 * timestamps, so flipping `<=` to `<` in production flips what these handlers
 * return, and the suite fails on behaviour.
 *
 * Test fakes do not run triggers (ADR 0006). Every tenure here exists because
 * a test seeded it, never because a `team_players` row implies one.
 */

/** A tenure row as the seeder writes it. `releasedAt` null means still open. */
const tenure = (teamId, playerId, acquiredAt, releasedAt = null) =>
  ({ teamId, playerId, acquiredAt, releasedAt });

/**
 * Was this tenure open across `kickoff`, judged by the operators the STATEMENT
 * UNDER TEST actually used rather than by the ones this file would prefer?
 */
function coversKickoff(row, kickoff, text) {
  const acquiredInclusive = /"acquired_at" <= /.test(text);
  const releasedStrict = /"released_at" > (?!=)/.test(text);
  const acquired = row.acquiredAt.getTime();
  const startedInTime = acquiredInclusive ? acquired <= kickoff : acquired < kickoff;
  if (!startedInTime) return false;
  if (row.releasedAt === null || row.releasedAt === undefined) return true;
  const released = row.releasedAt.getTime();
  return releasedStrict ? released > kickoff : released >= kickoff;
}

/**
 * @param schedule  { [nflTeam]: Date } - kickoffs for the week under test. A
 *                  team absent from it has NO game that week (a bye, or an
 *                  unsynced schedule), which is never a reason to exclude.
 * @param tenures   rows from `tenure()` above.
 * @param heldSince a Date, or null. When set, any (team, player) the
 *                  statement asks about for which `tenures` holds NO row is
 *                  treated as having one open tenure since that instant.
 *
 *                  This exists for the suites that predate #228 and are about
 *                  something else entirely - which lineup rows go when a
 *                  player leaves, whether an IR occupant scores - where every
 *                  fixture already assumed, without ever saying so, that the
 *                  player had been on the roster all along. Spelling that
 *                  assumption once here is honest; leaving those suites to
 *                  answer an unasked question with an empty set would silently
 *                  turn each of them into a test that everyone is excluded.
 *                  A suite testing the predicate ITSELF passes `tenures` and
 *                  leaves this null.
 */
function tenureHandlers({ schedule = {}, tenures = [], heldSince = null } = {}) {
  return [
    [/^SELECT "nfl_team", "kickoff_at" FROM "nfl_games"/, () => ({
      rows: Object.entries(schedule).map(([nfl_team, kickoff_at]) => ({ nfl_team, kickoff_at })),
    })],
    [/FROM "roster_tenures"/, (text, [teamId, playerIds, kickoffs]) => {
      const rows = [];
      playerIds.forEach((playerId, i) => {
        const kickoff = new Date(kickoffs[i]).getTime();
        const seeded = tenures.filter((row) => row.teamId === teamId && row.playerId === playerId);
        const applicable = seeded.length > 0 || heldSince === null
          ? seeded
          : [tenure(teamId, playerId, heldSince)];
        const covered = applicable.some((row) => coversKickoff(row, kickoff, text));
        if (!covered) rows.push({ player_id: playerId });
      });
      return { rows };
    }],
  ];
}

module.exports = { tenureHandlers, tenure };
