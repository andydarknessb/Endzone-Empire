import React, {
  useEffect, useId, useMemo, useRef,
} from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import {
  CpuTag, ErrorPanel, Frame, FrameHead, LiveChip, OddsBar, PixelArrow, PixelHeading, pixelSx, PsButton, Skel, SR_ONLY_SX, StatusChip, TeamMark, YouTag,
} from '../../../shared/ui/playselect';
import { formatInstant } from '../../../shared/lib';

/**
 * The dashboard's own Play-select view of the matchup read (ADR 0067 ruling 2): the matchup-preview
 * widget keeps its current look for the Lineup page until its wave, and this view renders the same
 * model (`useMatchupPreview`, exported from the widget's index) in the new one.
 *
 * Before kickoff it is a framed versus panel: both team names in Pixel 16, projected figures in Pixel
 * 32 (24 on a phone), pivoting on a pixel VS in Ink on the figures' baseline, the odds bar in Frame
 * colour, the projected margin, the stored narrative and a "Matchup" link. Once the matchup has started it is the Board-black scoreboard scaled up: the score
 * block is one link to the matchup, the leader white and the trailer dim, the margin under the
 * viewer's score, the Expected final and players remaining per side, a full-width odds bar (green
 * only while live) and, under the LIVE chip, "As of {time}" when the page knows one. A visually hidden
 * polite live region carries the score sentence, so a changed score is announced (a new stamp or a new
 * Expected final alone is not). A changed score remounts an inner wrapper with the `scored` class, which
 * flashes it; the link itself stays put, so keyboard focus survives a score event. Nothing else animates.
 */

const MARGIN_SX = pixelSx(16);

function useScoredFlash(label) {
  const previous = useRef(null);
  const changed = previous.current !== null && previous.current !== label;
  useEffect(() => {
    previous.current = label;
  }, [label]);
  return changed;
}

function Side({
  side, you, right, lead, colors, label, under, note, expected, figure,
}) {
  return (
    <Box data-testid={you ? 'matchup-side-viewer' : 'matchup-side-opponent'} sx={{ minWidth: 0, textAlign: { xs: 'left', sm: right ? 'right' : 'left' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexDirection: { xs: 'row', sm: right ? 'row-reverse' : 'row' } }}>
        <Box sx={{ color: colors.ink, display: 'inline-flex' }}>
          <TeamMark name={side.name} avatarUrl={side.avatarUrl} avatarStaticUrl={side.avatarStaticUrl} />
        </Box>
        <Box component="h3" sx={{ m: 0, minWidth: 0, ...pixelSx(16), color: colors.ink, overflowWrap: 'anywhere' }}>{side.name}</Box>
      </Box>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: colors.dim, justifyContent: { xs: 'flex-start', sm: right ? 'flex-end' : 'flex-start' },
        }}
      >
        {side.isCpu && <CpuTag color={colors.ink} />}
        {you && <YouTag color={colors.ink} />}
        {label}
      </Box>
      <Box
        data-testid={you ? 'matchup-figure-viewer' : 'matchup-figure-opponent'}
        sx={{
          ...pixelSx(32), fontSize: { xs: '24px', md: '32px' }, lineHeight: 1.2, marginTop: '4px', color: lead ? colors.ink : colors.dim,
        }}
      >
        {figure}
      </Box>
      {under !== undefined && (
        <Box sx={{ ...MARGIN_SX, color: colors.ink, marginTop: '8px', minHeight: '24px', whiteSpace: 'nowrap' }}>{under}</Box>
      )}
      {expected && (
        <Box sx={{ fontSize: '15px', color: colors.dim, marginTop: '8px' }}>
          Expected final
          {' '}
          <Box component="b" sx={{ fontWeight: 600, color: colors.ink, whiteSpace: 'nowrap' }}>{expected}</Box>
        </Box>
      )}
      {note && <Box sx={{ fontSize: '14px', color: colors.dim, marginTop: '4px' }}>{note}</Box>}
    </Box>
  );
}

function PreKickoffBody({ leagueId, model }) {
  const {
    matchupId, viewer, opponent, game, narrative, lastWeek,
  } = model;
  const pct = game.projectedWinProbability?.viewerPct ?? null;
  const figure = (projected) => {
    if (projected.loading) return <Skel data-testid="matchup-skeleton" width="96px" height={32} />;
    return projected.value ?? <><span aria-hidden="true">-</span><Box component="span" sx={SR_ONLY_SX}>Not available</Box></>;
  };
  const colors = { ink: 'var(--ps-ink)', dim: 'var(--ps-dim)' };
  return (
      <Box sx={{ padding: { xs: '14px', md: '24px' }, display: 'flex', flexDirection: 'column', gap: { xs: '16px', md: '24px' }, flex: 1 }}>
        <Box
          data-testid="matchup-versus"
          sx={{
            display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto minmax(0, 1fr)' }, gap: '16px 8px', alignItems: 'end',
          }}
        >
          <Side side={viewer} you lead colors={colors} label="Proj" figure={figure(viewer.projected)} />
          <Box component="span" data-testid="matchup-vs" sx={{ ...pixelSx(32), fontSize: { xs: '24px', md: '32px' }, lineHeight: 1.2, color: colors.ink }}>vs</Box>
          <Side side={opponent} right lead colors={colors} label="Proj" figure={figure(opponent.projected)} />
        </Box>
        {pct != null && <OddsBar pct={pct} name={viewer.name} />}
        {(game.projectedMargin || narrative || lastWeek) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {game.projectedMargin && (
              <Box data-testid="matchup-projected-margin" sx={{ fontSize: '16px', fontWeight: 700 }}>{game.projectedMargin}</Box>
            )}
            {narrative && (
              <Box component="p" data-testid="matchup-preview-narrative" sx={{ m: 0, fontSize: '15px', color: colors.dim }}>{narrative}</Box>
            )}
            {lastWeek && (
              <Box component="p" data-testid="matchup-postgame-narrative" sx={{ m: 0, fontSize: '15px', color: colors.dim }}>
                <Box component="b" sx={{ fontWeight: 600 }}>Last week</Box>
                {' '}
                {lastWeek.narrative}
              </Box>
            )}
          </Box>
        )}
        <Box>
          <PsButton
            variant="ghost"
            to={`/league/${leagueId}/matchups/${matchupId}`}
            ariaLabel={`Matchup, ${viewer.name} against ${opponent.name}`}
          >
            Matchup
          </PsButton>
        </Box>
      </Box>
  );
}

const num = (value) => {
  const n = Number(value);
  return value == null || value === '' || !Number.isFinite(n) ? null : n;
};

function Scoreboard({
  leagueId, model, headingId, asOf,
}) {
  const {
    week, matchupId, viewer, opponent, game,
  } = model;
  const colors = { ink: 'var(--ps-board-ink)', dim: 'var(--ps-board-dim)' };
  const mine = num(viewer.score);
  const theirs = num(opponent.score);
  const youLead = mine != null && theirs != null ? mine >= theirs : true;
  const margin = mine != null && theirs != null ? Math.abs(mine - theirs).toFixed(1) : null;
  const pct = game.winProbability?.viewerPct ?? null;
  const time = asOf ? formatInstant(asOf, 'time') : null;
  const live = game.isLive;
  const remaining = (n) => (n == null ? null : `${n} ${n === 1 ? 'player' : 'players'} remaining`);
  // Rebuilt only when a name or a score changes, so the live region (and its time) repeat only then.
  const sentence = useMemo(
    () => `${viewer.name} ${viewer.score ?? '-'}, ${opponent.name} ${opponent.score ?? '-'}${time ? `, as of ${time}` : ''}`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewer.name, viewer.score, opponent.name, opponent.score]
  );
  const label = [
    `Matchup: ${viewer.name} ${youLead ? 'lead' : 'trail'} ${opponent.name} ${viewer.score ?? '-'} to ${opponent.score ?? '-'}`,
    viewer.expectedFinal && opponent.expectedFinal ? `expected final ${viewer.expectedFinal} to ${opponent.expectedFinal}` : null,
    pct != null ? `${pct}% ${viewer.name} win probability` : null,
  ].filter(Boolean).join(', ')
    + (viewer.playersRemaining != null && opponent.playersRemaining != null
      ? `. PMR, players remaining: ${viewer.playersRemaining} for ${viewer.name} and ${opponent.playersRemaining} for ${opponent.name}`
      : '');
  const flashed = useScoredFlash(label);

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="matchup-preview"
      data-state={live ? 'live' : 'settled'}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: { xs: '14px', md: '18px' },
        boxSizing: 'border-box',
        backgroundColor: 'var(--ps-board)',
        color: 'var(--ps-board-ink)',
        border: '6px double var(--ps-board-dim)',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '8px 16px' }}>
        <PixelHeading id={headingId}>{`Week ${week} Matchup`}</PixelHeading>
        <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          {live ? <LiveChip onBoard /> : <StatusChip onBoard>{game.chipLabel || 'Final'}</StatusChip>}
          {time && <Box component="span" data-testid="matchup-as-of" sx={{ fontSize: '13px', color: colors.dim }}>{`As of ${time}`}</Box>}
        </Box>
      </Box>
      <Box component="p" aria-live="polite" data-testid="matchup-live-region" sx={{ m: 0, ...SR_ONLY_SX }}>{sentence}</Box>
      <Box
        component={RouterLink}
        to={`/league/${leagueId}/matchups/${matchupId}`}
        aria-label={label}
        data-testid="matchup-versus"
        sx={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
      >
        {/* A changed score changes the label, which remounts this wrapper and restarts the flash. */}
        <Box key={label} className={flashed ? 'scored' : undefined} sx={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: { xs: '16px', md: '24px' }, alignItems: 'start' }}>
          <Side
            side={viewer}
            you
            lead={youLead}
            colors={colors}
            label={live ? 'Live score' : 'Final score'}
            figure={viewer.score ?? '-'}
            under={margin ? `${live ? (youLead ? 'Up' : 'Down') : (youLead ? 'Won by' : 'Lost by')} ${margin}` : ''}
            expected={viewer.expectedFinal}
            note={live ? remaining(viewer.playersRemaining) : null}
          />
          <Side
            side={opponent}
            right
            lead={!youLead}
            colors={colors}
            label={live ? 'Live score' : 'Final score'}
            figure={opponent.score ?? '-'}
            under=""
            expected={opponent.expectedFinal}
            note={live ? remaining(opponent.playersRemaining) : null}
          />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '16px', width: '100%' }}>
          {pct != null && (
            <Box sx={{ width: '100%' }}>
              <OddsBar pct={pct} live={live} onBoard name={viewer.name} />
            </Box>
          )}
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 600 }}>
            Matchup
            <PixelArrow />
          </Box>
        </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function VersusPanel({ leagueId, model, asOf }) {
  const headingId = useId();
  const {
    week, status, game, refetch,
  } = model;
  const title = week != null ? `Week ${week} Matchup` : 'Matchup';

  if (status === 'error') {
    return (
      <Box data-testid="matchup-preview">
        <ErrorPanel
          title={title}
          body="We could not load this week's matchup right now."
          onRetry={refetch}
          retryAriaLabel="Try loading the matchup again"
        />
      </Box>
    );
  }

  if (status === 'ready' && game.hasStarted === true) {
    return <Scoreboard leagueId={leagueId} model={model} headingId={headingId} asOf={asOf} />;
  }

  // One frame for every state before kickoff (loading, no matchup, the pre-kickoff panel), so it
  // stays the same element while the read lands.
  return (
    <Frame
      labelledBy={headingId}
      data-testid="matchup-preview"
      aria-busy={status === 'loading' || model.busy}
      sx={{ display: 'flex', flexDirection: 'column' }}
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>{title}</PixelHeading>
          {status === 'ready' && game.hasStarted === false && <StatusChip>Scheduled</StatusChip>}
        </FrameHead>
      )}
    >
      {status === 'ready' && <PreKickoffBody leagueId={leagueId} model={model} />}
      {status === 'loading' && (
        <Box aria-hidden="true" sx={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Skel data-testid="matchup-skeleton" width="60%" height={24} />
          <Skel data-testid="matchup-skeleton" width="40%" height={32} />
          <Skel data-testid="matchup-skeleton" width="100%" height={12} />
        </Box>
      )}
      {status === 'empty' && (
        <Box
          component="p"
          data-testid="matchup-preview-empty"
          sx={{ m: 0, padding: '24px 20px', flex: 1, display: 'flex', alignItems: 'center', fontSize: '16px', fontWeight: 600 }}
        >
          No matchup this week
        </Box>
      )}
    </Frame>
  );
}
