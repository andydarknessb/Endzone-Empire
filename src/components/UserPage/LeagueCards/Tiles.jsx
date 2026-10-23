import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { OddsBar, PixelArrow, pixelSx } from '../../../shared/ui/playselect';
import { LeagueLinks } from './League';

// The live scoreboard on Board black, with the 6px double rule in Board dim.
const tileSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  padding: { xs: '14px', md: '16px' },
  backgroundColor: 'var(--ps-board)',
  color: 'var(--ps-board-ink)',
  border: '6px double var(--ps-board-dim)',
  minWidth: 0,
};

const scoreBlockSx = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  color: 'inherit',
  textDecoration: 'none',
};

const cueSx = {
  display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '15px', fontWeight: 600,
};

const noteSx = { fontSize: '13px', color: 'var(--ps-board-dim)', mt: '4px' };

function Side({
  side, label, color, align,
}) {
  return (
    <Box sx={{ minWidth: 0, textAlign: align }}>
      <Box sx={{ fontSize: '14px', color: 'var(--ps-board-dim)', overflowWrap: 'anywhere' }}>{label}</Box>
      <Box sx={{
        ...pixelSx(32), fontSize: { xs: '24px', md: '32px' }, lineHeight: 1.2, color,
      }}
      >
        {side.score}
      </Box>
      {side.note && <Box sx={noteSx}>{side.note}</Box>}
    </Box>
  );
}

/**
 * A live matchup: the score block is one link to the matchup (its aria label
 * states the whole score), the league's other links sit under it. `scored`
 * flashes the block when a refresh changed the score.
 */
export function ScoreTile({
  league, status, you, opp, youLeads, margin, pct, to, ariaLabel, links, extra, scored = false,
}) {
  return (
    <Box component="article" sx={tileSx}>
      <Box component="h3" sx={{ m: 0, ...pixelSx(16), color: 'var(--ps-board-ink)' }}>{league}</Box>
      {status && <Box sx={{ fontSize: '14px', color: 'var(--ps-board-dim)', mt: '-6px' }}>{status}</Box>}
      <Box
        // The label states the whole score, so a changed score remounts the block and restarts the flash.
        key={ariaLabel}
        component={RouterLink}
        to={to}
        className={scored ? 'scored' : undefined}
        aria-label={ariaLabel}
        sx={scoreBlockSx}
      >
        <Box sx={{
          display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'end', gap: '12px',
        }}
        >
          <Side
            side={you}
            label={you.name || 'You'}
            color={youLeads ? 'var(--ps-board-ink)' : 'var(--ps-board-dim)'}
            align="left"
          />
          <span />
          <Side
            side={opp}
            label={opp.name}
            color={youLeads ? 'var(--ps-board-dim)' : 'var(--ps-board-ink)'}
            align="right"
          />
        </Box>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <Box component="span" sx={{ ...pixelSx(16), color: 'var(--ps-board-ink)' }}>{margin}</Box>
          <Box component="span" sx={cueSx}>
            Matchup
            <PixelArrow />
          </Box>
        </Box>
        <OddsBar pct={pct} live onBoard />
      </Box>
      {extra}
      <LeagueLinks league={league} links={links} onBoard />
    </Box>
  );
}

/** A pick'em league on the same board: one pixel figure (points, or a record) and a "Picks" cue as the link. */
export function PickemTile({
  league, mode = "Confidence pick'em", standing, figure, figureLabel, note, to, ariaLabel, links,
}) {
  return (
    <Box component="article" sx={tileSx}>
      <Box component="h3" sx={{ m: 0, ...pixelSx(16), color: 'var(--ps-board-ink)' }}>{league}</Box>
      <Box sx={{ fontSize: '14px', color: 'var(--ps-board-dim)', mt: '-6px' }}>
        {mode}
        {standing ? ` · ${standing}` : ''}
      </Box>
      <Box component={RouterLink} to={to} aria-label={ariaLabel} sx={{ ...scoreBlockSx, gap: '6px' }}>
        <Box
          component="span"
          sx={{
            ...pixelSx(32), fontSize: { xs: '24px', md: '32px' }, lineHeight: 1.2, color: 'var(--ps-board-ink)',
          }}
        >
          {figure}
        </Box>
        <Box component="span" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <Box component="span" sx={{ fontSize: '15px', color: 'var(--ps-board-dim)' }}>{figureLabel}</Box>
          <Box component="span" sx={cueSx}>
            Picks
            <PixelArrow />
          </Box>
        </Box>
        {note && <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-board-dim)' }}>{note}</Box>}
      </Box>
      <LeagueLinks league={league} links={(links || []).filter((l) => l.label !== 'Picks')} onBoard />
    </Box>
  );
}
