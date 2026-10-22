import React, { useEffect, useCallback, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import {
  Alert,
  Box,
  Drawer,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import {
  PlayerAvatar, SegmentedControl, statLine,
} from '../../../shared/ui';
import {
  BODY_FONT, Frame, InjuryTag as PsInjuryTag, PixelArrow, PixelClose, PosTag, PsButton, Skel,
} from '../../../shared/ui/playselect';
import { MENU_PAPER } from '../../../shared/ui/playselect/CardControls';
import {
  DIM_LINE_SX, INK_LINE_SX, PS_STACK_SX, PsBio, PsDecisionStrip, PsLoadError, PsNewsList, PsRangeBar, PsSection, PsTable,
  PsWeeklyBars, RowBadge,
} from './playselectPieces';
import {
  formatKickoff,
  formatPoints,
  ordinal,
  hasNoHistory,
  projectionLabel,
  NO_PRACTICE_LABEL,
  BACKUP_LABEL,
  VOLATILITY_LABELS,
} from '../../../shared/lib';
import { locked, spent } from '../../../entities/roster';
import {
  usePlayerCard,
  lineContextFromResponse,
  usageFromResponse,
  opponentsFromResponse,
} from '../../../entities/player';
import { isEligibleMove } from '../../../features/lineup-write';
import { AddPlayerAction } from '../../../features/add-player';
import { ClaimPlayerAction } from '../../../features/claim-player';
import { WatchPlayerAction } from '../../../features/watch-player';
import { injuryTileView } from '../lib/injuryTile';
import { benchOptionsForSlot, movesToStart, startTargetSlots } from '../model/slotActions';

// Don't hijack arrow keys while the user is typing or roving a control -
// restated from `PlayerQuickView.jsx`'s identical guard (FSD: a widget
// duplicates a tiny pure helper rather than importing a legacy component).
//
// Second risk review (accessibility, round 1 fix delta): the bare
// PlayerQuickView guard let this card's own prev/next handler steal
// Left/Right from a FOCUSED, horizontally-scrollable region - specifically
// the weekly bars' own `tabIndex={0}` strip, whose arrow-key scrolling
// was the first risk round's fix for the identical keyboard-trap failure
// mode. A MUI `Select`'s combobox div needs the same exclusion the
// `<SELECT>` tag check already gives a plain HTML select.
//
// Formal review round 2, f10: a bare `scrollWidth > clientWidth` ALSO
// matches the `noWrap` title after the prev/next focus-management fix moves
// focus there - `noWrap` is `overflow: hidden` (MUI's Typography), so a
// long, truncated name reports `scrollWidth > clientWidth` despite nothing
// being scrollable, and the whole handler then goes dead on it (jsdom
// reports 0 for both widths, which is why no jsdom test caught this - a
// real-browser check is `tests/e2e/player-decision-card.spec.ts`'s job).
//
// Third risk review (round 3 nit): a computed-`overflow-x` check has its own
// trap - CSS Overflow 3 computes a `visible` axis to `auto` when its OTHER
// axis is non-`visible`, so the Drawer's own Paper (`overflowY: 'auto'`,
// `PaperProps` below) computes `overflow-x: auto` too despite never actually
// scrolling horizontally (the 390px e2e guard enforces that today, but
// nothing stops it drifting). An explicit opt-in mark, not CSS inference,
// is what makes a region "this ticket's own arrow-key scroll strip" rather
// than "happens to compute auto" - the weekly bars carry it, and nothing
// else does.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.getAttribute && el.getAttribute('role') === 'combobox') return true;
  if (el.dataset && el.dataset.arrowScrollRegion === 'true' && el.scrollWidth > el.clientWidth) return true;
  if (el.closest && el.closest('.MuiToggleButtonGroup-root')) return true;
  // Risk review (accessibility, #1358): the Season pick's SegmentedControl
  // (shared/ui) preventDefault()s ArrowLeft/Right/Up/Down to move its own
  // roving radio selection but never stops the keydown bubbling to window -
  // the same "focused composite widget with its own arrow-key semantics"
  // case the ToggleButtonGroup check above exists for, so a radiogroup gets
  // the identical exemption rather than a SegmentedControl-specific one.
  // The card's own tablist (ARIA tabs: Left/Right move the tab, never the player) is the same case.
  return !!(el.closest && el.closest('[role="radiogroup"], [role="tablist"]'));
}

/**
 * The Decision card (#1240, ADR 0037, CONTEXT.md's Decision card): the
 * player detail a manager opens from a Ledger row on Lineup - a right-hand
 * drawer on desktop, a bottom sheet on a phone (AC6). Fetches its own Line/
 * Weather/Usage/Opponent-rank context on open off the one card read
 * (`entities/player`'s `usePlayerCard`; ADR 0037: "the Decision card
 * fetches on open"); the row's own fields (name, position, slot, projection, Floor,
 * Ceiling, edge) it already holds from the page's lineup read, so those
 * paint immediately while the extras load in behind them (AC1).
 *
 * A pure presenter over the page's own interaction state, exactly like
 * `lineup-ledger` beside it: `onSwap` performs a slot move (the page's
 * `useLineupWrite().submit`), `onRequestDrop`/`canDropEntry` mirror the
 * props `LineupLedger` already forwards to `LedgerRow` for the SAME
 * `useDropPlayer` feature instance, so Drop's confirmation dialog and its
 * Undo toast (AC5) are the one the page already owns, never a second copy.
 * Trade is a real link to the existing trade flow (AC5); this widget builds
 * no trade UI of its own.
 *
 * Replaces `components/PlayerQuickView` on Lineup ONLY (pre-launch ruling 3
 * on the issue thread): the page swaps which dialog `LedgerRow`'s name link
 * opens, and `PlayerQuickView` itself is untouched - other surfaces still
 * render it.
 *
 * #1307 (ADR 0040) extends the SAME widget with `context`, derived by the
 * caller from the player's Availability (`free_agent | waivers | rostered |
 * my_team`; default `'my_team'` so every existing Lineup call site, which
 * never passes it, is untouched - "my_team is the card as shipped"). Only
 * `my_team` uses the `entries`/`onSwap`/`onRequestDrop`/`canDropEntry` bench-
 * management props above; the other three swap the header's Bench/Start/
 * Compare/Trade/Drop bar for the availability action bar (`add-player`,
 * `claim-player`, or a plain Propose-trade link for `rostered` - prefilling
 * Trade Center is a later slice, ADR 0040's Plan) and add the news list
 * (CONTEXT.md's News: every context but your own player). `availability`
 * and `roster` feed that action bar's copy and its drop-pick list; `entry`
 * for these three contexts is a lighter shape (no `slot`/`locked`/`spent` -
 * WaiverWire and PlayerManagement have no lineup to read those from).
 *
 * Every context also reads `entities/player`'s `usePlayerCard` (the
 * `GET /api/players/:id/card` payload, #1306/#1331) for the decision strip,
 * the eighteen-week bars, the game log and Bio - the fields ADR 0040 says
 * every context adds - and, since #1667, the Line, Weather, Usage and
 * Opponent rank the card's one read now carries too.
 *
 * Formal review round 1 (f1, blocker): `context === 'my_team'` is not proof
 * of a Lineup caller - PlayerManagement opens the card for the caller's own
 * player too (its Availability state IS `my_team`), with no lineup wiring
 * at all. `lineupManaged` (`context === 'my_team' && typeof onSwap ===
 * 'function'`) is the real gate: true only when a caller supplies the bench-
 * management props, so a my_team open with none of them renders a plain
 * "Open lineup" link instead of a Bench/Start bar with dead handlers and a
 * crash waiting in `isEligibleMove` (which assumes a lineup entry's own
 * `eligibleSlots`).
 *
 * `playerIds`/`onNavigate` (f5): prev/next over the caller's own opening
 * list, restated from `PlayerQuickView`'s identical contract so WaiverWire
 * and PlayerManagement lose nothing by switching to this card.
 *
 * #1311, ADR 0040 ruling (c): a caller that cannot derive `context` itself -
 * TransactionLog's activity segments carry only `{ playerId, name }`, no
 * roster fact to classify by - passes `context={fromCard()}` (`model/
 * decisionContext.js`, `{ kind: null, fromCard: true }`) instead of a kind of
 * its own (#1514 migrated this off the earlier loose `contextFromCard`
 * boolean prop; see the #1512 paragraph below). When `context.fromCard` is
 * true, the effective context is `card.availability.state` instead of
 * `context.kind`, so no action bar renders until the `/card` payload answers
 * - `effectiveContext` is `null` before that, matching none of the four
 * context branches below. The header's own display fields (team, headshot,
 * slot/position, injury) fall back to the SAME payload's `player` block
 * whenever `entry` doesn't carry them, so a minimal entry still paints a
 * real header once the card arrives.
 *
 * #1313 (ADR 0040's own follow-up, grill ruling Q32): a fifth context,
 * `draft`, for the Draft room's last surviving `PlayerQuickView` copy - not
 * an Availability state (the other four), so it is never a `fromCard`
 * target. Its action bar (`canDraft`/`draftUnavailableReason`/
 * `queued`/`onDraft`/`onQueue`) and its `draftedBy` line mirror the room's own
 * pool-row actions exactly (DraftBoard.jsx), and its `adp`/pool-rank tiles
 * (the latter from the SAME `playerIds` prev/next already reads, never a new
 * server ranking) are the "Best available" facts the room already has. No
 * new fetch: the one `/card` read every context makes is the whole of it, so
 * the Draft room's own cadence rule (ADR 0025: refetch `draft:state` on
 * reconnect, nothing else polls) is untouched.
 *
 * #1512: `context` also accepts an OBJECT, one of the six pure builders in
 * `model/decisionContext.js` (`myTeam`, `freeAgent`, `waivers`, `rostered`,
 * `draft`, `fromCard`) - Lineup is the first caller to build one
 * (`myTeam({ managed: true })`). `context.kind` is read in place of the bare
 * string every branch above already compares against; a caller that passes
 * no context object (the bare string, or nothing at all) is unchanged. The
 * other fields a builder bundles (`onSwap`, `entries`, `bestBall`, and so on)
 * stay separate loose props on this component until a later ticket (T19)
 * moves them under `context` for good - `fromCard` is the one builder with no
 * such fields to defer, so #1514 (below) reads its whole shape now.
 *
 * #1514: DraftBoard, TransactionLog and the public profile's "In your
 * leagues" card move onto their builders. DraftBoard passes `context={draft({
 * ... })}` alongside the SAME loose `draftedBy`/`adp`/`canDraft`/
 * `draftUnavailableReason`/`queued`/`onDraft`/`onQueue` props it always
 * passed (the #1512 paragraph's T19 deferral, unchanged here). TransactionLog
 * and the public profile instead pass `context={fromCard()}` and no longer
 * pass a `contextFromCard` boolean at all - `context.fromCard === true` is
 * now the ONLY way this component learns to defer `effectiveContext` to the
 * fetched card's own `availability.state` (see the #1311 paragraph above).
 *
 * #1515 (T19): the eighteen context-specific loose props named above, and
 * the `contextFromCard` boolean they replaced, are gone. `open`, `onClose`,
 * `entry`, `leagueId`, `week` and `context` are the whole contract now - a
 * builder's object (`model/decisionContext.js`) is the only shape `context`
 * accepts, and every field a kind's action bar, its Watch toggle or its
 * prev/next needs rides inside it. `ALLOWED_PROPS` below throws in
 * development on anything else, so a caller that still passes one of the
 * eighteen fails loudly instead of the extra prop silently doing nothing.
 *
 * #2263: `context.compareWith` (a playerId or null; `myTeam`'s field). While
 * the card is open and it names a player in the context's `entries`, the
 * compare panel shows that player, exactly as if picked from the Compare
 * menu - the Start/sit card's Compare button opens the starter with the
 * benched player compared this way. It only seeds the card's own compare
 * state (when the card opens or `compareWith` changes): the Compare menu
 * and Clear compare keep working after it, and prev/next leaves the compared
 * player alone.
 *
 * ADR 0067, spec #2347 ruling 7: the card is the board PlayerCard: a primary frame drawer (6px double
 * rule), Archivo 24 700 name, tertiary-frame sections with Pixel 16 heads and the kit table, in-row
 * badges, ghost actions. The desktop drawer carries no filled button; the phone sheet is modal, so its
 * Claim or Add is the one filled action (`filled` on ClaimPlayerAction and AddPlayerAction). The pieces
 * live in `playselectPieces.jsx`.
 */
const ALLOWED_PROPS = ['open', 'onClose', 'entry', 'leagueId', 'week', 'context'];

export default function PlayerDecisionCard(props) {
  if (process.env.NODE_ENV !== 'production') {
    const unknown = Object.keys(props).filter((key) => !ALLOWED_PROPS.includes(key));
    if (unknown.length > 0) {
      throw new Error(
        `PlayerDecisionCard: removed prop(s) ${unknown.join(', ')} - every context-specific field now rides ` +
          'inside `context` (see widgets/player-decision-card/model/decisionContext.js).'
      );
    }
  }
  const { open, onClose, entry, leagueId, week, context } = props;
  // #1515: every context-specific field the eighteen removed loose props used
  // to carry now lives on the builder's own object (`model/decisionContext.js`)
  // - read once here, under the SAME local names the rest of this component
  // already used, so nothing below this block changes shape.
  const entries = context?.entries;
  const compareWith = context?.compareWith ?? null;
  const bestBall = context?.bestBall;
  const leagueUnsettled = context?.leagueUnsettled;
  const onSwap = context?.onSwap;
  const onRequestDrop = context?.onRequestDrop;
  const canDropEntry = context?.canDropEntry;
  const availability = context?.availability;
  const roster = context?.roster;
  const onActionDone = context?.onActionDone;
  const playerIds = context?.playerIds;
  const onNavigate = context?.onNavigate;
  // #1313: the draft context's own action bar and pool facts, driven by
  // DraftBoard's own live draft state - see the docblock above.
  const draftedBy = context?.draftedBy;
  const adp = context?.adp;
  const canDraft = context?.canDraft;
  const draftUnavailableReason = context?.draftUnavailableReason;
  const queued = context?.queued;
  const onDraft = context?.onDraft;
  const onQueue = context?.onQueue;

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [startMenuAnchor, setStartMenuAnchor] = useState(null);
  const [compareMenuAnchor, setCompareMenuAnchor] = useState(null);
  const [compareId, setCompareId] = useState(null);
  // #2263: seed the compare panel from the caller; keyed on `open` and
  // `compareWith` only, so a manual pick or Clear compare is not re-seeded.
  useEffect(() => {
    if (open) setCompareId(compareWith);
  }, [open, compareWith]);
  const compareButtonRef = useRef(null);
  const titleRef = useRef(null);
  const prevPlayerIdRef = useRef(entry?.playerId ?? null);

  const list = Array.isArray(entries) ? entries : [];
  const isOpen = Boolean(open && entry);

  // f5 (formal review round 1): prev/next over the caller's own opening
  // list, restated from PlayerQuickView.jsx's identical contract.
  const navIds = Array.isArray(playerIds) ? playerIds : null;
  const navIndex = navIds && entry ? navIds.indexOf(entry.playerId) : -1;
  const canPrev = navIndex > 0;
  const canNext = navIndex >= 0 && navIds && navIndex < navIds.length - 1;
  const goPrev = useCallback(() => {
    if (canPrev && onNavigate) onNavigate(navIds[navIndex - 1]);
  }, [canPrev, navIds, navIndex, onNavigate]);
  const goNext = useCallback(() => {
    if (canNext && onNavigate) onNavigate(navIds[navIndex + 1]);
  }, [canNext, navIds, navIndex, onNavigate]);

  useEffect(() => {
    if (!isOpen || !navIds) return undefined;
    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, navIds, goPrev, goNext]);

  // Second risk review (accessibility, round 1 fix delta), finding 2: a
  // Prev/Next click that lands on an end of the list disables that same
  // button (MUI removes it from the tab order), dropping focus to the
  // document body - Modal's own focus-trap recovery lands on the drawer
  // root, not a control, the identical failure Compare's `clearCompare`
  // already works around below. Moving focus to the title on every
  // navigation both restores it AND is the announcement a screen-reader
  // user gets of the swap (nothing else here states the new player's name
  // out loud). Skipped on the FIRST render (the ref starts equal to the
  // initial `entry`) so opening the card doesn't steal focus from whatever
  // opened it.
  useEffect(() => {
    const currentId = entry?.playerId ?? null;
    if (isOpen && navIds && prevPlayerIdRef.current !== currentId) {
      titleRef.current?.focus();
    }
    prevPlayerIdRef.current = currentId;
  }, [entry?.playerId, isOpen, navIds]);

  // Risk review (accessibility, #1313): `draftedBy` is the one fact on this
  // card that can flip WHILE the card sits open - a live pick landing on the
  // very player it shows, not just a prev/next the viewer chose - and the
  // action bar it replaces very likely held the control focus was on.
  // Restated from the SAME pattern as the effect above and `clearCompare`
  // below: move focus onto the replacement (the Alert just below, which
  // announces itself via `role="alert"`) rather than let Modal's own focus-
  // trap recovery drop it on the drawer root with nothing spoken.
  const draftedByRef = useRef(null);
  const prevDraftedByRef = useRef(draftedBy ?? null);
  useEffect(() => {
    if (isOpen && draftedBy && !prevDraftedByRef.current) {
      draftedByRef.current?.focus();
    }
    prevDraftedByRef.current = draftedBy ?? null;
  }, [draftedBy, isOpen]);

  // #1307: the one Decision-card payload, read in every context (ADR 0040's
  // decision strip and eighteen-week bars are additive to `my_team`'s
  // existing entry-based sections above, not a replacement for them).
  const { status: cardStatus, card } = usePlayerCard({ leagueId, playerId: entry?.playerId ?? null, week });
  // #1667: Line, Weather, Usage and Opponent rank ride the same read.
  const { line, weather } = lineContextFromResponse(card);
  const usage = usageFromResponse(card);
  const opponents = opponentsFromResponse(card);

  // #1358: the Season pick - which of `card.seasons` drives the bars and the
  // game log. `null` means "no explicit pick yet", which resolves to
  // `seasons[0]` below - the league's current season, per #1356's ruling
  // that `seasons[0]` is always that season (CONTEXT.md's Season pick: "The
  // current season is picked when the card opens"). Resetting to `null` on
  // every `entry.playerId` change is what makes prev/next land back on the
  // current season rather than carrying a stale pick onto the next player.
  const [pickedSeason, setPickedSeason] = useState(null);
  useEffect(() => {
    setPickedSeason(null);
  }, [entry?.playerId]);
  // The open tab: it survives Previous/Next, and a closed card reopens on Overview.
  const [tab, setTab] = useState(TABS[0].key);
  useEffect(() => {
    if (!isOpen) setTab(TABS[0].key);
  }, [isOpen]);
  // #1312: the Watch toggle's own optimistic display state. `usePlayerCard`
  // (entities/player, ADR 0029's audit surface - outside this ticket's Scope)
  // reads through `shared/lib`'s `useEndpoint`, which only re-fetches on a
  // URL change (leagueId/playerId/week), so a successful PUT/DELETE has no
  // way to make `card.watching` itself go stale-then-fresh again. This local
  // override is what lets the button reflect the toggle immediately, without
  // waiting on the next open (a new `entry.playerId`, which resets it back to
  // following the server's own `card.watching` fact).
  const [watchingOverride, setWatchingOverride] = useState(null);
  useEffect(() => {
    setWatchingOverride(null);
  }, [entry?.playerId]);
  const watching = watchingOverride != null ? watchingOverride : Boolean(card?.watching);
  const seasons = Array.isArray(card?.seasons) ? card.seasons : [];
  const currentSeasonEntry = seasons[0] ?? null;
  const selectedSeasonEntry =
    (pickedSeason != null && seasons.find((s) => s.season === pickedSeason)) || currentSeasonEntry;
  // #1515 (T19): `context` is always one of the six pure builders' objects
  // (`model/decisionContext.js`) now - the legacy bare string this used to
  // also accept is gone along with the eighteen loose props, since every
  // production caller and this widget's own test suite build one.
  const contextKind = context?.kind ?? null;
  // #1311, ADR 0040 ruling (c), migrated onto the `fromCard()` builder at
  // #1514: a caller with no Availability fact of its own (TransactionLog, the
  // public profile's "In your leagues" card) passes `context={fromCard()}` -
  // `{ kind: null, fromCard: true }` - instead of a kind of its own. The
  // effective context is then the card payload's own availability fact, and
  // stays null (matching none of the branches below) until that payload
  // answers, so no action bar renders on a bare `{ playerId, name }` entry
  // before then.
  const isFromCard = context?.fromCard === true;
  const effectiveContext = isFromCard ? (card?.availability?.state ?? null) : contextKind;

  // Risk review (#1311): every OTHER caller hands a full `entry`, so the
  // drawer always paints real content immediately even while this read is
  // still in flight (ADR 0037: "the row's own fields paint immediately").
  // A `fromCard()` caller's minimal `{ playerId, name }` entry is the one
  // case where the whole action bar, and every section but the bare name,
  // waits on this SAME read - so that wait needs its own announcement, the
  // way PlayerQuickView's `quickview-skeleton` region announced its own load.
  const awaitingCard = isFromCard && cardStatus === 'loading';
  // Formal review round 1, f1: the error half of the SAME gap - a failed
  // /card read on this path used to leave a silent, near-empty dialog
  // forever (no action bar, since effectiveContext stays null on error too,
  // and no explanation). Restated from PlayerQuickView's own
  // `!loading && error && <Alert severity="error">`.
  const cardFailed = isFromCard && cardStatus === 'error';
  // f1 (formal review round 1, blocker): see the docblock above.
  const lineupManaged = effectiveContext === 'my_team' && typeof onSwap === 'function';

  // The header's display fields fall back to the card payload's own `player`
  // block whenever `entry` doesn't carry them (ruling (d): TransactionLog's
  // entry is only `{ playerId, name }`), so a minimal entry still paints a
  // real team/headshot/position/injury once the card arrives. A caller that
  // already supplies these (every lineup-managed and Availability-context
  // caller) is untouched - nullish coalescing only fills a gap.
  const displayEntry = entry
    ? {
        ...entry,
        nflTeam: entry.nflTeam ?? card?.player?.teamCode ?? null,
        photoUrl: entry.photoUrl ?? card?.player?.photoUrl ?? null,
        slot: entry.slot ?? card?.player?.position ?? null,
        injuryStatus: entry.injuryStatus ?? card?.player?.injury?.designation ?? null,
      }
    : entry;

  const compareEntry = compareId != null ? list.find((e) => e.playerId === compareId) || null : null;
  // One card read per side in compare mode (#1667).
  const { card: compareCard } = usePlayerCard({
    leagueId,
    playerId: compareEntry?.playerId ?? null,
    week,
  });
  const { line: compareLine, weather: compareWeather } = lineContextFromResponse(compareCard);
  const compareUsage = usageFromResponse(compareCard);
  const compareOpponents = opponentsFromResponse(compareCard);

  const handleClose = (event, reason) => {
    setStartMenuAnchor(null);
    setCompareMenuAnchor(null);
    setCompareId(null);
    onClose?.(event, reason);
  };

  // Clearing Compare unmounts the control that had focus; move focus back to
  // the Compare button rather than leaving it to Modal's own focus-trap
  // recovery (which lands on the drawer root, not a control - review finding).
  const clearCompare = () => {
    setCompareId(null);
    compareButtonRef.current?.focus();
  };

  const isStarting = entry ? entry.slot !== 'BENCH' && entry.slot !== 'IR' : false;
  const isLocked = entry ? locked(entry) : false;
  const isSpent = spent(entry);
  // f1/r1/r2/r3 (formal review, round 2): Bench and Start now ask the SAME
  // eligibility rule the row path uses (`isEligibleMove`, exported from
  // `lineup-write`) rather than a hand-enumerated set of conditions - the
  // enumeration had already missed a spent starter's Bench button, a spent
  // Start target, and the whole rule while the league is unsettled, three
  // of `onRowClick`'s own refusals a second, independent copy could not
  // help drifting out of sync with. `startTargetSlots` checks every current
  // occupant of a slot type, not just the first one found (r5), so a slot
  // type with more than one instance is no longer disabled outright by a
  // single locked or spent occupant.
  // #1307/f1: these bench/start eligibility reads assume a lineup entry's
  // own `eligibleSlots`/`locked`/`spent` fields, which only a TRUE lineup
  // caller populates - gated on `lineupManaged`, not the bare `context`
  // check a my_team open from PlayerManagement would also satisfy while
  // crashing on a missing `eligibleSlots` (formal review round 1, f1).
  const benchAllowed = entry && lineupManaged
    ? isEligibleMove({ selectedEntry: entry, targetEntry: null, targetSlot: 'BENCH', bestBall, leagueUnsettled })
    : false;
  const startTargets = entry && lineupManaged && !isStarting
    ? startTargetSlots(entry, list, { bestBall, leagueUnsettled })
    : [];
  // Formal review round 3 finding s2: `movesToStart` returns `[]` as its own
  // refusal for the rare case `startTargets` goes stale (the menu stayed
  // open across a refetch or another move), but `onSwap` is the page's `submit`,
  // which PUTs an empty `moves` array and reports "Lineup saved" just as
  // readily as a real move - an empty array is a refusal only if the CALLER
  // treats it as one. This is that treatment, used by both call sites below
  // instead of each re-deriving the same guard.
  const startInto = (slot) => {
    const moves = movesToStart(entry, slot, list, { bestBall, leagueUnsettled });
    if (moves.length > 0) onSwap?.(moves);
  };
  const dropAllowed = entry ? Boolean(!isSpent && canDropEntry?.(entry)) : false;
  const compareCandidates = entry ? list.filter((e) => e && e.playerId !== entry.playerId) : [];
  // Best ball still hides bench options entirely (a best-ball lineup isn't
  // manually managed at all, matching how the page hides the Start/sit
  // panel rather than disabling it - LineupPage.test.jsx, "best ball hides
  // the Start/sit panel entirely"). A locked or spent OPENED player no
  // longer hides the section (round 2): it renders with every Swap's own
  // eligibility computed per candidate via `isEligibleMove`, and "the lock
  // shown" for THIS player is the header's Locked/Spent indicator just
  // below, not a duplicate per-row note (that note stays reserved for a
  // locked CANDIDATE, an independent fact `BenchOptionsSection` still
  // carries on its own).
  const benchOptionsHidden = isStarting && bestBall;

  // Action rows: grouped as "Player actions", with Watch in the lineup and
  // rostered rows (the board draws it in line); elsewhere Watch keeps its own row.
  const rowSx = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', px: '20px', pb: '16px' };
  const rowProps = { role: 'group', 'aria-label': 'Player actions' };
  const watchInRow = (lineupManaged || effectiveContext === 'rostered' || effectiveContext === 'my_team');
  const watchButton = entry && (
    <WatchPlayerAction
      playerId={entry.playerId}
      leagueId={leagueId}
      watching={watching}
      onToggled={setWatchingOverride}
      onDone={onActionDone}
    />
  );
  const watchSlot = (
    <Box component="span" data-testid="decision-card-watch" sx={{ display: 'inline-flex' }}>{watchButton}</Box>
  );
  // Claim and Add are filled only on the phone sheet, which is modal; the desktop drawer carries none.
  const psActionProps = { filled: isMobile };

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      open={isOpen}
      onClose={handleClose}
      // Formal review finding f8: PlayerQuickView, the dialog this card
      // replaces on Lineup, deliberately sets `{ appear: 0, enter: 0, exit:
      // 120 }` (instant open, a brief exit) rather than flattening both to
      // zero; an earlier revision here shipped the flattened, test-only-
      // looking value to production with no stated reason. Matching that
      // precedent rather than re-arguing it.
      transitionDuration={{ appear: 0, enter: 0, exit: 120 }}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-labelledby': entry ? 'decision-card-title' : undefined,
        'aria-busy': awaitingCard || undefined,
        'data-testid': 'decision-card',
        'data-variant': isMobile ? 'sheet' : 'drawer',
        // ps-root scopes the Play-select focus ring and hover rules (playselect.css) to the drawer.
        className: 'ps-root',
        sx: {
          // f6 (formal review round 1): the body and ADR 0040 (Main.dc.html:18)
          // both say 560, not the 420 this shipped at; Compare's two-column
          // width grows in proportion (each column stays coherent with a
          // single-player 560px drawer) rather than keeping its old ratio to
          // the wrong base number. Driven off the same JS `isMobile` the
          // sheet/drawer variant already branches on, not a second,
          // independent `sm` breakpoint object - one media query to keep in
          // sync instead of two, and a number a jsdom test can assert on
          // directly rather than one only a real browser's `@media` rule
          // resolves.
          width: isMobile ? '100%' : (compareEntry ? 1040 : 560),
          maxWidth: '100%',
          height: isMobile ? '88vh' : '100%',
          borderTopLeftRadius: isMobile ? 16 : 0,
          borderTopRightRadius: isMobile ? 16 : 0,
          // Header, actions and tabs stay in view; only the tab panel scrolls.
          overflowY: 'hidden',
          // The primary frame: a 6px double rule on the Panel, square corners; the phone sheet has no bottom edge.
          borderRadius: 0,
          border: '6px double var(--ps-frame)',
          borderBottom: isMobile ? 0 : undefined,
          backgroundColor: 'var(--ps-panel)',
          backgroundImage: 'none',
          color: 'var(--ps-ink)',
          fontFamily: BODY_FONT,
          boxShadow: 'none',
          // MUI's Typography takes the theme font; every body line in the drawer takes Archivo.
          '& .MuiTypography-root': { fontFamily: 'inherit' },
        },
      }}
    >
      {entry && (
        <>
          {isMobile && <DragHandle />}

          {/* Risk review (#1311): the ONE case where the whole card waits on
              this read (a `fromCard()` context, before the payload answers)
              gets its own announcement, restated from PlayerQuickView's
              identical loading region - every other caller's `entry` already
              paints real content, so it needs none. */}
          {awaitingCard && (
            <Typography sx={visuallyHidden} role="status" aria-live="polite">
              Loading player details
            </Typography>
          )}

          <PsCardHeader
              entry={entry}
              displayEntry={displayEntry}
              verdict={card?.startVerdict}
              locked={isLocked}
              spentFlag={spent(entry)}
              titleRef={titleRef}
              phone={isMobile}
              nav={navIds ? { index: navIndex, total: navIds.length, canPrev, canNext, goPrev, goNext } : null}
              onClose={handleClose}
            />

          {/* Formal review round 1, f1: restated from PlayerQuickView's own
              `!loading && error && <Alert severity="error">` - the one path
              whose entire content depends on this read gets a visible
              explanation on failure, not a permanently near-empty dialog.
              MUI's Alert carries role="alert" itself. No action bar renders
              either way, since effectiveContext stays null on error too. */}
          {cardFailed && (
            <PsLoadError>{"We could not load this player's details."}</PsLoadError>
          )}

          {/* The loading skeleton (board PlayerCard): blocks where the actions and sections will land. */}
          {awaitingCard && <PsLoadingBlocks />}

          {effectiveContext === 'my_team' && !lineupManaged && (
            // f1 (formal review round 1, blocker): a my_team open with no
            // lineup wiring (PlayerManagement's own-player case) gets a
            // link that actually works, restated from the base behaviour
            // PlayerQuickView's "In lineup" action already gave it, rather
            // than a Bench/Start bar with no onSwap to call.
            <Box data-testid="decision-card-actions" sx={rowSx} {...rowProps}>
              <CardButton
                to={`/league/${leagueId}/lineup`}
                onClick={handleClose}
                data-testid="decision-card-open-lineup"
              >
                Open lineup
              </CardButton>
              {watchInRow && watchSlot}
            </Box>
          )}

          {lineupManaged && (
          <Box data-testid="decision-card-actions" sx={rowSx} {...rowProps}>
            {isStarting ? (
              <CardButton
                disabled={!benchAllowed}
                onClick={() => onSwap?.([{ playerId: entry.playerId, slot: 'BENCH' }])}
                data-testid="decision-card-bench-action"
              >
                Bench
              </CardButton>
            ) : (
              <CardButton
                disabled={startTargets.length === 0}
                aria-haspopup={startTargets.length > 1 ? 'menu' : undefined}
                aria-expanded={startTargets.length > 1 ? Boolean(startMenuAnchor) : undefined}
                onClick={(event) =>
                  startTargets.length === 1
                    ? startInto(startTargets[0])
                    : setStartMenuAnchor(event.currentTarget)
                }
                data-testid="decision-card-start-action"
              >
                Start
              </CardButton>
            )}
            <Menu
              anchorEl={startMenuAnchor}
              open={Boolean(startMenuAnchor)}
              onClose={() => setStartMenuAnchor(null)}
              MenuListProps={{ 'aria-label': 'Eligible starting slots' }}
              PaperProps={MENU_PAPER}
            >
              {startTargets.map((slot) => (
                <MenuItem
                  key={slot}
                  onClick={() => {
                    setStartMenuAnchor(null);
                    startInto(slot);
                  }}
                >
                  {slot}
                </MenuItem>
              ))}
            </Menu>

            <CardButton
              ref={compareButtonRef}
              aria-haspopup="menu"
              aria-expanded={Boolean(compareMenuAnchor)}
              onClick={(event) => setCompareMenuAnchor(event.currentTarget)}
              data-testid="decision-card-compare-action"
            >
              {compareEntry ? 'Change compare' : 'Compare'}
              <PixelCaret />
            </CardButton>
            <Menu
              anchorEl={compareMenuAnchor}
              open={Boolean(compareMenuAnchor)}
              onClose={() => setCompareMenuAnchor(null)}
              MenuListProps={{ 'aria-label': 'Players to compare' }}
              PaperProps={MENU_PAPER}
            >
              {compareCandidates.length === 0 ? (
                <MenuItem disabled>No other players to compare</MenuItem>
              ) : (
                compareCandidates.map((candidate) => (
                  <MenuItem
                    key={candidate.playerId}
                    onClick={() => {
                      setCompareMenuAnchor(null);
                      setCompareId(candidate.playerId);
                    }}
                  >
                    {candidate.name}
                  </MenuItem>
                ))
              )}
            </Menu>

            <CardButton
              to={`/league/${leagueId}/trades`}
              onClick={handleClose}
              data-testid="decision-card-trade"
            >
              Trade
            </CardButton>

            <CardButton
              disabled={!dropAllowed}
              onClick={() => onRequestDrop?.(entry)}
              data-testid="decision-card-drop"
            >
              Drop
            </CardButton>
            {watchInRow && watchSlot}
          </Box>
          )}

          {/* #1307, ADR 0040: the other three Availability contexts swap the
              bar above for the availability action bar. `entry` here carries
              no lineup slot - WaiverWire and PlayerManagement map their raw
              player row into the same generic id/name/position/nflTeam shape
              the header and injury tile already read. */}
          {effectiveContext === 'free_agent' && (
            <AddPlayerAction
              player={entry}
              leagueId={leagueId}
              availability={availability}
              roster={roster}
              onAdded={onActionDone}
              {...psActionProps}
            />
          )}
          {effectiveContext === 'waivers' && (
            <ClaimPlayerAction
              player={entry}
              leagueId={leagueId}
              availability={availability}
              roster={roster}
              onClaimed={onActionDone}
              {...psActionProps}
            />
          )}
          {effectiveContext === 'rostered' && (
            <Box
              data-testid="decision-card-actions"
              sx={rowSx}
              {...rowProps}
            >
              <CardButton
                to={`/league/${leagueId}/trades`}
                onClick={handleClose}
                data-testid="decision-card-propose-trade"
              >
                Propose trade
              </CardButton>
              {availability?.teamName && (
                <Typography sx={DIM_LINE_SX}>
                  {`Rostered by ${availability.teamName}`}
                </Typography>
              )}
              {watchInRow && watchSlot}
            </Box>
          )}
          {/* #1313: the Draft room's own action bar - Draft/Queue for an
              undrafted pool player, restated from DraftBoard.jsx's identical
              actions (matching what the room's pool row already offers).
              `draftedBy` set replaces the whole bar with an Alert (risk
              review, accessibility): unlike `rostered`'s plain Availability
              line, this fact can change WHILE the card sits open (a live
              pick landing on the viewed player), so it gets the SAME
              `role="alert"` treatment the deleted DraftQuickView's identical
              banner had, restated here rather than dropped - a plain line
              would render silently for a screen-reader user with focus
              already elsewhere. */}
          {effectiveContext === 'draft' && (
            draftedBy ? (
              <Box data-testid="decision-card-actions" sx={{ px: 2, pb: 1.5 }}>
                <Alert
                  severity="warning"
                  tabIndex={-1}
                  ref={draftedByRef}
                  data-testid="decision-card-drafted-by"
                >
                  {`Drafted by ${draftedBy}`}
                </Alert>
              </Box>
            ) : (
              <Box data-testid="decision-card-actions" sx={rowSx} {...rowProps}>
                {canDraft && (
                  <Tooltip title={draftUnavailableReason || ''}>
                    <span>
                      <CardButton
                        aria-disabled={draftUnavailableReason ? true : undefined}
                        // Risk review (accessibility, #1313): a string `title`
                        // on MUI's Tooltip labels the wrapping <span> (needed
                        // so the tooltip still fires while aria-disabled),
                        // never the Button inside it - a generic, roleless
                        // span carries no accessible name/description of its
                        // own, so the reason never reached assistive tech.
                        // `aria-describedby` on the BUTTON itself, pointing
                        // at the same text rendered visually-hidden just
                        // below, is what actually attaches it to the control
                        // a screen-reader user is focused on.
                        aria-describedby={draftUnavailableReason ? 'decision-card-draft-unavailable-reason' : undefined}
                        onClick={() => {
                          if (draftUnavailableReason) return; // suppressed activation
                          onDraft?.();
                        }}
                        data-testid="decision-card-draft-action"
                      >
                        Draft
                      </CardButton>
                    </span>
                  </Tooltip>
                )}
                <CardButton
                  disabled={queued}
                  onClick={() => onQueue?.()}
                  data-testid="decision-card-queue-action"
                >
                  {queued ? 'Queued' : 'Queue'}
                </CardButton>
                {draftUnavailableReason && (
                  <Box id="decision-card-draft-unavailable-reason" sx={visuallyHidden}>
                    {draftUnavailableReason}
                  </Box>
                )}
              </Box>
            )
          )}
          {effectiveContext === 'draft' && <DraftPoolSection adp={adp} poolRank={navIndex >= 0 ? navIndex + 1 : null} />}
          {/* #1312, ADR 0040 follow-up (grill ruling Q6, the design canvas's
              CardStates artboard): Watch/Watching across every Availability
              context - my_team included (the design draws it on all four
              card states) - never the `draft` context, which is not an
              Availability state (#1313). */}
          {effectiveContext && effectiveContext !== 'draft' && !watchInRow && (
            <Box data-testid="decision-card-watch" sx={{ px: '20px', pb: '16px' }}>
              {watchButton}
            </Box>
          )}
          {!compareEntry && <PsTabs value={tab} onChange={setTab} />}
          <Box sx={PS_SCROLL_SX}>
          {compareEntry ? (
            // AC7: two cards side by side (stacked on a phone). The primary
            // player's own sections render ONCE, inside this grid's left
            // column - review finding: an earlier revision also rendered
            // them again above the grid via a second `ComparePlayerPanel`,
            // duplicating every heading, table and range bar. Each panel's
            // own name is a heading (`h3`) so a screen reader's heading
            // navigation can tell the two players' Game/Usage/Weekly
            // projection headings apart; the sections nested under it step
            // down to `h4` to keep that outline properly nested.
            //
            // Both panels render AC2's own section order (Injury, Game,
            // Projection, Usage) - formal review finding f4: an earlier
            // revision put the compared player's Projection before Game and
            // dropped Injury entirely, an asymmetry the de-duplication fix
            // introduced rather than the original design. Injury is
            // deliberately restored on BOTH sides: hiding one player's
            // injury designation makes a side-by-side start-sit comparison
            // read thinner than the single-card view it stands next to.
            // Bench options stay primary-only: they manage the PRIMARY
            // player's own slot (AC4), and offering them a second time for
            // the compared player would mean managing two different slots
            // from one Compare view, which is new surface no criterion asks
            // for here.
            <Stack>
            <Box
              data-testid="decision-card-compare"
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                gap: '16px',
                alignItems: 'start',
              }}
            >
              <Box data-testid={`decision-card-compare-panel-${entry.playerId}`} sx={PS_PANEL_SX}>
                <Typography component="h3" sx={PS_PANEL_NAME_SX}>{entry.name}</Typography>
                <InjurySection entry={entry} level="h4" practice={card?.player?.practice} practiceTestId="decision-card-practice" />
                <GameSection entry={entry} line={line} weather={weather} level="h4" />
                <ProjectionSection entry={entry} level="h4" volatility={card?.decision?.volatility} explanation={card?.explanation} />
                <UsageSection usage={usage} opponents={opponents} position={entry.position} level="h4" />
                <BenchOptionsSection
                  entry={entry}
                  entries={list}
                  onSwap={onSwap}
                  level="h4"
                  hidden={benchOptionsHidden}
                  bestBall={bestBall}
                  leagueUnsettled={leagueUnsettled}
                />
              </Box>
              <Box
                data-testid={`decision-card-compare-panel-${compareEntry.playerId}`}
                sx={PS_PANEL_SX}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flexWrap: 'wrap' }}>
                    <Typography component="h3" sx={PS_PANEL_NAME_SX}>{compareEntry.name}</Typography>
                    <NoPracticeNote verdict={compareCard?.startVerdict} testId="decision-card-compare-no-practice" />
                    <BackupNote verdict={compareCard?.startVerdict} testId="decision-card-compare-backup" />
                  </Box>
                  <PsIconButton quiet label="Clear compare" onClick={clearCompare}><PixelClose /></PsIconButton>
                </Box>
                <InjurySection entry={compareEntry} level="h4" practice={compareCard?.player?.practice} practiceTestId="decision-card-compare-practice" />
                <GameSection entry={compareEntry} line={compareLine} weather={compareWeather} level="h4" />
                <ProjectionSection entry={compareEntry} level="h4" volatility={compareCard?.decision?.volatility} explanation={compareCard?.explanation} />
                <UsageSection usage={compareUsage} opponents={compareOpponents} position={compareEntry.position} level="h4" />
              </Box>
            </Box>
            </Stack>
          ) : (
            <>
              <TabPanel tab="overview" active={tab}>
                {effectiveContext !== 'my_team' && <NewsSection news={card?.news} />}
                <InjurySection entry={displayEntry} practice={card?.player?.practice} practiceTestId="decision-card-practice" />
                {lineupManaged && <GameSection entry={entry} line={line} weather={weather} />}
                {lineupManaged && <ProjectionSection entry={entry} volatility={card?.decision?.volatility} explanation={card?.explanation} />}
                <UsageSection usage={usage} opponents={opponents} position={entry?.position} showTable={lineupManaged} />
                {/* #1307, ADR 0040: "Every context adds the decision strip ...
                    and the eighteen-week bars" - additive to my_team's own
                    Game/Projection/Usage sections above, not a replacement. */}
                <DecisionStripSection
                  decision={card?.decision}
                  usage={card?.decision?.usage}
                  ownership={card?.ownership}
                  depth={card?.depth}
                  rosterStatus={card?.rosterStatus}
                  noHistory={hasNoHistory(entry)}
                />
                {/* The bars are always the current season; the Season pick lives on Game log. */}
                {Array.isArray(currentSeasonEntry?.weeks) && currentSeasonEntry.weeks.length > 0 && (
                  <PsSection title="Weekly points" testId="decision-card-weekly-section">
                    <PsWeeklyBars
                      weeks={currentSeasonEntry.weeks}
                      currentWeek={card?.decision?.projWeek?.week}
                      seasonEnd={card?.seasonEnd}
                    />
                  </PsSection>
                )}
                <PsBio bio={card?.bio} />
                {lineupManaged && (
                  <BenchOptionsSection
                    entry={entry}
                    entries={list}
                    onSwap={onSwap}
                    hidden={benchOptionsHidden}
                    bestBall={bestBall}
                    leagueUnsettled={leagueUnsettled}
                  />
                )}
              </TabPanel>
              <TabPanel tab="log" active={tab}>
                {/* #1358: the Season pick drives the game log, which reads the PICKED season's own `log`.
                    `card.seasons[i].log` is already the row array `GameLogTable` reads as `log.current`. */}
                <SeasonPickSection
                  seasons={seasons}
                  value={selectedSeasonEntry?.season ?? null}
                  onChange={setPickedSeason}
                />
                <GameLogSection log={{ current: selectedSeasonEntry?.log ?? [] }} />
              </TabPanel>
              <TabPanel tab="stats" active={tab}>
                <SeasonSummarySection seasons={seasons} />
              </TabPanel>
            </>
          )}
          </Box>
        </>
      )}
    </Drawer>
  );
}

// AC1: the six-prop contract itself - `context`'s own shape is one of the
// six builders' objects (`model/decisionContext.js`), never validated here
// field-by-field (each builder already validates its own inputs; this widget
// only ever reads `.kind` and the handful of fields a given kind carries).
PlayerDecisionCard.propTypes = {
  open: PropTypes.bool,
  onClose: PropTypes.func,
  entry: PropTypes.object,
  leagueId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  week: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  context: PropTypes.object,
};

// --- The card's pieces (ADR 0067, spec #2347 ruling 7) -------------------------------------------------

// A card action: a square ghost 44px Play-select button. Props and the ref pass to the button.
const CardButton = React.forwardRef(function CardButton({ to, children, ...rest }, ref) {
  return <PsButton ref={ref} to={to} {...rest}>{children}</PsButton>;
});

// The stack the sections sit in: 16px gaps under the header and action rows.
function Stack({ children }) {
  return <Box sx={PS_STACK_SX}>{children}</Box>;
}

// The tab panel's scroller: the one region of the card that scrolls (the Drawer paper is a column flexbox).
const PS_SCROLL_SX = { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' };

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'log', label: 'Game log' },
  { key: 'stats', label: 'Stats' },
];

// ARIA tabs in the Lineup SectionToggles look: a 2px Ink edge, the selected tab a Play-blue fill with the
// pixel arrow. Roving tabindex; Left/Right/Home/End move and activate. Those keys never reach the window
// listener that walks players (`isTypingTarget` exempts the tablist).
function PsTabs({ value, onChange }) {
  const onKeyDown = (event, index) => {
    const last = TABS.length - 1;
    let next = null;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
    onChange(TABS[next].key);
  };
  return (
    <Box role="tablist" aria-label="Player card sections" sx={{ display: 'flex', p: '0 18px 16px 16px', flex: 'none' }}>
      {TABS.map((tab, index) => {
        const on = tab.key === value;
        return (
          <Box
            key={tab.key}
            component="button"
            type="button"
            role="tab"
            id={`decision-card-tab-${tab.key}`}
            aria-selected={on}
            aria-controls={`decision-card-tabpanel-${tab.key}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            sx={{
              flex: '1 1 0',
              minWidth: 0,
              minHeight: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              p: '0 8px',
              ml: index ? '-2px' : 0,
              boxSizing: 'border-box',
              borderRadius: 0,
              font: 'inherit',
              fontSize: '14px',
              fontWeight: 600,
              border: `2px solid ${on ? 'var(--ps-play)' : 'var(--ps-ink)'}`,
              backgroundColor: on ? 'var(--ps-play)' : 'transparent',
              color: on ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
              cursor: 'pointer',
              // The tabs overlap by 2px; the selected one sits on top so its edge is whole.
              ...(on ? { position: 'relative', zIndex: 1 } : null),
            }}
          >
            {on ? <PixelArrow /> : null}
            {tab.label}
          </Box>
        );
      })}
    </Box>
  );
}

// One tab's panel. Every panel is in the DOM so each tab's aria-controls resolves; only the active one has content.
function TabPanel({ tab, active, children }) {
  const on = tab === active;
  return (
    <Box
      role="tabpanel"
      id={`decision-card-tabpanel-${tab}`}
      aria-labelledby={`decision-card-tab-${tab}`}
      hidden={!on}
      sx={PS_STACK_SX}
    >
      {on ? children : null}
    </Box>
  );
}

const PS_PANEL_SX = { display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 };
const PS_PANEL_NAME_SX = { m: 0, fontSize: '17px', fontWeight: 700 };

// A 44px square icon button: a transparent 2px edge, Ink glyph.
function PsIconButton({ label, onClick, disabled, quiet, onBand, children, ...rest }) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      {...rest}
      sx={{
        width: '44px',
        height: '44px',
        p: 0,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        boxSizing: 'border-box',
        borderRadius: 0,
        backgroundColor: 'transparent',
        border: '2px solid transparent',
        color: onBand ? 'var(--ps-play-ink)' : (quiet ? 'var(--ps-dim)' : 'var(--ps-ink)'),
        cursor: 'pointer',
        '&[disabled]': { color: onBand ? 'var(--ps-play-dim)' : 'var(--ps-dim)', cursor: 'not-allowed' },
      }}
    >
      {children}
    </Box>
  );
}

const Chevron = ({ dir }) => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" shapeRendering="crispEdges" style={{ flex: 'none' }}>
    <path
      d={dir === 'prev' ? 'M7 1h2v2H7zM5 3h2v2H5zM3 5h2v2H3zM5 7h2v2H5zM7 9h2v2H7z' : 'M3 1h2v2H3zM5 3h2v2H5zM7 5h2v2H7zM5 7h2v2H5zM3 9h2v2H3z'}
      fill="currentColor"
    />
  </svg>
);

const PixelCaret = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M1 2h10v2H9v2H7v2H5V6H3V4H1z" fill="currentColor" />
  </svg>
);

// The header band: Play blue, flex 'none' so it stays in view above the scrolling tab panel.
const BAND_SX = { backgroundColor: 'var(--ps-play)', color: 'var(--ps-play-ink)', flex: 'none', mb: '16px' };

// The header: the player's square avatar, the name in Archivo 24 700 (a name is not pixel type) and the
// in-row tags; the counter, previous, next and close sit at the right, or on their own row on a phone.
// `nav` is null with no list to walk. The counter is a polite live region and holds text only.
function PsCardHeader({
  entry, displayEntry, verdict, locked: isLocked, spentFlag, titleRef, phone, nav, onClose,
}) {
  const controls = (
    <Box sx={{ display: 'flex', alignItems: 'center', flex: 'none' }}>
      {nav && (
        <>
          {nav.index >= 0 && (
            <Box
              component="span"
              role="status"
              aria-label={`Player ${nav.index + 1} of ${nav.total}`}
              sx={{ fontSize: '14px', color: 'var(--ps-play-dim)', whiteSpace: 'nowrap', px: '6px' }}
            >
              {nav.index + 1} of {nav.total}
            </Box>
          )}
          <PsIconButton onBand label="Previous player" onClick={nav.goPrev} disabled={!nav.canPrev} data-testid="decision-card-prev">
            <Chevron dir="prev" />
          </PsIconButton>
          <PsIconButton onBand label="Next player" onClick={nav.goNext} disabled={!nav.canNext} data-testid="decision-card-next">
            <Chevron dir="next" />
          </PsIconButton>
        </>
      )}
      <PsIconButton onBand label="Close" onClick={onClose} data-testid="decision-card-close"><PixelClose /></PsIconButton>
    </Box>
  );
  const ident = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
      <PlayerAvatar name={displayEntry.name} photoUrl={displayEntry.photoUrl} size={56} />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          id="decision-card-title"
          ref={titleRef}
          component="h2"
          // Programmatically focusable for the prev/next effect, never in the tab order.
          tabIndex={-1}
          sx={{ m: 0, fontFamily: 'inherit', fontSize: '24px', lineHeight: 1.2, fontWeight: 700, color: 'var(--ps-play-ink)' }}
          noWrap
        >
          {displayEntry.name}
        </Typography>
        <Box
          sx={{
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 8px', mt: '6px',
            // The shared position and injury tags keep their own look elsewhere; on the band they are
            // outlined in Play dim with Play ink text (an Out tag drops its Ink fill).
            '& [data-position], & [data-status]': {
              borderColor: 'var(--ps-play-dim)', color: 'var(--ps-play-ink)', backgroundColor: 'transparent',
            },
          }}
        >
          {displayEntry.slot && <PosTag position={displayEntry.slot} />}
          <PsInjuryTag status={displayEntry.injuryStatus} />
          <NoPracticeNote onBand verdict={verdict} testId="decision-card-no-practice" />
          <BackupNote onBand verdict={verdict} testId="decision-card-backup" />
          <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-play-dim)' }}>{displayEntry.nflTeam}</Box>
          {isLocked && <RowBadge onBand data-testid="decision-card-locked">Locked</RowBadge>}
          {spentFlag && <RowBadge onBand data-testid="decision-card-spent">Spent</RowBadge>}
        </Box>
      </Box>
    </Box>
  );
  return phone ? (
    <Box sx={{ ...BAND_SX, p: '0 8px 12px 16px' }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>{controls}</Box>
      {ident}
    </Box>
  ) : (
    <Box sx={{ ...BAND_SX, p: '12px 8px 12px 20px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
      {ident}
      {controls}
    </Box>
  );
}

// The loading skeleton for a card that waits on its read (a `fromCard()` context): blocks where the actions
// and the sections will land, hidden from assistive tech (the status line above them speaks).
function PsLoadingBlocks() {
  return (
    <Box aria-hidden="true" sx={PS_STACK_SX}>
      <Box sx={{ display: 'flex', gap: '8px' }}>
        {[88, 120, 80].map((w) => <Skel key={w} width={`${w}px`} height={44} />)}
      </Box>
      {[0, 1].map((i) => (
        <Frame key={i} component="div" tier="rule">
          <Box sx={{ p: '14px 20px', borderBottom: '2px solid var(--ps-rule)' }}><Skel width="96px" height={16} /></Box>
          <Box sx={{ p: '14px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <Skel width="60%" height={16} />
            <Skel width="80%" height={16} />
          </Box>
        </Frame>
      ))}
    </Box>
  );
}

// The phone sheet's drag handle (AC6): decorative only - the sheet closes on
// Escape and the close control, never by an actual drag gesture this ticket
// implements. A square 40x4 Rule bar.
function DragHandle() {
  return (
    <Box
      aria-hidden="true"
      data-testid="decision-card-drag-handle"
      sx={{ width: '40px', height: '4px', backgroundColor: 'var(--ps-rule)', m: '8px auto 4px', flex: 'none' }}
    />
  );
}

function Section({ title, testId, level = 'h3', children }) {
  return <PsSection title={title} testId={testId} level={level}>{children}</PsSection>;
}

/**
 * ADR 0056: "No practice this week" beside a Questionable tag, on the opened
 * player and on a compared one alike. Read off the card payload's own Start
 * verdict (`card.startVerdict`, spec #2042), so every surface that opens the
 * card shows it; the verdict reads `no_practice` only for a Questionable player.
 */
function NoPracticeNote({ verdict, testId, onBand }) {
  if (verdict?.reason !== 'no_practice') return null;
  return <RowBadge data-testid={testId} onBand={onBand}>{NO_PRACTICE_LABEL}</RowBadge>;
}

/**
 * ADR 0057: "Backup" on a quarterback behind an available teammate, read off
 * the card payload's Start verdict. His number stays printed; this only tags it.
 */
function BackupNote({ verdict, testId, onBand }) {
  if (verdict?.reason !== 'backup') return null;
  return <RowBadge data-testid={testId} onBand={onBand}>{BACKUP_LABEL}</RowBadge>;
}

// AC2/AC3: the injury designation and the feed's detail, hidden only when the
// designation and the Practice participation line (#1923, `practice`: the
// card's `player.practice` entries, context only) are both absent.
function InjurySection({ entry, level, practice, practiceTestId }) {
  const view = injuryTileView(entry);
  const entries = Array.isArray(practice) ? practice : [];
  if (!view && entries.length === 0) return null;
  const dim = DIM_LINE_SX;
  return (
    <Section title="Injury" testId="decision-card-injury" level={level}>
      {view && <Typography sx={INK_LINE_SX}>{view.name}</Typography>}
      {view && view.detail && <Typography sx={dim}>{view.detail}</Typography>}
      {entries.length > 0 && (
        <Typography data-testid={practiceTestId} sx={dim}>
          {`Practice: ${entries.map((e) => `${e.status} (${e.day})`).join(', ')}`}
        </Typography>
      )}
    </Section>
  );
}

// AC2/AC3: opponent, kickoff, Line, Implied team total (both hidden together
// on a null Line) and weather with indoor (hidden on a null weather).
function GameSection({ entry, line, weather, level }) {
  const hasOpponent = entry.opponent != null;
  const kickoff = formatKickoff(entry.kickoff);
  const showLine = line != null;
  const showWeather = weather != null;
  if (!hasOpponent && !showLine && !showWeather) return null;
  const dim = DIM_LINE_SX;
  return (
    <Section title="Game" testId="decision-card-game" level={level}>
      {hasOpponent && (
        <Typography sx={INK_LINE_SX} data-testid="decision-card-opponent">
          {`vs ${entry.opponent}${kickoff ? ` · ${kickoff}` : ''}`}
        </Typography>
      )}
      {showLine && (
        <Box data-testid="decision-card-line" sx={{ display: 'flex', gap: '4px 12px', flexWrap: 'wrap' }}>
          <Typography sx={dim}>
            {`Line: ${line.spread != null ? line.spread : '-'} / ${line.total != null ? line.total : '-'}`}
          </Typography>
          {line.impliedTeamTotal != null && (
            <Typography data-testid="decision-card-implied-total" sx={dim}>
              {`Implied team total: ${formatPoints(line.impliedTeamTotal)}`}
            </Typography>
          )}
        </Box>
      )}
      {showWeather && (
        <Typography data-testid="decision-card-weather" sx={dim}>
          {weather.indoor
            ? 'Indoor'
            : [
                weather.temperatureF != null ? `${weather.temperatureF}°F` : null,
                weather.windSpeedMph != null ? `${weather.windSpeedMph} mph wind` : null,
                weather.shortForecast || null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Weather unavailable'}
        </Typography>
      )}
    </Section>
  );
}

// AC2: the Point estimate, Floor, Ceiling on the range bar, and the
// largest Factor's explanation. `entry.factorExplanation` (#1281) rides the
// lineup entry as its own field, independent of the Edge line:
// `lineup.service.js` sets it from the SAME `factorEdgeText(factors)` call
// that can win the Edge line's `factor` kind, but unconditionally, so it
// renders here even when a higher-priority kind (injury, bench-above-starter)
// won the Edge line instead - an injured player can show both his injury
// tile and his largest Factor's explanation at once. Null when no factor
// applies.
//
// #1482, formal review round 2 (formal-002-f1): the range-bar marker and the
// "Proj" text read `entry.projectedPoints` (CONTEXT.md's Point estimate),
// never `entry.projection` (the distribution's bare mean) - the same card
// opens from a Ledger row, so a mean-headlined "Proj" here would reproduce
// the issue's own contradiction one tap after the row is fixed. Floor and
// Ceiling stay `entry.floor`/`entry.ceiling` (p10/p90): untouched by this
// ticket.
//
// #1777 (spec #1774): a Position-baseline projection reads "no history" here
// exactly as it does on the Ledger row that opened the card - `projectionLabel`
// and `hasNoHistory` (`shared/lib`) are the one helper both surfaces call - and
// the range-bar marker is withheld (a null projection paints no tick).
//
// #1849 (spec #1845): the Volatility tag sits beside the range bar as a Badge,
// from the card payload's `decision.volatility` (`steady` | `boom_or_bust`);
// anything else (null, absent, a tag this build does not know) renders nothing,
// never an "unavailable" (ADR 0040).
function ProjectionSection({ entry, level, volatility, explanation }) {
  const factorText = entry.factorExplanation || null;
  const volatilityLabel = VOLATILITY_LABELS[volatility] ?? null;
  return (
    <Section title="Weekly projection" testId="decision-card-projection" level={level}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <PsRangeBar
            floor={entry.floor}
            ceiling={entry.ceiling}
            projection={hasNoHistory(entry) ? null : entry.projectedPoints}
            label={entry.name}
            data-testid="decision-card-range-bar"
          />
        </Box>
        {volatilityLabel && <RowBadge data-testid="decision-card-volatility">{volatilityLabel}</RowBadge>}
      </Box>
      <Box
        sx={{ ...DIM_LINE_SX, fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}
      >
        <span>{`Floor ${formatPoints(entry.floor)}`}</span>
        <span>{`Proj ${projectionLabel(entry)}`}</span>
        <span>{`Ceiling ${formatPoints(entry.ceiling)}`}</span>
      </Box>
      {factorText && (
        <Typography data-testid="decision-card-factor" sx={{ ...INK_LINE_SX, fontSize: '14px' }}>
          {factorText}
        </Typography>
      )}
      {explanation && (
        <Typography variant="body2" data-testid="decision-card-explanation" sx={{ ...INK_LINE_SX, fontSize: '14px' }}>
          {explanation}
        </Typography>
      )}
    </Section>
  );
}

// AC2/AC3: the last three weeks beside the season average, hidden entirely
// on empty usage (his team had no played week yet).
// #1609: the "Opp rank vs <POS>" line under the table, one entry per next
// game, rendering nothing when there are none (ADR 0040). It shows in every
// context; the table itself stays with the lineup-managed card (`showTable`).
function UsageSection({ usage, opponents, position, level, showTable = true }) {
  const hasTable = showTable && usage && Array.isArray(usage.weeks) && usage.weeks.length > 0;
  const hasOpponents = Array.isArray(opponents) && opponents.length > 0;
  if (!hasTable && !hasOpponents) return null;
  const rows = hasTable
    ? [
        ...usage.weeks.map((w) => ({ ...w, isAverage: false })),
        { ...usage.seasonAverage, isAverage: true },
      ]
    : [];
  return (
    <PsSection title="Usage" testId="decision-card-usage" level={level} pad={false}>
      {hasTable && (
        <PsTable
          label="Usage"
          testId="decision-card-usage-table"
          minWidth={480}
          cols={[
            { label: 'Week' },
            { label: 'Tgt', align: 'right' },
            { label: 'Car', align: 'right' },
            { label: 'Air yds', align: 'right' },
            { label: 'Snaps', align: 'right' },
            { label: 'Tgt share', align: 'right' },
            { label: 'FPTS', align: 'right' },
          ]}
          rows={rows.map((row) => ({
            key: row.isAverage ? 'season-average' : `${row.season}-${row.week}`,
            cells: [
              row.isAverage ? 'Season avg' : `Wk ${row.week}`,
              row.targets ?? '-',
              row.carries ?? '-',
              row.airYards ?? '-',
              row.snaps != null
                ? `${row.snaps}${row.snapShare != null ? ` (${Math.round(row.snapShare * 100)}%)` : ''}`
                : '-',
              row.targetShare != null ? `${Math.round(row.targetShare * 100)}%` : '-',
              formatPoints(row.fantasyPoints),
            ],
          }))}
        />
      )}
      {hasOpponents && (
        <Typography
          data-testid="decision-card-opp-rank"
          sx={{ ...DIM_LINE_SX, p: '12px 20px 14px', ...(hasTable ? { borderTop: '2px solid var(--ps-rule)' } : null) }}
        >
          Opp rank vs {position}:{' '}
          {opponents.map((o) => `W${o.week} ${o.opponent} ${ordinal(o.rankVsPosition)}`).join(', ')}
        </Typography>
      )}
    </PsSection>
  );
}

// #1307, ADR 0040: the decision strip, titled and headed like every
// neighbouring section - a risk-review finding: the bare `DecisionStrip`
// spliced in with no heading left a screen-reader user navigating by
// heading with an unannounced run of numbers between Usage and Game log.
// `hasContent` restates `DecisionStrip`'s own per-tile null checks (the
// same duplicated-on-purpose shape `GameLogSection` below already uses)
// rather than rendering an empty, still-titled Section around nothing.
function DecisionStripSection({ decision, usage, ownership, depth, rosterStatus, noHistory }) {
  const hasContent =
    (decision?.projWeek && decision.projWeek.points != null) ||
    (decision?.ros && decision.ros.points != null) ||
    decision?.upgrade?.points > 0 ||
    (usage?.seasonAverage && usage.seasonAverage.fantasyPoints != null) ||
    (ownership && ownership.percentOwned != null) ||
    (depth && depth.positionGroup && depth.rank != null) ||
    Boolean(rosterStatus);
  if (!hasContent) return null;
  return (
    <Section title="Decision strip" testId="decision-card-strip-section">
      <PsDecisionStrip
        decision={decision}
        usage={usage}
        ownership={ownership}
        depth={depth}
        rosterStatus={rosterStatus}
        noHistory={noHistory}
      />
    </Section>
  );
}

// #1358, CONTEXT.md's Season summary: "One season of a player in five
// numbers under this league's scoring: games, points per game, season
// points, position rank and ADP" - one row per `card.seasons` entry, in the
// payload's own newest-first order. Hidden entirely with no season on
// record (the card hasn't answered yet); the payload otherwise always
// carries at least the current season, even for a rookie with no rows on
// file (#1356 ruling).
function SeasonSummarySection({ seasons }) {
  if (!Array.isArray(seasons) || seasons.length === 0) return null;
  return (
    <PsSection title="Season summary" testId="decision-card-season-summary-section" pad={false}>
      <PsTable
        label="Season summary"
        testId="decision-card-seasons"
        minWidth={440}
        cols={[
          { label: 'Season' },
          { label: 'G', align: 'right' },
          { label: 'FPTS/G', align: 'right' },
          { label: 'Pts', align: 'right' },
          { label: 'Pos rank', align: 'right' },
          { label: 'ADP', align: 'right' },
        ]}
        rows={seasons.map((row) => ({
          key: row.season,
          cells: [
            row.season,
            row.games,
            formatPoints(row.pointsPerGame),
            formatPoints(row.points),
            row.posRank != null && row.posRankOf != null
              ? `${row.posRank} of ${row.posRankOf}`
              : <DashValue label="no rank on record" />,
            row.adp != null ? formatPoints(row.adp) : <DashValue label="no ADP on record" />,
          ],
        }))}
      />
    </PsSection>
  );
}

// The null-ADP/null-Pos-rank dash (#1358 issue body): a visible dash plus a
// visually hidden reason, so a screen reader gets more than silence where a
// bare "-" would pass over the cell unannounced.
function DashValue({ label }) {
  return (
    <>
      <span aria-hidden="true">-</span>
      <Box component="span" sx={visuallyHidden}>{label}</Box>
    </>
  );
}

// #1358, CONTEXT.md's Season pick: "a row of season chips under the Season
// summary; the eighteen-week bars and the game log follow it." Hidden
// entirely for a rookie (one season on record, issue AC4) - a single-option
// radiogroup would let a manager pick nothing else anyway. Each segment is
// at least 44px tall, the same `sx` override PickWeek and LineupPage's
// mobile view toggle already apply to this same shared/ui control.
function SeasonPickSection({ seasons, value, onChange }) {
  if (!Array.isArray(seasons) || seasons.length < 2) return null;
  const options = seasons.map((row) => ({ value: row.season, label: String(row.season) }));
  return (
    <Box>
      <SegmentedControl
        aria-label="Season"
        data-testid="decision-card-season-pick"
        options={options}
        value={value}
        onChange={onChange}
        sx={{ '& [role="radio"]': { minHeight: 44 } }}
      />
    </Box>
  );
}

// #1313: the two draft-pool facts the ruling calls "tiles" - ADP (the wider
// market's number, CONTEXT.md's ADP) and Best available #N (the player's own
// position in the pool's current sort order, from the `playerIds` index the
// card's own prev/next already reads - never a new server ranking). Plain
// Chips, matching the fantasy strip the room's old PlayerQuickView rendered
// for the identical facts. Hidden entirely with neither fact to show (a
// player the market has not ranked, opened outside the pool's own order).
function DraftPoolSection({ adp, poolRank }) {
  if (adp == null && poolRank == null) return null;
  return (
    <Box data-testid="decision-card-draft-pool" sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap', px: '20px', pb: '16px' }}>
      {adp != null && <RowBadge data-testid="decision-card-draft-adp">{`ADP ${adp}`}</RowBadge>}
      {poolRank != null && (
        <RowBadge data-testid="decision-card-draft-best-available">{`Best available #${poolRank}`}</RowBadge>
      )}
    </Box>
  );
}

// #1307, ADR 0040/CONTEXT.md's News: shown for every Availability context
// but the caller's own player, so the card only asks for it there; hidden
// entirely on an empty list, `entities/player`'s NewsList's own rule.
function NewsSection({ news }) {
  if (!Array.isArray(news) || news.length === 0) return null;
  return (
    <Section title="News" testId="decision-card-news-section">
      <PsNewsList news={news} />
    </Section>
  );
}

// #1307, ADR 0040: the game log is part of "every context adds ... the
// eighteen-week bars" family of additions - restated from
// `buildPlayerSummary`'s current-season weekly rows, the same producer
// PlayerQuickView's own current-season table reads. Hidden with no played
// week yet.
function GameLogSection({ log }) {
  if (!Array.isArray(log?.current) || log.current.length === 0) return null;
  return (
    <PsSection title="Game log" testId="decision-card-gamelog-section" pad={false}>
      <PsTable
        label="Game log"
        testId="decision-card-game-log"
        minWidth={440}
        cols={[{ label: 'Week' }, { label: 'Opponent' }, { label: 'Stat line' }, { label: 'FPTS', align: 'right' }]}
        rows={log.current.map((row) => ({
          key: row.week,
          cells: [`Wk ${row.week}`, row.opponent || '-', statLine(row.statLine), formatPoints(row.points)],
        }))}
      />
    </PsSection>
  );
}

// AC4: the bench players eligible for the opened player's slot, ordered by
// projection, each with its own swap (through the SAME move `onSwap`
// performs for every other action here) and a locked candidate disabled
// with the lock shown as text, matching LedgerRow's own lock treatment in
// spirit without duplicating its SVG glyph.
//
// `hidden` (formal review round 2): a best-ball lineup isn't manually
// managed at all, matching how the page hides the Start/sit panel entirely
// rather than disabling it (LineupPage.test.jsx, "best ball hides the
// Start/sit panel entirely"), so this section still hides outright in that
// case. Locked or spent no longer hides the section (round 2, r1/r3): each
// candidate's own `swapEligible` (from `benchOptionsForSlot`, itself built
// on `isEligibleMove` - the same rule `onRowClick` uses) already accounts
// for the OPENED player being locked, spent, or league-unsettled, alongside
// the candidate's own state, so passing `bestBall`/`leagueUnsettled` through
// here is what makes that true rather than a second, separate gate. AC4's
// "the lock shown" for the opened player himself is the header's Locked/
// Spent indicator, not a duplicate per-row note - that note stays reserved
// below for a locked CANDIDATE specifically, an independent fact.
function BenchOptionsSection({ entry, entries, onSwap, level, hidden, bestBall, leagueUnsettled }) {
  if (hidden) return null;
  const options = benchOptionsForSlot(entries, entry.slot, { entry, bestBall, leagueUnsettled });
  if (options.length === 0) return null;
  return (
    <Section title="Bench options" testId="decision-card-bench-options" level={level}>
      <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 0 }}>
        {options.map(({ entry: candidate, locked: candidateLocked, swapEligible }, i) => (
          <Box
            component="li"
            key={candidate.playerId}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              py: '6px',
              borderBottom: i < options.length - 1 ? '2px solid var(--ps-rule)' : 0,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
              <PosTag position={candidate.position} />
              <Typography sx={{ fontSize: '15px', fontWeight: 600 }} noWrap>{candidate.name}</Typography>
              {/* #1482, formal-002-f1: projectedPoints (the Point estimate),
                  never projection (the mean) - the same number the candidate's
                  own Ledger row headlines and the sort below orders by. */}
              <Typography sx={{ ...DIM_LINE_SX, flex: 'none' }}>{projectionLabel(candidate)}</Typography>
              {candidateLocked && (
                <Typography
                  component="span"
                  data-testid="decision-card-bench-option-lock"
                  sx={{ fontSize: '13px', fontWeight: 700, color: 'var(--ps-dim)' }}
                >
                  Locked
                </Typography>
              )}
            </Box>
            <CardButton
              disabled={!swapEligible}
              aria-label={`Swap in ${candidate.name}`}
              onClick={() =>
                onSwap?.([
                  { playerId: candidate.playerId, slot: entry.slot },
                  { playerId: entry.playerId, slot: candidate.slot },
                ])
              }
              data-testid={`decision-card-bench-swap-${candidate.playerId}`}
            >
              Swap
            </CardButton>
          </Box>
        ))}
      </Box>
    </Section>
  );
}
