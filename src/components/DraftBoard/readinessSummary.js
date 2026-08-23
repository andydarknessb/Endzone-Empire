import { teamsInDraftOrder } from '../../lib/draftTurns';

/**
 * Readiness as one summary the panel can render without deciding anything
 * (issue #124 acceptance criteria 1-2).
 *
 * Readiness is which Teams have declared themselves ready for a pending draft,
 * counted against the Teams in the league, and a Team that has not declared is
 * **Not ready** (CONTEXT.md: Readiness). The word *holdout* is deliberately
 * absent from this module and from everything it produces: the glossary
 * reserves it for the Evaluation context's Holdout ledger, and the Readiness
 * entry names it on its own Avoid list.
 *
 * `total` is `teams.length` and deliberately NOT `league.max_teams`, which is
 * on the same league row and would be the easier thing to reach for. A Team
 * that has not joined has not declined to be ready: it is absent, not Not
 * ready, and it has no Team name to put in either list. With the configured
 * size as the denominator, a half-filled lobby where everyone present is ready
 * reads as 4 of 10, lands below half, and lists the ready Teams while implying
 * six Not ready ones that do not exist. That a league is not yet full is a
 * real and separate fact, and does not belong in this ratio.
 *
 * The rule this module exists for is the inversion. A twelve-team lobby with
 * two managers ready and one with ten ready need opposite lists: early on the
 * short, interesting group is who HAS declared, and late on it is who has not.
 * CONTEXT.md states it as "once most teams are ready that group, not the ready
 * one, is the exception worth naming". Expressed as a count comparison rather
 * than a percentage so it is exact at every league size - `readyCount * 2`
 * against `total` has no rounding, where `readyCount / total > 0.5` invites a
 * float comparison at exactly half.
 *
 * `percentReady` is for the progress bar's width alone. Nothing reads the
 * league's state off it, because 4 of 8 and 50 of 100 are the same number and
 * only one of them is a lobby.
 */

/** Which group of Teams, if any, the panel names beside the count. */
export const READINESS_LIST = {
  /** Below the halfway point: the ready Teams are the exception. */
  READY: 'ready',
  /** Past it: the Not ready Teams are. */
  NOT_READY: 'notReady',
  /** Full readiness, an empty league, or nobody ready at all: no list stands. */
  NONE: 'none',
};

/**
 * @param {Array} teams league Teams, each `{ teamId, teamName, draft_ready }`
 * @returns {{
 *   readyCount: number, total: number, percentReady: number,
 *   listKind: string, listedTeams: Array, listLabel: (string|null),
 * }}
 */
export function readinessSummaryFor(teams = []) {
  // Draft order, so the Readiness list and the Draft order list beneath it
  // read down the page the same way, and so a lobby whose draft_position is
  // still null (the normal pending state) has a stable order rather than
  // whatever order the last socket frame happened to carry.
  const ordered = teamsInDraftOrder(Array.isArray(teams) ? teams : []);
  const total = ordered.length;
  const ready = ordered.filter((team) => !!team.draft_ready);
  const notReady = ordered.filter((team) => !team.draft_ready);
  const readyCount = ready.length;

  const percentReady = total === 0 ? 0 : Math.round((readyCount / total) * 100);

  // At or below half, name the ready group; above it, name the Not ready one.
  const atOrBelowHalf = readyCount * 2 <= total;
  let listKind = atOrBelowHalf ? READINESS_LIST.READY : READINESS_LIST.NOT_READY;
  let listedTeams = atOrBelowHalf ? ready : notReady;

  // Full readiness ends the exception list outright, and a group that happens
  // to be empty (nobody ready yet) is the same situation arrived at from the
  // other side: a disclosure that promises names and opens on none is worse
  // than the count, which already says 0 of 12.
  if (listedTeams.length === 0) {
    listKind = READINESS_LIST.NONE;
    listedTeams = [];
  }

  const listLabel = listKind === READINESS_LIST.NONE
    ? null
    : `${listKind === READINESS_LIST.READY ? 'Ready' : 'Not ready'} managers (${listedTeams.length})`;

  return {
    readyCount, total, percentReady, listKind, listedTeams, listLabel,
  };
}

