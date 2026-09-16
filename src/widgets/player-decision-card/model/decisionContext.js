/**
 * Pure builders for the Decision card's `context` object (#1512, ADR 0040
 * follow-up). Each builder validates its own inputs and throws on a shape it
 * does not accept, producing `{ kind, ... }` - the card reads `context.kind`
 * for the branches it used to drive off the bare `context` string and prop
 * presence (`ui/PlayerDecisionCard.jsx`'s `effectiveContext`). When a caller
 * passes no context object at all, the card falls back to that older string/
 * prop-presence behaviour unchanged (AC2; the loose props these builders also
 * bundle - `onSwap`, `entries`, `bestBall`, and so on - stay honoured as
 * separate props on the card until a later ticket, T19, retires them).
 *
 * `kind` matches CONTEXT.md's Availability states one-for-one - `my_team`,
 * `free_agent`, `waivers`, `rostered` - plus `draft` (#1313: the Draft room's
 * fifth context, not an Availability state) and `fromCard` (#1311, ADR 0040
 * ruling c: a caller with no Availability fact of its own, TransactionLog and
 * the public profile's "In your leagues" card, defers `kind` to the `/card`
 * payload - #1514 moved this off the earlier loose `contextFromCard` prop
 * onto `context.fromCard`, which `ui/PlayerDecisionCard.jsx` reads instead).
 */

function requirePlainObject(value, label) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is required`);
  }
  return value;
}

/**
 * The your-team context (ADR 0037's card, ADR 0040's `my_team` state).
 * `managed` (required boolean) is `lineupManaged` on the card: true for a
 * real Lineup open, false for a read-only own-player open (PlayerManagement,
 * formal review round 1 finding f1) that renders no Bench/Start/Compare/
 * Trade/Drop bar at all. Only a managed context needs the lineup-management
 * handlers and the entries list; a read-only one carries none of them.
 */
export function myTeam({
  managed,
  onSwap,
  onRequestDrop,
  canDropEntry,
  entries,
  bestBall = false,
  leagueUnsettled = false,
} = {}) {
  if (typeof managed !== 'boolean') {
    throw new Error('myTeam(...): managed must be a boolean');
  }
  if (managed) {
    if (typeof onSwap !== 'function') throw new Error('myTeam({ managed: true }): onSwap is required');
    if (typeof onRequestDrop !== 'function') {
      throw new Error('myTeam({ managed: true }): onRequestDrop is required');
    }
    if (typeof canDropEntry !== 'function') {
      throw new Error('myTeam({ managed: true }): canDropEntry is required');
    }
    if (!Array.isArray(entries)) throw new Error('myTeam({ managed: true }): entries must be an array');
  }
  return {
    kind: 'my_team',
    managed,
    onSwap: managed ? onSwap : undefined,
    onRequestDrop: managed ? onRequestDrop : undefined,
    canDropEntry: managed ? canDropEntry : undefined,
    entries: managed ? entries : undefined,
    bestBall: Boolean(bestBall),
    leagueUnsettled: Boolean(leagueUnsettled),
  };
}

/**
 * The free-agent action-bar context: Add, with an inline drop pick once the
 * roster is at capacity (`AddPlayerAction`, `shared/lib`'s
 * `isRosterAtCapacity`/`sortRosterForDrop`).
 */
export function freeAgent({ availability, roster } = {}) {
  requirePlainObject(availability, 'freeAgent(...): availability');
  if (!Array.isArray(roster)) throw new Error('freeAgent(...): roster must be an array');
  return { kind: 'free_agent', availability, roster };
}

/**
 * The waivers action-bar context: Claim, with a drop pick and, in a FAAB
 * league, a bid (`ClaimPlayerAction`).
 */
export function waivers({ availability, roster } = {}) {
  requirePlainObject(availability, 'waivers(...): availability');
  if (!Array.isArray(roster)) throw new Error('waivers(...): roster must be an array');
  return { kind: 'waivers', availability, roster };
}

/**
 * The rostered-by-another-team context: a Propose-trade link and, when the
 * owning team's name is known, "Rostered by <team>".
 */
export function rostered({ availability } = {}) {
  requirePlainObject(availability, 'rostered(...): availability');
  // Formal review (f1): the card treats `teamName` as optional
  // (`PlayerDecisionCard.jsx`'s "Rostered by" line renders only when it is
  // set, and Propose trade either way), and the next caller to wire this,
  // PlayerManagement, already handles a missing one - a required teamName
  // would throw the day that caller lands. Only a PRESENT non-string value
  // is a rejected shape.
  if (availability.teamName != null && typeof availability.teamName !== 'string') {
    throw new Error('rostered(...): availability.teamName must be a string when present');
  }
  return { kind: 'rostered', availability };
}

/**
 * The Draft room's own context (#1313, ADR 0040 follow-up): Draft/Queue for
 * an undrafted pool player, or a "Drafted by" alert once one lands. Not an
 * Availability state, so never a `fromCard` target. `onQueue` is always
 * needed (the room always offers Queue); `onDraft` is needed only when
 * `canDraft` is true.
 */
export function draft({
  draftedBy = null,
  adp = null,
  canDraft = false,
  draftUnavailableReason = null,
  queued = false,
  onDraft,
  onQueue,
} = {}) {
  if (typeof onQueue !== 'function') throw new Error('draft(...): onQueue is required');
  if (canDraft && typeof onDraft !== 'function') {
    throw new Error('draft({ canDraft: true }): onDraft is required');
  }
  return {
    kind: 'draft',
    draftedBy,
    adp,
    canDraft: Boolean(canDraft),
    draftUnavailableReason,
    queued: Boolean(queued),
    onDraft,
    onQueue,
  };
}

/**
 * #1311, ADR 0040 ruling (c): a caller with no Availability fact of its own
 * (TransactionLog's activity segments carry only `{ playerId, name }`) defers
 * `kind` to the `/card` payload's own `availability.state` once it answers.
 * `kind: null` matches none of the card's context branches until then;
 * `ui/PlayerDecisionCard.jsx` reads the `fromCard` flag below (#1514 -
 * replacing the earlier loose `contextFromCard` prop, now retired) to know
 * to defer.
 */
export function fromCard() {
  return { kind: null, fromCard: true };
}
