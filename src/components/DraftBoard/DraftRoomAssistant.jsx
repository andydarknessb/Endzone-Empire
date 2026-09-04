import React, {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import {
  Box, List, ListItem, Paper, Stack, Typography, Tooltip, IconButton,
} from '@mui/material';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import VoiceOverOffIcon from '@mui/icons-material/VoiceOverOff';
import PoliteRegion from './PoliteRegion';
import { useAnnouncement } from './useAnnouncement';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { createLineGenerator, miseryStage, SELECTION_COOLDOWN_MS } from '../../lib/draftAssistant';
import { readDraftAssistantOn, writeDraftAssistantOn } from '../../lib/draftAssistantPreference';
import {
  factsForOwnPick, factsForQueueSnipe, factsForPoolBrowse,
  factsForTurnStart, factsForClockUrgent, netVsAdpFor, roundForPick,
} from './roomAssistantFacts';

/**
 * The Draft ROOM's Draft assistant presenter (issue #787, part of the #784
 * spec; ships after the Sim per ruling 13). It is the room-venue side of the
 * "pickAnnouncement.js / PickAnnouncer.jsx split": one venue-agnostic line
 * generator (src/lib/draftAssistant) driven by a room-shaped facts module
 * (roomAssistantFacts.js), fronted by thin presenter pieces here.
 *
 * WHY A CONTEXT AND NOT ONE PANEL COMPONENT (as the Sim is). The room shows the
 * assistant in TWO places at once on a wide layout - the rail scrollback panel
 * and the persistent LiveDraftBanner's latest line (ruling item 4) - and those
 * sit in different subtrees of DraftBoard. They must share ONE generator (so
 * the "no repeat until the pool is exhausted" tracking, ruling 2, is a single
 * per-draft state, not two divergent ones) and ONE polite region (ruling item
 * 4: one aria-live region). A rail panel also unmounts on a narrow layout when
 * another tab is selected, so the engine cannot live inside it or the
 * scrollback would be lost on every tab switch. So the engine lives in a
 * provider mounted once, above the tabs, in DraftBoard's chrome, and the three
 * surfaces (region, rail panel, banner line) plus the status-bar toggle are
 * thin consumers.
 *
 * WHY THE CONTEXT IS SPLIT IN TWO. `DraftRoomAssistantStateContext` carries the
 * volatile display state (scrollback, latest line, Misery band, announcement,
 * toggle state) and changes on every line; `DraftRoomAssistantControlsContext`
 * carries only stable callbacks (the toggle, and the once-per-turn clock-urgent
 * notifier). LiveDraftBanner consumes ONLY the controls half, so a line landing
 * never re-renders the banner and its PickClock leaf. And because the room JSX
 * is passed to the provider as `children` (created by DraftBoard, which does
 * not re-render on a clock tick), a line landing re-renders only the actual
 * consumers - never the player pool - which is what keeps the #754/#787
 * render-count discipline: nothing outside PickClock re-renders while the clock
 * ticks (DraftBoard.test.jsx's A7 probe).
 *
 * TRIGGERS (ruling 7's room set):
 *   - PICK_* / PICK_AUTO: the viewer's own pick landing over onPickLanded
 *     (factsForOwnPick's priority chain), announced.
 *   - QUEUE_PICKED_BY_OTHER: another team drafting a player on the viewer's
 *     Queue (a snipe), announced. Another team's pick of an UN-queued player
 *     fires nothing (ruling item 6: never reacts to other teams' ordinary
 *     picks).
 *   - TURN_START: the not-my-turn -> my-turn edge, announced.
 *   - CLOCK_URGENT: the urgent edge PickClock already computes, forwarded once
 *     per turn through onUrgent (ruling item 2: no new ticking leaf), announced.
 *   - POOL_PLAYER_BROWSED: the viewer BROWSING a player IN THE POOL TABLE (the
 *     Draft-room half of the #815 split of the old shared pool trigger; the
 *     Sim's departure meaning is now POOL_PLAYER_TAKEN and never fires here).
 *     The viewer opened a still-available player's quick view, so the line is
 *     scouting copy, never a departure elegy. Cooldown-throttled and NEVER
 *     announced (ruling item 4: the polite region never speaks a browse line).
 *     The room wraps the pool table's own onOpenQuickView (already one of
 *     PlayerPoolTable's eleven props, #792) so the table's declared interface
 *     is untouched, and gives the rail and Board the unwrapped handler - so a
 *     quick view opened from the Board or the Queue does NOT fire a browse line.
 *     Delivered here as a `poolSelection` nonce ({ id, seq }), a fresh object
 *     per table selection, so re-browsing the same player fires again.
 *
 * Never narrates Overdue: nothing here reads the Overdue edge (ruling item 6);
 * only the urgent edge is wired.
 */

const SCROLLBACK_LIMIT = 20;

const DEFAULT_STATE = {
  assistantOn: false,
  scrollback: [],
  latestLine: null,
  miseryBand: null,
  announcement: '',
};

const NOOP = () => {};
const DEFAULT_CONTROLS = { toggleAssistant: NOOP, notifyClockUrgent: NOOP };

const DraftRoomAssistantStateContext = createContext(DEFAULT_STATE);
const DraftRoomAssistantControlsContext = createContext(DEFAULT_CONTROLS);

export function useDraftRoomAssistantState() {
  return useContext(DraftRoomAssistantStateContext);
}

export function useDraftRoomAssistantControls() {
  return useContext(DraftRoomAssistantControlsContext);
}

/**
 * @param {object} props
 * @param {boolean} props.active            whether the draft is active (the
 *   assistant only works during an active draft; other statuses mount the
 *   provider but fire nothing)
 * @param {object|null} props.lastPick      newest live draft:picked payload, or
 *   null before any Pick has landed (never seeded from draft:state history)
 * @param {boolean} props.isMyTurn          whether it is the viewer's turn
 * @param {{id: number, seq: number}|null} props.poolSelection  a nonce set only
 *   when the viewer selects a player in the pool table; a fresh object per
 *   selection so re-selecting the same player fires again
 * @param {Array} props.poolRows            the currently loaded pool rows (the
 *   room's source for injury status and pool-selection facts; NOT the Misery
 *   Meter's ADP, which rides on each pick since #833)
 * @param {Array} props.queue               the viewer's Queue rows
 * @param {number} props.teamCount          teams in this draft
 * @param {number|null} props.viewerTeamId  the viewer's own Team id
 * @param {Array} props.myPicks             the viewer's picks so far ({ pickNumber, position, playerId, adp })
 * @param {Array} props.rosterSlots         the league's roster_slots shape
 * @param {number} props.draftRounds        total rounds in the draft
 * @param {number} props.currentPickNumber  the overall (1-based) pick on the clock
 * @param {() => number} [props.rng]        random source, injectable for tests
 */
export function DraftRoomAssistantProvider({
  active,
  lastPick = null,
  isMyTurn = false,
  poolSelection = null,
  poolRows = [],
  queue = [],
  teamCount = 0,
  viewerTeamId = null,
  myPicks = [],
  rosterSlots = [],
  draftRounds = 0,
  currentPickNumber = 0,
  rng = Math.random,
  children,
}) {
  const [assistantOn, setAssistantOn] = useState(readDraftAssistantOn);
  const [scrollback, setScrollback] = useState([]);
  const [announcement, announce] = useAnnouncement();

  // The one per-draft line generator (#784 ruling 2's "no repeat until the pool
  // is exhausted" tracking). A lazy useState initializer rather than a ref
  // written during render, so no ref is mutated in the render body (issue #818
  // AC3, a different ruling 2):
  // the value is created once and stays stable, and StrictMode's double render
  // never re-runs a render-phase side effect here.
  const [lineGen] = useState(() => createLineGenerator());
  const nextIdRef = useRef(0);
  const seenPickRef = useRef(null);
  const seenSelectionRef = useRef(null);
  const lastSelectionAtRef = useRef(null);
  const prevMyTurnRef = useRef(isMyTurn);
  const urgentFiredRef = useRef(false);

  // The accumulating pool lookup. The pool is windowed and a player leaves it
  // the instant they are drafted (usePlayerPool refetches on every pick), so a
  // Map that only ever GROWS is what keeps a just-picked player's injury status
  // reachable for the line that fires ON that pick. Bounded by the player
  // universe (a few hundred rows), never pruned within a draft. It is NO LONGER
  // an input to the Misery Meter (#833): the meter reads each pick's ADP off the
  // pick itself, so a keeper never delivered to the pool no longer darkens it.
  // The Map remains the source for pool-selection facts and injury status only.
  const poolByIdRef = useRef(new Map());

  // The Map is filled in an effect, never in the render body (issue #818 AC3,
  // ruling 2): a render React discards must not mutate the ref. This is the
  // FIRST passive effect declared, so it runs before the pick/turn/browse
  // effects below that read the Map through poolRowFor at fire time. No snapshot
  // state is published: the Misery memo no longer depends on the loaded pool
  // (#833), so the only reader is poolRowFor, which reads the ref at fire time.
  useEffect(() => {
    for (const row of poolRows) {
      if (row && row.id != null) poolByIdRef.current.set(row.id, row);
    }
  }, [poolRows]);

  const poolRowFor = useCallback((id) => (id == null ? undefined : poolByIdRef.current.get(id)), []);

  // Net vs ADP over the viewer's OWN picks (ruling 8, the Misery Meter). Each
  // pick carries its own market ADP as `pick.adp` (delivered from the server on
  // the pick, #833), so the sum never depends on the windowed player pool and
  // the meter is correct in a keeper league. Always a number: with any picks it
  // is their running total (a null-ADP pick contributes 0 through the shared
  // no-market rule, ruling 3); with zero picks it is 0 (ruling 4). The band is
  // therefore always shown once the viewer has the assistant on - the
  // hidden-until-complete state and its placeholder retired with this ticket.
  const netVsAdp = useMemo(
    () => netVsAdpFor({ myPicks, teamCount }),
    [myPicks, teamCount]
  );
  const miseryBand = miseryStage(netVsAdp);

  // Latest values the stable callbacks below read at fire time. Written in a
  // layout effect, not the render body (issue #818 AC3, ruling 2), so a
  // discarded render never mutates the ref; the layout phase runs before any
  // event handler or passive effect fires, so notifyClockUrgent still reads
  // this render's facts, and notifyClockUrgent keeps a stable identity
  // (LiveDraftBanner must not re-render on it).
  const liveRef = useRef({});
  useLayoutEffect(() => {
    liveRef.current = {
      active, isMyTurn, assistantOn, teamCount, draftRounds, currentPickNumber, netVsAdp,
    };
  });

  const pushLine = useCallback((facts, { spoken }) => {
    const line = facts ? lineGen(facts, rng) : null;
    if (!line) return;
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setScrollback((prev) => [{ id, trigger: line.trigger, text: line.text }, ...prev].slice(0, SCROLLBACK_LIMIT));
    if (spoken) announce(line.text);
  }, [lineGen, rng, announce]);

  // Clears the permanently-mounted region the moment the toggle goes off, so a
  // later toggle-on never re-shows a stale line before the next real trigger
  // (the SimAssistantPanel #786 idiom). A no-op on an already-empty region.
  useEffect(() => {
    if (!assistantOn) announce('');
  }, [assistantOn, announce]);

  const toggleAssistant = useCallback(() => {
    setAssistantOn((prev) => {
      const next = !prev;
      writeDraftAssistantOn(next);
      return next;
    });
  }, []);

  // The urgent clock edge, forwarded once per turn from PickClock's onUrgent
  // (ruling item 2: reuse the edge it already computes, no new ticking leaf).
  // Stable identity via liveRef, so LiveDraftBanner (which passes this to
  // PickClock) never re-renders when a line lands. Gated to the viewer's own
  // turn - PickClock also runs on other teams' clocks - and to once per turn by
  // urgentFiredRef, which the turn-edge effect below resets.
  const notifyClockUrgent = useCallback(() => {
    const live = liveRef.current;
    if (!live.active || !live.assistantOn || !live.isMyTurn) return;
    if (urgentFiredRef.current) return;
    urgentFiredRef.current = true;
    pushLine(
      factsForClockUrgent({
        pickNumber: live.currentPickNumber,
        round: roundForPick(live.currentPickNumber, live.teamCount),
        draftRounds: live.draftRounds,
        netVsAdp: live.netVsAdp,
      }),
      { spoken: true }
    );
  }, [pushLine]);

  // The viewer's own pick, or a Queue snipe. Keyed on the payload's identity
  // (a fresh object per live Pick), so an ordinary rerender never re-fires it,
  // and initial Pick history - which arrives on draft:state, not through
  // lastPick - is never replayed. seenPickRef advances even while the toggle is
  // off, so turning it on does not replay the pick that landed while silent.
  useEffect(() => {
    if (!active || !lastPick) return;
    if (seenPickRef.current === lastPick) return;
    seenPickRef.current = lastPick;
    if (!assistantOn) return;

    const playerId = lastPick.player?.id;
    const poolRow = poolRowFor(playerId);

    if (viewerTeamId != null && lastPick.teamId === viewerTeamId) {
      const priorMyPicks = myPicks
        .filter((p) => p.pickNumber < lastPick.pickNumber)
        .map((p) => ({ pickNumber: p.pickNumber, position: p.position }));
      pushLine(
        factsForOwnPick({
          pick: lastPick, priorMyPicks, rosterSlots, teamCount, draftRounds, poolRow, netVsAdp,
        }),
        { spoken: true }
      );
      return;
    }

    // Another team's pick: ONLY a Queue snipe speaks. An ordinary pick of a
    // player the viewer had not queued fires nothing at all (ruling item 6).
    const sniped = queue.some((q) => q.id === playerId);
    if (!sniped) return;
    pushLine(
      factsForQueueSnipe({
        pick: lastPick, teamCount, draftRounds, poolRow, netVsAdp,
      }),
      { spoken: true }
    );
    // netVsAdp/myPicks/etc. are read at fire time; deps list them so the effect
    // closes over the current render's values.
  }, [lastPick, active, assistantOn, viewerTeamId, queue, myPicks, rosterSlots, teamCount, draftRounds, netVsAdp, poolRowFor, pushLine]);

  // Turn start, and the per-turn reset for the urgent edge. The urgent line
  // itself fires through notifyClockUrgent above; this effect only speaks the
  // start line and clears urgentFiredRef on each turn boundary so the next
  // turn's urgent edge can fire once. urgentFiredRef is never cleared merely
  // because the toggle changed inside a turn that never ended, so a toggle
  // off/on within one urgent turn cannot fire the urgent line twice.
  useEffect(() => {
    if (!active) {
      prevMyTurnRef.current = isMyTurn;
      return;
    }
    const startedTurn = isMyTurn && !prevMyTurnRef.current;
    if (startedTurn || !isMyTurn) urgentFiredRef.current = false;
    if (startedTurn && assistantOn) {
      pushLine(
        factsForTurnStart({
          pickNumber: currentPickNumber,
          round: roundForPick(currentPickNumber, teamCount),
          draftRounds,
          netVsAdp,
        }),
        { spoken: true }
      );
    }
    prevMyTurnRef.current = isMyTurn;
  }, [isMyTurn, active, assistantOn, currentPickNumber, teamCount, draftRounds, netVsAdp, pushLine]);

  // The viewer browsing a player in the pool table (POOL_PLAYER_BROWSED, #815),
  // never announced (ruling item 4) and cooldown-throttled. Keyed on the nonce's
  // identity - a fresh object per pool-table selection - so a rerender never
  // re-fires and a Board/Queue quick view (which does not set poolSelection at
  // all) fires nothing. seenSelectionRef advances even while off, so turning
  // the toggle on never replays the browse made while it was silent.
  useEffect(() => {
    if (!poolSelection) return;
    if (seenSelectionRef.current === poolSelection) return;
    seenSelectionRef.current = poolSelection;
    if (!active || !assistantOn) return;

    const now = Date.now();
    const last = lastSelectionAtRef.current;
    if (last != null && now - last < SELECTION_COOLDOWN_MS) return;
    lastSelectionAtRef.current = now;
    pushLine(
      factsForPoolBrowse({
        poolRow: poolRowFor(poolSelection.id), teamCount, draftRounds, netVsAdp,
      }),
      { spoken: false }
    );
  }, [poolSelection, active, assistantOn, teamCount, draftRounds, netVsAdp, poolRowFor, pushLine]);

  const stateValue = useMemo(
    () => ({
      assistantOn,
      scrollback,
      latestLine: scrollback.length > 0 ? scrollback[0].text : null,
      miseryBand,
      announcement,
    }),
    [assistantOn, scrollback, miseryBand, announcement]
  );

  const controlsValue = useMemo(
    () => ({ toggleAssistant, notifyClockUrgent }),
    [toggleAssistant, notifyClockUrgent]
  );

  return (
    <DraftRoomAssistantControlsContext.Provider value={controlsValue}>
      <DraftRoomAssistantStateContext.Provider value={stateValue}>
        {children}
      </DraftRoomAssistantStateContext.Provider>
    </DraftRoomAssistantControlsContext.Provider>
  );
}

/** The one polite aria-live region for the room assistant (ruling item 4).
 * Permanently mounted in the Draft-room chrome beside the other announcers
 * (PickAnnouncer, StallAnnouncer): a live region must be mounted to be
 * observed, and the provider clears it on toggle-off. It never speaks a
 * selection line, because those are pushed to the scrollback with spoken:false
 * and so never reach announce(). */
export function DraftRoomAssistantRegion() {
  const { announcement } = useDraftRoomAssistantState();
  return <PoliteRegion text={announcement} />;
}

/** The desktop rail panel: the assistant's scrollback with the Misery Meter
 * (ruling item 4, ruling 8). Renders NOTHING when the toggle is off (ruling
 * item 1: the panel answers "do I have anything to say"), which is also why
 * railComposition can list it unconditionally in the active composition while
 * an off toggle leaves the rail exactly as it was (AC5). */
export function DraftRoomAssistantPanel() {
  const { assistantOn, scrollback, miseryBand } = useDraftRoomAssistantState();
  const headingId = useId();
  if (!assistantOn) return null;
  return (
    <Paper component="section" aria-labelledby={headingId} sx={{ p: 2, mb: 3 }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography id={headingId} variant="h6" component="h2">
          Draft assistant
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="baseline">
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>
            Misery Meter
          </Typography>
          <Typography variant="body2" sx={{ color: 'secondary.main', fontWeight: 700 }}>
            {miseryBand}
          </Typography>
        </Stack>
      </Stack>
      {scrollback.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Quiet so far. Make a pick.
        </Typography>
      ) : (
        <List dense disablePadding aria-label="Draft assistant commentary">
          {scrollback.map((entry, index) => (
            <ListItem key={entry.id} disableGutters sx={{ py: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: index === 0 ? 700 : 400 }}>
                {entry.text}
              </Typography>
            </ListItem>
          ))}
        </List>
      )}
    </Paper>
  );
}

/** The mobile surface: the latest assistant line inside LiveDraftBanner (ruling
 * item 4). Visual only, never a live region (the provider owns the one polite
 * region), so it may show a selection line the region does not speak. Renders
 * nothing when the toggle is off or nothing has been said yet. */
export function DraftRoomAssistantBannerLine() {
  const { assistantOn, latestLine } = useDraftRoomAssistantState();
  if (!assistantOn || !latestLine) return null;
  return (
    <Box sx={{ width: '100%', mt: 1 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
        {latestLine}
      </Typography>
    </Box>
  );
}

/** The per-device toggle, sitting in DraftStatusBar's controls group beside the
 * on-the-clock sound toggle - the other per-device localStorage control (ruling
 * 11 reuses draftSoundPreference's shape). A stable accessible name with
 * aria-pressed carrying on/off avoids the WCAG 2.5.3 Label-in-Name mismatch a
 * changing "On"/"Off" name would have, exactly as the sound toggle does. */
export function DraftRoomAssistantToggle() {
  const { assistantOn } = useDraftRoomAssistantState();
  const { toggleAssistant } = useDraftRoomAssistantControls();
  const label = 'Draft assistant commentary';
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        aria-pressed={assistantOn}
        onClick={toggleAssistant}
        sx={MIN_TOUCH_TARGET_SX}
      >
        {assistantOn ? <RecordVoiceOverIcon fontSize="small" /> : <VoiceOverOffIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
