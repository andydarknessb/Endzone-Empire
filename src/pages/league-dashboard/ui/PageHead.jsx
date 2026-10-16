import React from 'react';
import { Box } from '@mui/material';
import { LiveChip, PixelHeading, StatusChip } from '../../../shared/ui/playselect';
import { formatInstant } from '../../../shared/lib';

/**
 * The page head every league page shares (DESIGN.md "League pages"): the pixel h1 (the league name),
 * a chip row (the phase chip, a team-count chip outside the live season, "Draft Complete" on a
 * finished fantasy league, and the Live chip on game day), then an Archivo dim line, "Times in CDT"
 * and nothing else. The phase chip is neutral: green is for live state only. `right` is the
 * commissioner's Invite control. A plain layout row, not a header element: a top-level header maps to
 * the banner landmark, which the app shell's app bar already owns.
 */
export default function PageHead({
  title, chips = [], live, right,
}) {
  const zone = formatInstant(new Date(), 'zone') || 'your time zone';
  return (
    <Box
      data-testid="dashboard-head"
      sx={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px 24px',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
        <PixelHeading level={1}>{title}</PixelHeading>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px' }}>
          {chips.map((chip) => <StatusChip key={chip}>{chip}</StatusChip>)}
          {live && <LiveChip>{live}</LiveChip>}
          <Box component="p" sx={{ m: 0, fontSize: '17px', color: 'var(--ps-dim)' }}>{`Times in ${zone}`}</Box>
        </Box>
      </Box>
      {right && <Box>{right}</Box>}
    </Box>
  );
}
