import React from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelHeading, PixelWarn, PsButton, Skel,
} from '../../../shared/ui/playselect';

// The States board (docs/design/league/States.dc.html): skeleton blocks in Skel on the page layout,
// square and still, so reduced motion needs no extra path; and "League unavailable", the whole-page
// failure, an h1, one alerted sentence and a way out.

function SkelRows({ rows }) {
  return (
    <Box sx={{ padding: '8px 20px 12px' }}>
      {Array.from({ length: rows }, (_, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex', alignItems: 'center', gap: '12px', height: '44px', borderBottom: i < rows - 1 ? '2px solid var(--ps-rule)' : 0,
          }}
        >
          <Skel width="28px" height={28} />
          <Skel width="34%" height={16} />
          <Box sx={{ flex: 1 }} />
          <Skel width="48px" height={16} />
        </Box>
      ))}
    </Box>
  );
}

function SkelFrame({ headWidth, rows }) {
  return (
    <Frame component="div" head={<FrameHead><Skel width={headWidth} height={24} /></FrameHead>}>
      <SkelRows rows={rows} />
    </Frame>
  );
}

/** The first load: the head, Your move's three plays and the standings and activity, held in Skel. */
export function DashboardLoading() {
  return (
    <Box
      data-testid="dashboard-loading"
      aria-busy="true"
      role="status"
      aria-label="Loading league"
      sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Skel width="min(520px, 100%)" height={40} />
        <Skel width="min(340px, 100%)" height={20} />
      </Box>
      <Frame component="div" head={<FrameHead><Skel width="180px" height={24} /></FrameHead>}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: '8px', padding: '12px' }}>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ padding: '8px', border: '4px solid transparent' }}>
              <Box sx={{ backgroundColor: 'var(--ps-skel)', height: '168px', opacity: 0.6 }} />
            </Box>
          ))}
        </Box>
      </Frame>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.55fr) minmax(0, 1fr)' }, gap: '24px' }}>
        <SkelFrame headWidth="160px" rows={5} />
        <SkelFrame headWidth="200px" rows={5} />
      </Box>
    </Box>
  );
}

/** A failed league read is a dead end for the whole route: the h1 the loaded page has, one alerted sentence and a way out. */
export function DashboardUnavailable({ onRetry }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'flex-start' }}>
      <PixelHeading level={1}>League unavailable</PixelHeading>
      <Box role="alert" sx={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '17px' }}>
        <PixelWarn color="var(--ps-danger)" />
        We could not load this league right now.
      </Box>
      <PsButton variant="ghost" onClick={onRetry}>Try again</PsButton>
    </Box>
  );
}
