import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  Box, FormControlLabel, List, ListItem, Paper, Stack, Switch, Typography,
} from '@mui/material';
import PoliteRegion from '../DraftBoard/PoliteRegion';
import { useAnnouncement } from '../DraftBoard/useAnnouncement';
import { createLineGenerator, miseryStage } from '../../lib/draftAssistant';
import { templateFor } from '../../lib/draftSim/templates';
import { readDraftAssistantOn, writeDraftAssistantOn } from '../../lib/draftAssistantPreference';
import {
  isUrgent, netVsAdpFor, factsForUserPick, factsForPoolSelection,
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
 *     turn (isUrgent() below matches the reading already inline in
 *     SimStatusBar.jsx).
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
  useEffect(() => {
    if (!assistantOn) {
      prevMyTurnRef.current = myTurn;
      return;
    }
    if (myTurn && !prevMyTurnRef.current) {
      urgentFiredRef.current = false;
      pushLine(factsForTurnStart({ sim }), { spoken: true });
    }
    if (!myTurn) {
      urgentFiredRef.current = false;
    } else if (isUrgent({ myTurn, secondsLeft }) && !urgentFiredRef.current) {
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
    <Paper component="section" aria-label="Draft assistant" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h6">Draft assistant</Typography>
        <FormControlLabel
          control={(
            <Switch
              checked={assistantOn}
              onChange={toggleAssistant}
              inputProps={{ 'aria-label': 'Draft assistant' }}
            />
          )}
          label={assistantOn ? 'On' : 'Off'}
          labelPlacement="start"
        />
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

          <PoliteRegion text={announcement} />
        </Box>
      )}
    </Paper>
  );
}

export default SimAssistantPanel;
