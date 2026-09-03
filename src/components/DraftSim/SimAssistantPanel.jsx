import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Box, List, ListItem, Paper, Stack, Switch, Typography,
} from '@mui/material';
import PoliteRegion from '../DraftBoard/PoliteRegion';
import { useAnnouncement } from '../DraftBoard/useAnnouncement';
import { createLineGenerator, miseryStage } from '../../lib/draftAssistant';
import { templateFor } from '../../lib/draftSim/templates';
// The one shared urgency threshold (#754): SimStatusBar.jsx reads `myTurn &&
// isUrgent(secondsLeft)` off this same module, so the assistant's "is this
// urgent" question can never drift from the status bar's.
import { isUrgent } from '../../lib/onTheClock';
import { readDraftAssistantOn, writeDraftAssistantOn } from '../../lib/draftAssistantPreference';
import {
  netVsAdpFor, factsForUserPick, factsForPoolSelection,
  factsForTurnStart, factsForClockUrgent, userTeamId, SELECTION_COOLDOWN_MS,
} from './simAssistantFacts';

const SCROLLBACK_LIMIT = 20;

/**
 * The Draft assistant's Sim-venue presenter (issue #786, part of the #784
 * spec; ships first per ruling 13). Sits beside SimPickFeed in the rail, and
 * is deliberately the ONLY thing in DraftSimulator's tree that knows about
 * the assistant at all - it takes the raw `sim`/`myTurn`/`secondsLeft` the
 * simulator already has in scope and does the rest itself, so the simulator
 * never re-derives a fact this file already builds (simAssistantFacts.js).
 *
 * TRIGGERS THIS PANEL FIRES (ruling 7's Sim subset - the Sim has no Queue, so
 * QUEUE_PICKED_BY_OTHER never applies here):
 *   - TURN_START: the edge from not-my-turn to my-turn.
 *   - CLOCK_URGENT: the <=10s edge inside a turn that is still mine, once per
 *     turn (isUrgent() imported from lib/onTheClock.js, the #754 shared
 *     threshold - the same call SimStatusBar.jsx makes for its own urgent
 *     styling).
 *   - PICK_STEAL / PICK_REACH / PICK_EARLY_KDEF / PICK_RB / PICK_GENERIC /
 *     PICK_AUTO: exactly one of these, per pick, for a pick THIS panel's user
 *     team made (factsForUserPick's priority chain).
 *   - POOL_PLAYER_SELECTED: any other team's pick removing a player from the
 *     pool, throttled by SELECTION_COOLDOWN_MS so a burst of CPU picks does
 *     not flood the panel.
 *
 * THE POLITE REGION never speaks a selection line (ruling 9): PICK_* /
 * TURN_START / CLOCK_URGENT lines both render into the scrollback AND
 * announce(); POOL_PLAYER_SELECTED lines only ever render.
 *
 * A NEW PICK IS DETECTED BY COUNT, NOT BY WATCHING FOR A PROP CHANGE, because
 * `sim.picks` can grow by more than one entry in a single update ("sim to my
 * pick" applies every intervening CPU pick in one dispatch, useDraftSim.js).
 * `seenPickCountRef` is the high-water mark; on mount (including a resumed,
 * already-in-progress sim) it is seeded from the CURRENT count rather than
 * zero, so reopening or resuming a draft never replays its whole history as a
 * burst of assistant lines (ruling 12: ephemeral, a refresh clears the
 * scrollback) - mirroring the Draft room's own PickAnnouncer, whose initial
 * pick history likewise never reaches its announcer.
 *
 * The generator (src/lib/draftAssistant's createLineGenerator) is created
 * ONCE per mounted panel via a ref, so its per-draft "no repeat until the pool
 * is exhausted" tracking (ruling 2) survives across every render of one draft
 * and starts fresh for the next.
 *
 * THE POLITE REGION IS PERMANENTLY MOUNTED, never gated behind `assistantOn`
 * (pre-PR-ready accessibility review, #786): PickAnnouncer.jsx's own docblock
 * states the constraint this mirrors - "THIS region is permanently mounted…
 * which a live region must be to be observed" - and ReadinessAnnouncer.jsx
 * spells out why a gated region is unsafe either direction: assistive tech
 * generally does not announce text a live region already holds when it is
 * FIRST inserted into the DOM (a region mounted "on" already showing a stale
 * line from before it was toggled off is silently mis-read as new), and a
 * region that unmounts on toggle-off loses whatever the reader was tracking.
 * Because it is always present, the panel also explicitly clears it
 * (`announce('')`) whenever the toggle goes off, the same clear-on-exit idiom
 * StallAnnouncer.jsx uses - otherwise a later toggle-on would flash the old
 * line at mount before the next real trigger ever fires.
 */
function SimAssistantPanel({ sim, myTurn, secondsLeft, rng = Math.random }) {
  const [assistantOn, setAssistantOn] = useState(readDraftAssistantOn);
  const [scrollback, setScrollback] = useState([]);
  const [announcement, announce] = useAnnouncement();

  const lineGenRef = useRef(null);
  if (!lineGenRef.current) lineGenRef.current = createLineGenerator();
  const nextIdRef = useRef(0);
  const seenPickCountRef = useRef(null);
  const prevMyTurnRef = useRef(myTurn);
  const urgentFiredRef = useRef(false);
  const lastSelectionAtRef = useRef(null);

  const rosterSlots = useMemo(
    () => templateFor(sim.config.leagueType).slots,
    [sim.config.leagueType]
  );
  const myTeamId = useMemo(() => userTeamId(sim), [sim]);
  const netVsAdp = useMemo(() => netVsAdpFor(sim), [sim]);
  const stage = miseryStage(netVsAdp);

  const toggleAssistant = useCallback(() => {
    setAssistantOn((prev) => {
      const next = !prev;
      writeDraftAssistantOn(next);
      return next;
    });
  }, []);

  // Clears the permanently-mounted region the moment the toggle goes off, so
  // a later toggle-on never mounts-then-shows a stale line from before (see
  // the docblock above). A no-op while already off/empty - announce('') on an
  // already-empty region always lands plain (useAnnouncement.js).
  useEffect(() => {
    if (!assistantOn) announce('');
  }, [assistantOn, announce]);

  const pushLine = useCallback((facts, { spoken }) => {
    const line = facts ? lineGenRef.current(facts, rng) : null;
    if (!line) return;
    nextIdRef.current += 1;
    const id = nextIdRef.current;
    setScrollback((prev) => [{ id, trigger: line.trigger, text: line.text }, ...prev].slice(0, SCROLLBACK_LIMIT));
    if (spoken) announce(line.text);
  }, [rng, announce]);

  // Turn start, and the once-per-turn urgent clock edge inside a turn that is
  // still the user's. Both reset together: a fresh turn clears the "already
  // fired" flag for the edge that lives inside it.
  //
  // THE OFF-BRANCH RESET IS GUARDED, not unconditional (formal review finding
  // #786): urgentFiredRef must still clear when a turn genuinely ENDS while
  // the assistant is off (`!myTurn`), or the flag survives into the next turn
  // and silently suppresses that turn's whole CLOCK_URGENT line once toggled
  // back on. But it must NOT clear just because the toggle flipped off inside
  // an already-urgent turn that never ended (`myTurn` still true) - resetting
  // then would let a toggle off/then/on within that same turn fire the line a
  // second time, breaking ruling 10's "once per turn". Mirrors the identical
  // `if (!myTurn) urgentFiredRef.current = false` guard the "on" branch below
  // already uses for the same reason.
  useEffect(() => {
    if (!assistantOn) {
      if (!myTurn) urgentFiredRef.current = false;
      prevMyTurnRef.current = myTurn;
      return;
    }
    if (myTurn && !prevMyTurnRef.current) {
      urgentFiredRef.current = false;
      pushLine(factsForTurnStart({ sim }), { spoken: true });
    }
    if (!myTurn) {
      urgentFiredRef.current = false;
    } else if (isUrgent(secondsLeft) && !urgentFiredRef.current) {
      urgentFiredRef.current = true;
      pushLine(factsForClockUrgent({ sim }), { spoken: true });
    }
    prevMyTurnRef.current = myTurn;
  }, [myTurn, secondsLeft, assistantOn, sim, pushLine]);

  // Every pick landing: the user's own (announced) or another team's (a
  // cooldown-gated, never-announced "pool selection" line).
  useEffect(() => {
    const total = sim.picks.length;
    if (seenPickCountRef.current === null) {
      // First run for this mounted panel (including a resumed sim already
      // holding picks): record the baseline, announce nothing for it.
      seenPickCountRef.current = total;
      return;
    }
    if (!assistantOn) {
      // Stay caught up while off so turning the assistant back on never
      // replays picks that landed while it was silent.
      seenPickCountRef.current = total;
      return;
    }
    if (total <= seenPickCountRef.current) return;
    const newPicks = sim.picks.slice(seenPickCountRef.current);
    seenPickCountRef.current = total;

    newPicks.forEach((pick) => {
      if (pick.teamId === myTeamId) {
        const facts = factsForUserPick({ sim, pickNumber: pick.pickNumber, rosterSlots });
        pushLine(facts, { spoken: true });
        return;
      }
      const now = Date.now();
      const last = lastSelectionAtRef.current;
      if (last != null && now - last < SELECTION_COOLDOWN_MS) {
        // Genuinely attempted, genuinely suppressed: no line drawn from the
        // pool for it at all, the generator's per-trigger tracking untouched.
        return;
      }
      lastSelectionAtRef.current = now;
      const facts = factsForPoolSelection({ sim, pickNumber: pick.pickNumber });
      pushLine(facts, { spoken: false });
    });
  }, [sim, assistantOn, myTeamId, rosterSlots, pushLine]);

  return (
    <Paper component="section" aria-labelledby="sim-assistant-heading" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography id="sim-assistant-heading" variant="h6" component="h2">
          Draft assistant
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          {/* Decorative: the Switch's own checked state already carries "on"/
              "off" to assistive tech, and giving the Switch a stable
              accessible name (rather than this changing "On"/"Off" string)
              avoids the WCAG 2.5.3 Label-in-Name mismatch a FormControlLabel
              built from this text would otherwise have (accessibility
              review, #786). */}
          <Typography variant="body2" sx={{ color: 'text.secondary' }} aria-hidden="true">
            {assistantOn ? 'On' : 'Off'}
          </Typography>
          <Switch
            checked={assistantOn}
            onChange={toggleAssistant}
            inputProps={{ 'aria-label': 'Draft assistant commentary' }}
          />
        </Stack>
      </Stack>

      {assistantOn && (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 1 }}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>
              Misery Meter
            </Typography>
            <Typography variant="body2" sx={{ color: 'secondary.main', fontWeight: 700 }}>
              {stage}
            </Typography>
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
        </Box>
      )}

      <PoliteRegion text={announcement} />
    </Paper>
  );
}

export default SimAssistantPanel;
