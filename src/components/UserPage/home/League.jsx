import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box } from '@mui/material';
import { Frame, PsLink, pixelSx } from '../../../shared/ui/playselect';

// League links always run in this order and keep only the ones the league has.
const LINK_ORDER = ['Matchup', 'Lineup', 'Picks', 'Waivers', 'Dashboard'];

/**
 * A league's links in the fixed order Matchup, Lineup, Picks, Waivers, Dashboard,
 * whatever order they arrive in. Pinned to the bottom of its tile or panel
 * (margin-top: auto) over a 2px rule.
 */
export function LeagueLinks({
  league, links = [], onBoard = false,
}) {
  const ordered = LINK_ORDER.map((label) => links.find((l) => l.label === label)).filter(Boolean);
  if (!ordered.length) return null;
  return (
    <Box
      component="nav"
      aria-label={league}
      sx={onBoard
        ? {
          display: 'flex', flexWrap: 'wrap', margin: 'auto -10px -6px', paddingTop: '4px', borderTop: '2px solid var(--ps-board-rule)',
        }
        : {
          marginTop: 'auto', display: 'flex', flexWrap: 'wrap', padding: '4px 6px', borderTop: '2px solid var(--ps-rule)',
        }}
    >
      {ordered.map((l) => (
        <PsLink key={l.label} to={l.to} onBoard={onBoard} ariaLabel={`${league} ${l.label.toLowerCase()}`}>
          {l.label}
        </PsLink>
      ))}
    </Box>
  );
}

/** One league on the team-data screen: a framed panel with a header (name, right-hand note), a body and its links. */
export function LeaguePanel({
  name, right, children, links, id, to,
}) {
  const title = to
    ? <Box component={RouterLink} to={to} sx={{ color: 'inherit', textDecoration: 'none' }}>{name}</Box>
    : name;
  return (
    <Frame
      component="article"
      labelledBy={id}
      sx={{ display: 'flex', flexDirection: 'column' }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '4px 12px',
          padding: { xs: '12px 14px', md: '12px 16px' },
          borderBottom: '2px solid var(--ps-rule)',
        }}
      >
        <Box component="h3" id={id} sx={{ m: 0, ...pixelSx(16), color: 'var(--ps-ink)' }}>{title}</Box>
        {right && <Box component="span" sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>{right}</Box>}
      </Box>
      <Box sx={{ padding: { xs: '14px', md: '16px' }, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {children}
      </Box>
      {links}
    </Frame>
  );
}
