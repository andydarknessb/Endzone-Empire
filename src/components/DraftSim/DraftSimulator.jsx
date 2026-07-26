import React, { useMemo, useState } from 'react';
import {
  Box, CircularProgress, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import useDraftSim from './useDraftSim';
import SimConfigForm from './SimConfigForm';
import SimStatusBar from './SimStatusBar';
import SimPlayerPool from './SimPlayerPool';
import SimPickFeed from './SimPickFeed';
import SimReport from './SimReport';
import DraftBoardMatrix from '../DraftBoard/DraftBoardMatrix';
import {
  availablePlayers, toBoardShape, currentRound,
} from '../../lib/draftSim/engine';
import { templateFor } from '../../lib/draftSim/templates';

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

  const template = templateFor(sim.config.leagueType);

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

      {!myTurn && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }} aria-live="polite">
          <CircularProgress size={16} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {onTheClock ? `${onTheClock.name} is on the clock…` : 'Wrapping up…'}
          </Typography>
        </Stack>
      )}

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
              onTheClock={board.onTheClock}
              rosterLimit={board.rosterLimit}
              readOnly
            />
          )}
          {tab === 'roster' && (
            <SimPickFeed
              picks={sim.picks.filter((pick) => (teamsById.get(pick.teamId) || {}).isUser)}
              teamsById={teamsById}
              playersById={playersById}
              teamCount={sim.teams.length}
              limit={sim.rounds}
            />
          )}
        </Box>
        <Box sx={{ width: { xs: '100%', lg: 340 }, flexShrink: 0 }}>
          <SimPickFeed
            picks={sim.picks}
            teamsById={teamsById}
            playersById={playersById}
            teamCount={sim.teams.length}
          />
        </Box>
      </Stack>
    </Box>
  );
}

export default DraftSimulator;
