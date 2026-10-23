import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import {
  LiveChip, NumbersHelp, PixelArrow, PixelClock, PixelHeading, Skel,
} from '../../../shared/ui/playselect';
import PickWeek from '../../../features/pick-week';

const CRUMB_SX = {
  minHeight: '44px',
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0 10px',
  fontSize: '15px',
  fontWeight: 600,
  color: 'var(--ps-ink)',
  textDecoration: 'underline',
  textDecorationThickness: '2px',
  textUnderlineOffset: '5px',
  textDecorationColor: 'var(--ps-dim)',
};

/**
 * The breadcrumb, restyled (spec #2334 ruling 1): "Leagues / {league} / Game Center" with 44px link targets
 * and pixel arrows between them. A nav landmark holding a list; the league crumb waits for the row. Below
 * `sm` the current page is dropped (the h1 says it) so no trailing separator wraps (Critique 9).
 */
function Breadcrumb({ leagueId, leagueName, compact }) {
  const sep = <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex', color: 'var(--ps-dim)' }}><PixelArrow /></Box>;
  return (
    <Box component="nav" aria-label="Breadcrumb" data-testid="game-center-breadcrumb">
      <Box component="ol" role="list" sx={{ listStyle: 'none', m: '0 0 0 -10px', p: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        <Box component="li" sx={{ display: 'flex', alignItems: 'center' }}>
          <Box component={RouterLink} to="/league" sx={CRUMB_SX}>Leagues</Box>
          {sep}
        </Box>
        {leagueName && (
          <Box component="li" sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <Box component={RouterLink} to={`/league/${leagueId}`} sx={CRUMB_SX}>{leagueName}</Box>
            {!compact && sep}
          </Box>
        )}
        {!compact && (
          <Box component="li" aria-current="page" sx={{ ...CRUMB_SX, textDecoration: 'none', color: 'var(--ps-dim)' }}>Game Center</Box>
        )}
      </Box>
    </Box>
  );
}

/** The sync line: a pixel clock and one Archivo line in the dim tier ("Scores synced 2:38 PM · refreshes every minute"). */
function SyncLine({ text }) {
  return (
    <Box data-testid="game-center-sync" sx={{ m: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: { xs: '16px', sm: '17px' }, color: 'var(--ps-dim)' }}>
      <PixelClock />
      <span>{text}</span>
    </Box>
  );
}

/** The terms "What the numbers mean" defines (Critique 10 item 15, Critique 11 item 9). */
const TERMS = [
  ['Proj', "A lineup's points before its games are played, from Endzone Forecast, our projection engine."],
  ['Expected final', "Points so far plus the projected points still to come: a starter's projection times the share of his game left, or all of it before his game starts."],
  ['Players remaining', "Starters whose NFL game isn't final. Out starters and empty slots don't count. Before kickoff it reads \"starters set to play\"."],
  ['Yet to play', "The players remaining whose NFL game hasn't started."],
  ['Win probability', "Your chance to win the matchup from both lineups' projected finals (Endzone Forecast). It sharpens as games finish."],
  ['Projected margin', 'How far one lineup is projected to finish ahead of the other: the gap between the two Proj totals before kickoff, between the two Expected finals once games are live.'],
];

/**
 * The Game Center head: the breadcrumb, the pixel h1 with the Live chip on its row (only while a matchup of
 * the week is live; the hero carries the other one), the sync line under it, the week picker beside them
 * (one tab stop, full width below `sm`), then the closed "What the numbers mean" disclosure on its own row so
 * the DOM order is the visual order (Critique 11 item 14).
 */
export default function GameCenterHead({
  leagueId, leagueName, compact, live, syncLine, pending, weeks, week, onWeek,
}) {
  return (
    <Box component="section" aria-labelledby="game-center-h1" sx={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
      <Breadcrumb leagueId={leagueId} leagueName={leagueName} compact={compact} />
      <Box
        data-testid="game-center-header"
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'stretch', md: 'center' },
          justifyContent: 'space-between',
          gap: { xs: '12px', md: '16px 24px' },
          minWidth: 0,
        }}
      >
        <Box data-testid="game-center-title" sx={{ display: 'grid', gap: '12px' }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 20px' }}>
            <PixelHeading id="game-center-h1" level={1}>Game Center</PixelHeading>
            {live && <LiveChip />}
          </Box>
          {syncLine && <SyncLine text={syncLine} />}
        </Box>
        {pending ? (
          <Box data-testid="game-center-loading-picker" aria-busy="true" sx={{ display: 'flex', justifyContent: { md: 'flex-end' }, minWidth: 0, width: { xs: '100%', md: 460 } }}>
            <Skel data-testid="skeleton" width="100%" height={44} />
          </Box>
        ) : (
          <Box sx={{ minWidth: 0 }}>
            <PickWeek weeks={weeks} value={week ?? 'All'} onChange={onWeek} fill={compact} />
          </Box>
        )}
      </Box>
      <NumbersHelp terms={TERMS} />
    </Box>
  );
}
