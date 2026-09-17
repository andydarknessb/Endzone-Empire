/**
 * Pure builders for the Decision card's `context` object (#1512, ADR 0040
 * follow-up). Each builder validates its own inputs and throws on a shape it
 * does not accept, producing `{ kind, ... }` - the ONLY thing the card reads
 * (`ui/PlayerDecisionCard.jsx`), start to finish: `open`, `onClose`, `entry`,
 * `leagueId`, `week` and `context` are its whole prop surface (#1515, T19).
 * Every field an availability, navigation or action fact needs rides inside
 * the builder's own object; there is no loose prop left for any of them to
 * ride beside `context` instead.
 *
 * `kind` matches CONTEXT.md's Availability states one-for-one - `my_team`,
 * `free_agent`, `waivers`, `rostered` - plus `draft` (#1313: the Draft room's
 * fifth context, not an Availability state) and `fromCard` (#1311, ADR 0040
 * ruling c: a caller with no Availability fact of its own, TransactionLog and
 * the public profile's "In your leagues" card, defers `kind` to the `/card`
 * payload - #1514 moved this off the earlier loose `contextFromCard` prop
 * onto `context.fromCard`, which `ui/PlayerDecisionCard.jsx` reads instead).
 *
 * `playerIds`/`onNavigate` (#1515, restated from the card's own prev/next
 * contract, f5): optional on every builder a caller that opens the card from
 * a LIST uses - `myTeam` (PlayerManagement's read-only own-player open),
 * `freeAgent`/`waivers`/`rostered` (PlayerManagement) and `waivers`
 * (WaiverWire) again, and `draft` (DraftBoard). Neither is required on any
 * builder: LineupPage's `myTeam({ managed: true })` and TradeCenter/
 * MatchupPage's `rostered(...)` open a single player with no list to page
 * through, exactly as before.
 *
 * `onActionDone` (#1515, spec #1494: "Acquire builders (Free agent, on
 * waivers) carry ... the action-done callback"): only `freeAgent` and
 * `waivers` carry it - the two contexts whose action bar (Add/Claim) reports
 * a completed action back to the caller. `myTeam` and `rostered` carry none;
 * the Watch toggle's own best-effort refresh hook (`WatchPlayerAction`'s
 * `onDone`) is simply unset there, never a seventh always-prop invented to
 * give it one.
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
 *
 * `playerIds`/`onNavigate` (#1515): PlayerManagement's read-only own-player
 * open still pages through the caller's own player list, exactly as its
 * `freeAgent`/`waivers`/`rostered` opens do - optional either way, and never
 * set by LineupPage's managed open (no list to page through there).
 */
export function myTeam({
  managed,
  onSwap,
  onRequestDrop,
  canDropEntry,
  entries,
  bestBall = false,
  leagueUnsettled = false,
  playerIds,
  onNavigate,
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
    playerIds,
    onNavigate,
  };
}

/**
 * The free-agent action-bar context: Add, with an inline drop pick once the
 * roster is at capacity (`AddPlayerAction`, `shared/lib`'s
 * `isRosterAtCapacity`/`sortRosterForDrop`).
 *
 * `onActionDone` (#1515, spec #1494): the acquire action bar's best-effort
 * refresh hook - `AddPlayerAction`'s `onAdded` and the Watch toggle's
 * `onDone` both read it. `playerIds`/`onNavigate`: PlayerManagement's own
 * prev/next over the page it opened the card from.
 */
export function freeAgent({ availability, roster, onActionDone, playerIds, onNavigate } = {}) {
  requirePlainObject(availability, 'freeAgent(...): availability');
  if (!Array.isArray(roster)) throw new Error('freeAgent(...): roster must be an array');
  return { kind: 'free_agent', availability, roster, onActionDone, playerIds, onNavigate };
}

/**
 * The waivers action-bar context: Claim, with a drop pick and, in a FAAB
 * league, a bid (`ClaimPlayerAction`).
 *
 * `onActionDone`/`playerIds`/`onNavigate` (#1515): the same trio `freeAgent`
 * carries, for the same reasons - PlayerManagement and WaiverWire both open
 * this context from a list and both refresh after a claim.
 */
export function waivers({ availability, roster, onActionDone, playerIds, onNavigate } = {}) {
  requirePlainObject(availability, 'waivers(...): availability');
  if (!Array.isArray(roster)) throw new Error('waivers(...): roster must be an array');
  return { kind: 'waivers', availability, roster, onActionDone, playerIds, onNavigate };
}

/**
 * The rostered-by-another-team context: a Propose-trade link and, when the
 * owning team's name is known, "Rostered by <team>".
 *
 * `playerIds`/`onNavigate` (#1515): PlayerManagement's own prev/next, unset
 * by TradeCenter/MatchupPage's single-player open. No `onActionDone` - the
 * spec's acquire-builder ruling doesn't cover this context (its only action,
 * Propose trade, is a real navigation, not a completed in-place action).
 */
export function rostered({ availability, playerIds, onNavigate } = {}) {
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
  return { kind: 'rostered', availability, playerIds, onNavigate };
}

/**
 * The Draft room's own context (#1313, ADR 0040 follow-up): Draft/Queue for
 * an undrafted pool player, or a "Drafted by" alert once one lands. Not an
 * Availability state, so never a `fromCard` target. `onQueue` is always
 * needed (the room always offers Queue); `onDraft` is needed only when
 * `canDraft` is true.
 *
 * `playerIds`/`onNavigate` (#1515): DraftBoard's own prev/next over the
 * available-players list, and the pool-rank tile's own index into it.
 */
export function draft({
  draftedBy = null,
  adp = null,
  canDraft = false,
  draftUnavailableReason = null,
  queued = false,
  onDraft,
  onQueue,
  playerIds,
  onNavigate,
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
    playerIds,
    onNavigate,
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
 *
 * `availability` (#1515, optional): a caller that HAS its own availability
 * fact for the eventual state but no roster fact to classify by up front -
 * the public profile's "In your leagues" line, whose own `/in-your-leagues`
 * payload already carries `rosterCount`/`waiverPriority`/`teamName` and so on
 * for whichever state the `/card` read settles on. TransactionLog has no such
 * fact and calls `fromCard()` with none, exactly as before.
 */
export function fromCard({ availability } = {}) {
  return { kind: null, fromCard: true, availability };
}
