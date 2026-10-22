import React, { useId } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import {
  ErrorPanel, Frame, FrameHead, LiveChip, OddsBar, PixelArrow, PixelHeading, pixelSx, PsLink, Skel, SR_ONLY_SX, StatusChip, TeamMark,
} from '../../../shared/ui/playselect';
import useAroundTheLeague from '../model/useAroundTheLeague';

/**
 * League Dashboard Around the league widget (ADR 0067 wave 1b): the week's other matchups as small
 * tiles in a tertiary frame (2px edge, Pixel 16 heading). The viewer's own matchup is the page's
 * Matchup panel, so it is not repeated here; a viewer with no Team of their own sees every matchup.
 *
 * A tile is framed before kickoff (Proj figures, a Frame-colour odds bar), Board black once started
 * (the leader white, the trailer dim; the odds bar green only while live) and a result when settled.
 * Each tile is one link to its matchup, named by a sentence that states both sides, the figures and
 * the win probability. Win probability is the entity board's (#2142), the figure Game Center reads.
 *
 * Game day (any matchup started) folds the strip to the viewer's three rival games, the ones whose
 * teams stand nearest the viewer, and every state ends in an "All matchups in Game Center" tile.
 * Below md the tiles scroll sideways inside the frame, a named, focusable region.
 *
 * The matchups read is the frame's spine: loading holds three skeleton tiles, and a failed read is
 * one danger panel with a way to retry. Paints only ps-* tokens.
 */

const SKELETON_COUNT = 3;
const TILE_W = '280px';

function pluralMatchups(count, rival) {
  return `${count} ${rival ? 'rival ' : ''}matchup${count === 1 ? '' : 's'}`;
}

const figureWords = (tile) => `${tile.first.figure} to ${tile.second.figure}`;

function tileLabel(tile, pct) {
  const sides = `${tile.first.name} against ${tile.second.name}`;
  const prob = pct == null ? '' : `, ${pct}% win probability for ${tile.first.name}`;
  if (tile.final) return `${sides}, final, ${figureWords(tile)}`;
  if (tile.live) return `${sides}, live, ${figureWords(tile)}${prob}`;
  if (tile.started) return `${sides}, ${figureWords(tile)}${prob}`;
  return `${sides}, ${tile.scheduled ? 'projected' : 'score'} ${figureWords(tile)}${prob}`;
}

export default function AroundTheLeague({ leagueId }) {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const {
    status, tiles, count, gameDay, tailLabel, refetch,
  } = useAroundTheLeague(leagueId);
  const headingId = useId();

  if (status === 'hidden') return null;
  if (status === 'ready' && tiles.length === 0) return null;

  if (status === 'error') {
    return (
      <Box data-testid="around-the-league">
        <ErrorPanel
          title="Around the league"
          body="We could not load this week's matchups right now."
          onRetry={refetch}
          retryAriaLabel="Try loading the matchups again"
        />
      </Box>
    );
  }

  const ready = status === 'ready';
  // Three columns (four on game day), but never more than there are cells (the tiles and the All
  // cell), so a week with two rival matchups fills the row instead of leaving a bare column.
  const columns = ready ? Math.max(1, Math.min(gameDay ? 4 : 3, tiles.length + 1)) : gameDay ? 4 : 3;

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="around-the-league"
      aria-busy={status === 'loading'}
      head={(
        <FrameHead>
          <PixelHeading id={headingId} size={16}>Around the league</PixelHeading>
          {ready && (
            <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>
              {`${pluralMatchups(count, gameDay)} · win probability · `}
              <Box component="span" sx={{ whiteSpace: 'nowrap' }}>Endzone Forecast</Box>
            </Box>
          )}
          <Box component="span" sx={{ marginLeft: 'auto' }}>
            <PsLink to={`/league/${leagueId}/game-center`}>{ready ? `${tailLabel} · Game Center` : 'Game Center'}</PsLink>
          </Box>
        </FrameHead>
      )}
    >
      <Box
        component={ready ? 'ul' : 'div'}
        role={ready ? 'list' : undefined}
        tabIndex={compact && ready ? 0 : undefined}
        aria-label={compact && ready ? "This week's matchups" : undefined}
        data-testid="around-the-league-body"
        data-layout={compact ? 'scroll' : 'grid'}
        sx={{
          listStyle: 'none',
          m: 0,
          padding: { xs: '14px', md: '20px' },
          display: compact ? 'flex' : 'grid',
          gridTemplateColumns: compact ? undefined : `repeat(${columns}, minmax(0, 1fr))`,
          gap: { xs: '12px', md: '16px' },
          overflowX: compact ? 'auto' : 'visible',
          scrollSnapType: compact ? 'x mandatory' : undefined,
        }}
      >
        {status === 'loading'
          && Array.from({ length: SKELETON_COUNT }, (_, i) => <SkeletonTile key={`skeleton-${i}`} compact={compact} />)}

        {ready && tiles.map((tile, index) => (
          <Box
            component="li"
            key={tile.id != null ? tile.id : `index-${index}`}
            sx={{ minWidth: 0, flex: compact ? `0 0 ${TILE_W}` : undefined, scrollSnapAlign: compact ? 'start' : undefined }}
          >
            <Tile
              tile={tile}
              to={tile.id != null ? `/league/${leagueId}/matchups/${tile.id}` : `/league/${leagueId}/game-center`}
            />
          </Box>
        ))}

        {ready && (
          <Box component="li" sx={{ minWidth: 0, flex: compact ? '0 0 200px' : undefined, scrollSnapAlign: compact ? 'start' : undefined }}>
            <Box
              component={RouterLink}
              to={`/league/${leagueId}/game-center`}
              data-testid="around-the-league-all"
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxSizing: 'border-box',
                height: '100%',
                minHeight: '88px',
                border: '2px dashed var(--ps-frame)',
                color: 'inherit',
                fontSize: '15px',
                fontWeight: 600,
                textAlign: 'center',
                textDecoration: 'none',
              }}
            >
              All matchups in Game Center
              <PixelArrow />
            </Box>
          </Box>
        )}
      </Box>
    </Frame>
  );
}

const tileBase = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: '14px',
  boxSizing: 'border-box',
  height: '100%',
  minWidth: 0,
  textDecoration: 'none',
};

function WinLine({ pct, name, colors }) {
  return (
    <Box sx={{ fontSize: '13px', color: colors.dim }}>
      <Box component="b" sx={{ color: colors.ink }}>{`${pct}%`}</Box>
      {` ${name}`}
    </Box>
  );
}

function Tile({ tile, to }) {
  const pct = tile.firstShare != null ? Math.round(tile.firstShare * 100) : null;
  const board = tile.started;
  const colors = board
    ? { ink: 'var(--ps-board-ink)', dim: 'var(--ps-board-dim)' }
    : { ink: 'var(--ps-ink)', dim: 'var(--ps-dim)' };
  const decided = tile.first.points != null && tile.second.points != null && tile.first.points !== tile.second.points;
  const leader = decided ? (tile.first.points > tile.second.points ? tile.first : tile.second) : null;
  const margin = decided ? Math.abs(tile.first.points - tile.second.points).toFixed(1) : null;
  const figureLabel = tile.scheduled ? 'Projected' : 'Score';
  const leads = (side) => !board || leader == null || leader === side;

  return (
    <Box
      component={RouterLink}
      to={to}
      aria-label={tileLabel(tile, pct)}
      data-testid="around-the-league-tile"
      data-matchup-id={tile.id}
      data-state={tile.live ? 'live' : tile.settled ? 'final' : tile.started ? 'started' : 'scheduled'}
      sx={{
        ...tileBase,
        color: colors.ink,
        backgroundColor: board ? 'var(--ps-board)' : 'var(--ps-panel)',
        border: `2px solid ${board ? 'var(--ps-board-dim)' : 'var(--ps-frame)'}`,
      }}
    >
      {board ? (
        <Box component="span" sx={{ alignSelf: 'flex-start' }}>
          {tile.live ? <LiveChip onBoard /> : <StatusChip onBoard>{tile.final ? 'Final' : 'Awaiting final'}</StatusChip>}
        </Box>
      ) : (
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            margin: '-4px 0 -6px', textAlign: 'right', fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: colors.dim,
          }}
        >
          {tile.scheduled ? 'Proj' : 'Score'}
        </Box>
      )}
      <TileRow side={tile.first} testId="around-the-league-tile-home" figureLabel={figureLabel} colors={colors} dim={board && !leads(tile.first)} />
      <TileRow side={tile.second} testId="around-the-league-tile-away" figureLabel={figureLabel} colors={colors} dim={board && !leads(tile.second)} />
      {pct != null && tile.live && (
        <>
          <OddsBar pct={pct} live onBoard label={false} name={tile.first.name} />
          <WinLine pct={pct} name={tile.first.name} colors={colors} />
        </>
      )}
      {pct != null && !board && (
        <>
          <OddsBar pct={pct} label={false} name={tile.first.name} />
          <WinLine pct={pct} name={tile.first.name} colors={colors} />
        </>
      )}
      {board && !tile.live && leader && (
        <Box sx={{ fontSize: '13px', color: colors.dim }}>
          <Box component="b" sx={{ color: colors.ink, fontWeight: 600 }}>{leader.name}</Box>
          {` won by ${margin}`}
        </Box>
      )}
    </Box>
  );
}

function TileRow({
  side, testId, figureLabel, colors, dim,
}) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, color: dim ? colors.dim : colors.ink }}>
      <TeamMark name={side.name} avatarUrl={side.avatarUrl} avatarStaticUrl={side.avatarStaticUrl} />
      <Box component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '15px', fontWeight: 600 }}>{side.name}</Box>
      <Box component="span" data-testid="around-the-league-figure" sx={{ ...pixelSx(16), flex: 'none' }}>
        <Box component="span" sx={SR_ONLY_SX}>{`${figureLabel} `}</Box>
        {side.figure === '-' ? (
          <>
            <Box component="span" aria-hidden="true">-</Box>
            <Box component="span" sx={SR_ONLY_SX}>Not available</Box>
          </>
        ) : side.figure}
      </Box>
    </Box>
  );
}

function SkeletonTile({ compact }) {
  return (
    <Box
      sx={{
        flex: compact ? `0 0 ${TILE_W}` : undefined,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '14px',
        boxSizing: 'border-box',
        border: '2px solid var(--ps-rule)',
      }}
    >
      <Skel width="70%" height={20} />
      <Skel width="70%" height={20} />
      <Skel width="100%" height={12} />
    </Box>
  );
}
