'use strict';

/**
 * The Step-2 orchestration: turn a built cohort (`lib/cohort.buildCohort`)
 * plus per-member presence/value signals from the pinned outcome sources into
 * the reconciled OUTCOME TRUTH for one season-week - the `actualPointsByPlayerId`
 * map `run-backtest-mde.js`'s control-cell evaluator and `metrics.weekPairwise`
 * need to score regret and pairwise accuracy at all (preregistration 4.3).
 *
 * WHY THIS IS ITS OWN MODULE, NOT INLINE IN `cohort.js`
 *
 * `cohort.js` already carries the PRIMITIVE of this reconciliation -
 * `resolveOutcome` (one member's three-way decision) and `outcomeTally` (the
 * report rollup) - and exports them, but nothing calls them: turning a whole
 * cohort's worth of members into per-member `resolveOutcome` calls needs
 * per-member PRESENCE and VALUE signals from the pinned sources, and building
 * those signals is genuinely a different responsibility (reading rescored
 * numbers, matching a human player's row by identifier, matching a synthesized
 * DEF's stat line by team-week) from deciding what one member's numbers MEAN.
 * Keeping that assembly here, rather than growing `buildCohort` a second
 * dependency footprint, keeps `cohort.js` about MEMBERSHIP and this module
 * about OUTCOMES, mirroring the split the module already draws between "the
 * cohort" and "outcome truth" in its own docblock.
 *
 * THE PRIMARY/SECONDARY SOURCE JUDGMENT CALL (read this before changing either
 * caller)
 *
 * Preregistration 4.3 talks about "BOTH stat sources" and "present in one
 * source and not the other" generically, covering both human players and
 * synthesized DEF pseudo-players through the same `resolveOutcome` shape. The
 * two member KINDS do not actually have the same two sources available, and
 * this module's callers (`server/scripts/run-backtest-rosters.js`) resolve
 * that concretely as follows - this is the judgment call the roster-scripts'
 * docblock refers to, and it is recorded here because it changes what
 * `presentInPrimaryByPlayerId`/`presentInSecondaryByPlayerId` MEAN per member
 * kind, which a reader of this module needs to know before trusting a count:
 *
 *   - **Human players.** Exactly ONE pinned per-player external file exists
 *     (`stats_player_week_<season>.csv`). There is no second, independent
 *     per-player file to be "present in" or "absent from", so a human
 *     member's `presentInPrimary` and `presentInSecondary` are fed the SAME
 *     boolean - row exists for this `(season, week, gsisId)` - which makes
 *     `resolveOutcome`'s "present in one source and not the other" branch
 *     structurally unreachable for a human row. That is deliberate, not an
 *     oversight: it means "absent from BOTH stat sources" fires exactly when
 *     the row is genuinely absent (an ordinary zero-stat player-week, or a
 *     bye), instead of every non-recording rostered player being flagged
 *     ambiguous - which is what feeding a trivially-true second signal (team
 *     membership, roster presence) would have done. The AMBIGUITY channel
 *     that is real for a human row is `teamContradiction`: the stats file's
 *     own recorded team for that player-week disagrees with the cohort's
 *     roster-reconstructed team - a genuine, checkable data inconsistency.
 *   - **Synthesized DEF pseudo-players.** Two genuinely INDEPENDENT pinned
 *     sources exist and this module's caller uses them as such:
 *     `presentInPrimary` is "this team has a `stats_team_week_<season>.csv`
 *     row this week" and `presentInSecondary` is "this team has a completed
 *     REG game this week in the pinned `games.csv`". Both present is the
 *     ordinary case and is what `cohort.synthesizeDefenseStats` needs to
 *     build a scorable line; both absent is a bye (matches `member.onBye`);
 *     either alone is a genuine data inconsistency (a boxscore with no
 *     matching game, or a scheduled game nflverse has not yet published a
 *     team-week line for) and is excluded exactly like a human ambiguous row.
 *     A DEF has no `player_stats` database row at all (production stores DST
 *     lines under the same table, but this study's QA check is scoped to
 *     rescoring the pinned player-level sources against the DB PLAYER stat
 *     rows it already reads for priors) - `dbPointsByPlayerId` is simply never
 *     populated for a DEF playerId, so `resolveOutcome` reports `dbAgrees:
 *     null` ("unchecked"), never a false disagreement.
 *
 * SIGN-OFF. The human-side concretization above - one pinned file read as the
 * same presence boolean twice, with `teamContradiction` carrying the entire
 * human ambiguity channel, while DEF keeps its genuine two-source check - was
 * reviewed and explicitly ratified as-is by the study's owner. It is not a
 * placeholder pending a follow-up; a future reader who wants a second
 * per-player pinned source to make the human case symmetric with DEF should
 * treat that as a new preregistration decision, not a bug in this one.
 *
 * Pure: no database, no network, no filesystem, no clock. Every signal this
 * module reads is a Map/Set the caller already built from real bytes.
 */

const cohortLib = require('./cohort');
const { isFiniteNumber } = require('./numbers');

/**
 * Reconcile outcome truth for every member of one season-week's cohort.
 *
 * `pointsByPlayerId` carries the rescored external value for a member WHENEVER
 * any pinned source reported one - even for a member that will end up
 * "excluded", because the labelled sensitivity (prereg 4.3) needs whatever
 * number is actually available to put the row back, and `resolveOutcome`
 * itself needs an `externalPoints` value on the table even when only one of
 * the two presence flags is true (see its "present in one source and not the
 * other" test case). A member entirely absent from `pointsByPlayerId` reads as
 * `externalPoints: null`, which is exactly right for "absent from both" (an
 * actual `0`, `resolveOutcome` never even looks at the null) and for the
 * genuinely-unrecoverable half of an ambiguous row (nothing to put back even
 * in the sensitivity).
 *
 * `presentInPrimaryByPlayerId`/`presentInSecondaryByPlayerId` are REQUIRED,
 * with no default, for the same reason `buildCohort` refuses to default
 * `byeTeamKeys`/`statsGameTeamFor`/`defenseTeamKeys`: an empty Set is a
 * legitimate thing to mean (nothing this week is present in a source), but a
 * silently-defaulted one would make every member's absence look like a
 * genuine "absent from both" zero rather than an unmeasured caller bug.
 */
function resolveCohortOutcomes({
  season,
  week,
  members,
  pointsByPlayerId = new Map(),
  presentInPrimaryByPlayerId,
  presentInSecondaryByPlayerId,
  teamContradictionByPlayerId = new Set(),
  dbPointsByPlayerId = new Map(),
  label = 'outcome truth',
}) {
  const where = `${label} ${season}w${week}`;
  if (!Array.isArray(members)) {
    throw new Error(`${where}: members must be an array (cohort.buildCohort's members)`);
  }
  for (const [name, value] of [
    ['presentInPrimaryByPlayerId', presentInPrimaryByPlayerId],
    ['presentInSecondaryByPlayerId', presentInSecondaryByPlayerId],
  ]) {
    if (!(value instanceof Set)) {
      throw new Error(
        `${where}: ${name} must be a Set, with no default - omitting it would quietly change every `
        + 'member\'s presence to false rather than surface the caller bug, matching buildCohort\'s '
        + 'own required-signal discipline'
      );
    }
  }
  cohortLib.assertNotQuarantined(season, { label: where });

  const resolvedMembers = [];
  const actualPointsByPlayerId = new Map();
  const outcomes = [];
  const seen = new Set();

  for (const member of members) {
    if (seen.has(member.playerId)) {
      throw new Error(
        `${where}: player ${member.playerId} appears twice in the cohort's members - outcome truth `
        + 'needs exactly one row per player'
      );
    }
    seen.add(member.playerId);

    const externalPoints = pointsByPlayerId.has(member.playerId) ? pointsByPlayerId.get(member.playerId) : null;
    const dbPoints = dbPointsByPlayerId.has(member.playerId) ? dbPointsByPlayerId.get(member.playerId) : null;
    const outcome = cohortLib.resolveOutcome({
      externalPoints,
      presentInPrimary: presentInPrimaryByPlayerId.has(member.playerId),
      presentInSecondary: presentInSecondaryByPlayerId.has(member.playerId),
      teamContradiction: teamContradictionByPlayerId.has(member.playerId),
      dbPoints,
      label: `${where} player ${member.playerId}`,
    });
    outcomes.push(outcome);

    if (outcome.status === 'scored' || outcome.status === 'zero-recorded') {
      actualPointsByPlayerId.set(member.playerId, outcome.actual);
    }

    // Spread the ORIGINAL cohort member (not a hand-picked subset): callers
    // downstream (`controlCellEvaluator.rosterEntries`) need fields this
    // module has no reason to know about by name, `injuryStatus` chief among
    // them, and re-declaring every field here would be exactly the kind of
    // shape drift that breaks silently when `buildCohort` grows a new one.
    resolvedMembers.push({
      ...member,
      outcomeStatus: outcome.status,
      outcomeReason: outcome.reason,
      actualPoints: outcome.actual,
      // The labelled sensitivity (prereg 4.3) puts ambiguous rows back using
      // whatever pinned value was actually available - never a guessed one.
      // `null` means no source reported a usable number, so even the
      // sensitivity has nothing to re-include for this member.
      sensitivityPoints: outcome.status === 'excluded'
        ? (isFiniteNumber(externalPoints) ? Number(externalPoints) : null)
        : outcome.actual,
      dbAgrees: outcome.dbAgrees,
    });
  }

  return {
    season: Number(season),
    week: Number(week),
    members: resolvedMembers,
    actualPointsByPlayerId,
    counts: {
      members: resolvedMembers.length,
      outcomeTally: cohortLib.outcomeTally(outcomes),
    },
  };
}

module.exports = {
  resolveCohortOutcomes,
};
