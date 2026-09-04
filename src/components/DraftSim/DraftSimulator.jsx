import React, { useMemo, useState } from 'react';
import {
  Box, CircularProgress, Stack, Tab, Tabs,
} from '@mui/material';
import useDraftSim from './useDraftSim';
import SimConfigForm from './SimConfigForm';
import SimStatusBar from './SimStatusBar';
import SimTurnStatus from './SimTurnStatus';
import SimPlayerPool from './SimPlayerPool';
import SimPickFeed from './SimPickFeed';
import SimAssistantPanel from './SimAssistantPanel';
import SimReport from './SimReport';
import DraftBoardMatrix from '../DraftBoard/DraftBoardMatrix';
import RosterPanel from '../RosterPanel/RosterPanel';
import RosterNeedsStrip from '../RosterPanel/RosterNeedsStrip';
import {
  availablePlayers, toBoardShape, currentRound,
} from '../../lib/draftSim/engine';
import { templateFor, SIM_BENCH_SLOTS } from '../../lib/draftSim/templates';
import { assignRosterSlots } from '../../lib/rosterAssignment';
import { turnSummaryFor, pickLabelFor } from '../../lib/draftTurns';
import { deriveOnTheClock } from '../../lib/onTheClock';

/**
 * The whole Draft Simulator, deliberately tree-agnostic: it imports no
 * apiClient, no redux, and no router. That is what lets one component serve
 * both the public (logged-out) page and the authed one — and it's asserted by a
 * guard test that renders this with no providers at all.
 *
 * Phases: config -> room -> report.
 */
function DraftSimulator({ showCta = false }) {
  const {
    sim, phase, myTurn, secondsLeft, onTheClock, report,
    poolLoading, poolError, savedSummary,
    start, resume, discardSaved, draftPlayer, simToMyPick, restart,
  } = useDraftSim();
  const [tab, setTab] = useState('players');

  // Hoisted above the early returns below: every hook after this depends on it,
  // and hooks cannot sit under a conditional return.
  const template = sim ? templateFor(sim.config.leagueType) : null;

  const available = useMemo(() => (sim ? availablePlayers(sim) : []), [sim]);
  const board = useMemo(() => (sim ? toBoardShape(sim) : null), [sim]);
  const teamsById = useMemo(
    () => new Map((sim ? sim.teams : []).map((team) => [team.id, team])),
    [sim]
  );
  const playersById = useMemo(
    () => new Map((sim ? sim.players : []).map((player) => [player.playerId, player])),
    [sim]
  );

  // The user's picks in the shape the roster components speak: the sim keeps
  // picks lean (no round, no player fields), so player data is joined here.
  const myPicks = useMemo(() => {
    if (!sim) return [];
    const me = sim.teams.find((team) => team.isUser);
    if (!me) return [];
    return sim.picks
      .filter((pick) => pick.teamId === me.id)
      .map((pick) => {
        const player = playersById.get(pick.playerId) || {};
        return {
          pickNumber: pick.pickNumber,
          // sim pick numbers are 1-based, draftTurns is 0-based.
          pickLabel: pickLabelFor(pick.pickNumber - 1, sim.teams.length),
          playerId: pick.playerId,
          name: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          auto: !!pick.auto,
        };
      });
  }, [sim, playersById]);

  // ONE assignment feeds the panel, the needs strip and both pick feeds' slot
  // tags. A second derivation could disagree, because a later pick can re-home
  // an earlier one out of a flex slot.
  const myAssignment = useMemo(
    () => assignRosterSlots({
      picks: myPicks,
      rosterSlots: template ? template.slots : [],
      benchCount: SIM_BENCH_SLOTS,
      irCount: 0,
    }),
    [myPicks, template]
  );

  const turn = useMemo(() => {
    if (!sim) return null;
    const me = sim.teams.find((team) => team.isUser);
    return turnSummaryFor({
      teamId: me ? me.id : null,
      teamIds: sim.teams.map((team) => team.id),
      fromPick0: sim.currentPick - 1,
      totalPicks: sim.totalPicks,
      rotation: 'snake',
    });
  }, [sim]);

  if (phase === 'config') {
    return (
      <SimConfigForm
        onStart={start}
        loading={poolLoading}
        error={poolError}
        savedSummary={savedSummary}
        onResume={resume}
        onDiscardSaved={discardSaved}
      />
    );
  }

  if (phase === 'report') {
    return (
      <SimReport report={report} config={sim.config} onRestart={restart} showCta={showCta} />
    );
  }

  return (
    <Box>
      <SimStatusBar
        round={currentRound(sim)}
        rounds={sim.rounds}
        pickNumber={Math.min(sim.currentPick, sim.totalPicks)}
        totalPicks={sim.totalPicks}
        onTheClockName={onTheClock ? onTheClock.name : null}
        myTurn={myTurn}
        secondsLeft={secondsLeft}
        clockSeconds={sim.config.clockSeconds}
        onSimToMyPick={simToMyPick}
        onRestart={restart}
      />

      {/* The room's one turn-status region (#805, #819, ADR 0028): mounted on
          BOTH turns, never gated behind myTurn, announcing politely on this axis
          - mirrors LiveDraftBanner's status region in the Draft room
          (src/components/DraftBoard/LiveDraftBanner.jsx, #445 AC3). The region
          mounts empty and fills its turn text from an effect keyed on the pick
          identity (#819): SimTurnStatus owns that, so the first turn is
          announced rather than mounting already holding its text. The turn
          identity is sim.currentPick, never the derived string, so a snake
          turnaround (same team, two consecutive picks, byte-identical text) is
          still heard. The assistant's own polite region (SimAssistantPanel.jsx)
          is a separate, sanctioned axis (ADR 0028) that may also speak on a turn
          change when it's toggled on - this region's job is only to make sure a
          turn change is heard at all when the assistant is off. The spinner is
          decorative (aria-hidden) and stays off-turn only; it sits beside the
          region, not inside it, so it never becomes part of the announced text. */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
        {!myTurn && <CircularProgress size={16} aria-hidden="true" />}
        <SimTurnStatus
          turnKey={sim.currentPick}
          text={myTurn ? 'Your pick!' : onTheClock ? `${onTheClock.name} is on the clock…` : 'Wrapping up…'}
        />
      </Stack>

      <Tabs
        value={tab}
        onChange={(_event, value) => setTab(value)}
        sx={{ mb: 2 }}
        aria-label="Draft room views"
      >
        <Tab value="players" label="Players" />
        <Tab value="board" label="Board" />
        <Tab value="roster" label="My team" />
      </Tabs>

      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems="flex-start">
        <Box sx={{ flexGrow: 1, width: '100%', minWidth: 0 }}>
          {tab === 'players' && (
            <SimPlayerPool
              players={available}
              includeIdp={template.needsIdp}
              onDraft={draftPlayer}
              myTurn={myTurn}
            />
          )}
          {tab === 'board' && (
            <DraftBoardMatrix
              teams={board.teams}
              picks={board.picks}
              // The shared matrix reads the On-the-clock value (#754); the sim
              // engine keeps its own flat team, so derive at this seam. The sim
              // clock is drawn by SimStatusBar, so the board value is untimed.
              onTheClock={deriveOnTheClock({ team: board.onTheClock, active: true })}
              draftRounds={board.draftRounds}
              readOnly
            />
          )}
          {tab === 'roster' && (
            <Stack spacing={2}>
              <RosterNeedsStrip
                rosterSlots={template.slots}
                benchCount={SIM_BENCH_SLOTS}
                irCount={0}
                picks={myPicks}
                remainingPicks={turn.remainingPicks}
                nextPickLabel={turn.nextPick ? turn.nextPick.label : null}
              />
              <RosterPanel
                rosterSlots={template.slots}
                benchCount={SIM_BENCH_SLOTS}
                irCount={0}
                picks={myPicks}
                rounds={sim.rounds}
                title="My roster"
              />
              <SimPickFeed
                picks={sim.picks.filter((pick) => (teamsById.get(pick.teamId) || {}).isUser)}
                teamsById={teamsById}
                playersById={playersById}
                teamCount={sim.teams.length}
                limit={sim.rounds}
                label="Your picks in order"
                slotTags={myAssignment.byPickNumber}
              />
            </Stack>
          )}
        </Box>
        <Stack sx={{ width: { xs: '100%', lg: 340 }, flexShrink: 0 }} spacing={2}>
          <SimPickFeed
            picks={sim.picks}
            teamsById={teamsById}
            playersById={playersById}
            teamCount={sim.teams.length}
            slotTags={myAssignment.byPickNumber}
          />
          <SimAssistantPanel sim={sim} myTurn={myTurn} secondsLeft={secondsLeft} />
        </Stack>
      </Stack>
    </Box>
  );
}

export default DraftSimulator;
