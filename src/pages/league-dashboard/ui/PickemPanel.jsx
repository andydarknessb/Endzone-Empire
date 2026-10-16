import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  ErrorPanel, Frame, FrameHead, PixelHeading, pixelSx, PsLink, Skel,
} from '../../../shared/ui/playselect';
import { usePickemStandingsTable } from '../../../widgets/pickem-standings';
import { ordinal } from '../../../shared/lib';

const rankLabel = (viewer) => (viewer.tied ? `T-${viewer.rank}` : ordinal(viewer.rank) || String(viewer.rank));

function Stat({ label, big, testid, children }) {
  return (
    <Box data-testid={testid} sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{label}</Box>
      <Box
        component="span"
        sx={big
          ? { ...pixelSx(24), lineHeight: 1.3, whiteSpace: 'nowrap' }
          : { fontSize: '16px', fontWeight: 600, whiteSpace: 'nowrap' }}
      >
        {children}
      </Box>
    </Box>
  );
}

/**
 * The Pick'em panel of a fantasy plus pick'em league (ADR 0067 ruling 8): a tertiary frame holding the
 * viewer's own row of the season standings (the same read as the Pick'em page, through the
 * pickem-standings widget's model) - their rank and season points in Pixel 24 like My team's record,
 * this week's points so far and how far behind the leader they are - and a "Picks" link to the Pick'em
 * page. The panel is the dashboard's own Play-select view: the widget keeps its look for the Pick'em
 * page until its wave. It renders nothing while the viewer has no row (no picks scored yet).
 */
export default function PickemPanel({ leagueId, week }) {
  const { status, viewer, behindLeader } = usePickemStandingsTable(leagueId);
  const headingId = useId();

  if (status === 'error') {
    return (
      <Box data-testid="pickem-panel">
        <ErrorPanel title="Pick'em" body="We could not load the Pick'em standings right now." />
      </Box>
    );
  }
  if (status === 'ready' && !viewer) return null;

  const thisWeek = viewer && week != null && viewer.weekly ? viewer.weekly[week] : undefined;
  const loading = status === 'loading';

  return (
    <Frame
      tier="rule"
      labelledBy={headingId}
      data-testid="pickem-panel"
      aria-busy={loading}
      head={(
        <FrameHead>
          <PixelHeading id={headingId} size={16}>{"Pick'em"}</PixelHeading>
          <Box component="span" sx={{ marginLeft: 'auto' }}>
            <PsLink to={`/league/${leagueId}/pickem`} ariaLabel={week != null ? `Pick'em picks, Week ${week}` : "Pick'em picks"}>Picks</PsLink>
          </Box>
        </FrameHead>
      )}
    >
      <Box
        sx={{
          padding: { xs: '12px 14px', md: '14px 20px' },
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
          gap: '12px',
        }}
      >
        {loading || !viewer ? (
          <>
            <Skel width="64px" height={40} />
            <Skel width="64px" height={40} />
            <Skel width="64px" height={40} />
            <Skel width="64px" height={40} />
          </>
        ) : (
          <>
            <Stat label="Your rank" big testid="pickem-panel-rank">{rankLabel(viewer)}</Stat>
            <Stat label="Points" big testid="pickem-panel-points">{viewer.points ?? '-'}</Stat>
            <Stat label={week != null ? `Wk ${week}` : 'This week'} testid="pickem-panel-week">{thisWeek == null ? '-' : thisWeek}</Stat>
            <Stat label="Behind leader" testid="pickem-panel-behind">
              {behindLeader == null ? '-' : behindLeader === 0 ? 'Leader' : `${Math.abs(behindLeader)} pts`}
            </Stat>
          </>
        )}
      </Box>
    </Frame>
  );
}
