import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  ErrorPanel, Frame, FrameHead, PixelArrow, PixelHeading, pixelSx, Skel, SR_ONLY_SX, TeamMark, YouTag,
} from '../../../shared/ui/playselect';
import { usePickemStandingsTable } from '../../../widgets/pickem-standings';
import { ordinal } from '../../../shared/lib';

// Eighteen weekly cells (the widget's own heat strip): a fill height by bucket, the best week outlined.
const HEAT_HEIGHT = { h1: 25, h2: 50, h3: 75, h4: 100 };
const HEAT_WEEKS = 18;

const TREND = {
  up: ['M5 1h2v2H5zM3 3h6v2H3zM1 5h10v2H1z', 'Trend: improved'],
  down: ['M1 3h10v2H1zM3 5h6v2H3zM5 7h2v2H5z', 'Trend: declined'],
  flat: ['M2 5h8v2H2z', 'Trend: unchanged'],
};

const rankLabel = (row) => (row.tied ? `T-${row.rank}` : String(row.rank));

const cellSx = (align = 'left', extra = null) => ({
  boxSizing: 'border-box',
  height: '44px',
  padding: '0 12px',
  textAlign: align,
  whiteSpace: 'nowrap',
  fontSize: '15px',
  fontVariantNumeric: 'tabular-nums',
  ...extra,
});

const headSx = (align = 'left', extra = null) => ({
  boxSizing: 'border-box',
  height: '40px',
  padding: '0 12px',
  textAlign: align,
  backgroundColor: 'var(--ps-panel)',
  borderBottom: '2px solid var(--ps-rule)',
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: 'var(--ps-dim)',
  whiteSpace: 'nowrap',
  ...extra,
});

function Tile({ label, testid, children }) {
  return (
    <Box
      data-testid={testid}
      sx={{
        display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '150px', padding: '10px 16px', boxSizing: 'border-box', border: '2px solid var(--ps-rule)',
      }}
    >
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{label}</Box>
      <Box component="span" sx={{ ...pixelSx(24), lineHeight: 1.3 }}>{children}</Box>
    </Box>
  );
}

function AccuracyBar({ accuracy, me }) {
  const pct = accuracy == null ? null : Math.max(0, Math.min(100, Math.round(accuracy * 100)));
  const on = pct == null ? 0 : Math.round(pct / 10);
  const fill = me ? 'var(--ps-play-ink)' : 'var(--ps-frame)';
  const line = me ? 'var(--ps-play-dim)' : 'var(--ps-dim)';
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
      <Box
        data-testid="pickem-standings-accuracy-bar"
        {...(pct == null ? { role: 'img', 'aria-label': 'No decided picks yet' } : { 'aria-hidden': 'true' })}
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(10, 8px)', gap: '2px' }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <Box
            key={i}
            component="span"
            sx={{ height: '12px', boxSizing: 'border-box', ...(i < on ? { backgroundColor: fill } : { border: `2px solid ${line}` }) }}
          />
        ))}
      </Box>
      <Box component="span" sx={{ minWidth: '40px' }}>{pct == null ? '-' : `${pct}%`}</Box>
    </Box>
  );
}

function heatLabel(cell, currentWeek) {
  if (cell.points != null) return `Week ${cell.week}: ${cell.points} points${cell.isBest ? ', best week' : ''}`;
  if (currentWeek == null || cell.week > currentWeek) return `Week ${cell.week}: not played yet`;
  return `Week ${cell.week}: no picks made`;
}

function HeatStrip({ heat, currentWeek, me }) {
  const fill = me ? 'var(--ps-play-ink)' : 'var(--ps-frame)';
  const track = me ? 'var(--ps-play-field)' : 'var(--ps-field)';
  const line = me ? 'var(--ps-play-dim)' : 'var(--ps-dim)';
  return (
    <Box data-testid="pickem-standings-heat" sx={{ display: 'flex', gap: '3px', padding: '2px 0' }}>
      {(heat || []).map((cell) => (
        <Box
          key={cell.week}
          role="img"
          aria-label={heatLabel(cell, currentWeek)}
          data-week={cell.week}
          data-bucket={cell.bucket || 'not-played'}
          data-best={cell.isBest || undefined}
          data-testid="pickem-standings-heat-cell"
          sx={{
            position: 'relative',
            display: 'block',
            width: '12px',
            height: '12px',
            boxSizing: 'border-box',
            border: `1px solid ${line}`,
            backgroundColor: track,
            overflow: 'hidden',
            outline: cell.isBest ? `2px solid ${fill}` : 0,
            outlineOffset: '1px',
          }}
        >
          {cell.bucket && (
            <Box
              component="span"
              sx={{
                position: 'absolute', left: 0, right: 0, bottom: 0, height: `${HEAT_HEIGHT[cell.bucket]}%`, backgroundColor: fill,
              }}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}

function Row({ row, currentWeek }) {
  const me = row.isViewer;
  const base = {
    backgroundColor: me ? 'var(--ps-play)' : 'var(--ps-panel)',
    color: me ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
    borderBottom: `2px solid ${me ? 'var(--ps-play-field)' : 'var(--ps-rule)'}`,
  };
  const thisWeek = currentWeek != null && row.weekly ? row.weekly[currentWeek] : undefined;
  const trend = row.trend ? TREND[row.trend] : null;
  return (
    <Box
      component="tr"
      data-testid={me ? 'pickem-standings-you-row' : `pickem-standings-row-${row.teamId ?? row.teamName}`}
      data-viewer-team={me || undefined}
      aria-current={me ? 'true' : undefined}
    >
      <Box
        component="td"
        sx={cellSx('left', {
          ...base, position: 'sticky', left: 0, zIndex: 1, width: 64, minWidth: 64, fontWeight: 600,
        })}
      >
        <span data-testid="pickem-standings-rank">{rankLabel(row)}</span>
      </Box>
      <Box component="th" scope="row" sx={cellSx('left', { ...base, fontWeight: 600 })}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Box component="span" aria-hidden="true" sx={{ width: '12px', flex: 'none', display: 'inline-flex' }}>{me && <PixelArrow />}</Box>
          <TeamMark name={row.teamName} avatarUrl={row.avatarUrl} avatarStaticUrl={row.avatarStaticUrl} />
          <span>{row.teamName}</span>
          {me && <YouTag />}
        </Box>
      </Box>
      <Box component="td" sx={cellSx('right', base)}><b>{row.points}</b></Box>
      <Box component="td" sx={cellSx('right', base)}>{thisWeek == null ? '-' : thisWeek}</Box>
      <Box component="td" sx={cellSx('right', base)}>{row.correct}</Box>
      <Box component="td" sx={cellSx('right', base)}>{row.incorrect}</Box>
      <Box component="td" sx={cellSx('right', base)}>{row.pending}</Box>
      <Box component="td" sx={cellSx('left', base)}><AccuracyBar accuracy={row.accuracy} me={me} /></Box>
      <Box component="td" sx={cellSx('left', base)}><HeatStrip heat={row.heat} currentWeek={currentWeek} me={me} /></Box>
      <Box component="td" sx={cellSx('right', base)}>
        {trend ? (
          <>
            <Box component="svg" width="12" height="12" viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true" sx={{ verticalAlign: 'middle' }}>
              <path d={trend[0]} fill="currentColor" />
            </Box>
            <Box component="span" sx={SR_ONLY_SX}>{trend[1]}</Box>
          </>
        ) : '-'}
      </Box>
    </Box>
  );
}

/**
 * The pick'em-only league's body (ADR 0067 wave 1b): the pool standings as a primary frame. The
 * dashboard's own Play-select view over the pickem-standings widget's model (the Pick'em page keeps
 * the widget's look until its wave): a viewer strip (rank, behind the leader, accuracy, best week) and
 * the table - rank, team, points, this week, correct, missed, pending, an accuracy bar, an
 * eighteen-cell weekly heat strip and the trend - where the viewer's row is Play blue with an arrow
 * (not a cursor). Heat and accuracy use Frame colour, so green stays for the one filled action.
 */
export default function PickemStandings({ leagueId, title = "Pick'em Standings" }) {
  const {
    status, rows, teamCount, viewer, behindLeader, currentWeek, refetch,
  } = usePickemStandingsTable(leagueId);
  const headingId = useId();
  const noun = teamCount === 1 ? 'team' : 'teams';

  if (status === 'error') {
    return (
      <Box data-testid="pickem-standings">
        <ErrorPanel
          title={title}
          body="We could not load the standings right now."
          onRetry={refetch}
          retryAriaLabel="Try loading the standings again"
        />
      </Box>
    );
  }

  return (
    <Frame
      labelledBy={headingId}
      data-testid="pickem-standings"
      aria-busy={status === 'loading'}
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>{title}</PixelHeading>
          {status === 'ready' && (
            <Box component="span" data-testid="pickem-standings-count" sx={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--ps-dim)' }}>
              {`${teamCount} ${noun}`}
            </Box>
          )}
        </FrameHead>
      )}
    >
      {status === 'ready' && viewer && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '12px', padding: { xs: '12px 14px', md: '14px 20px' }, borderBottom: '2px solid var(--ps-rule)' }}>
          <Tile label="Your rank" testid="pickem-standings-your-rank">{viewer.tied ? `T-${viewer.rank}` : ordinal(viewer.rank) || viewer.rank}</Tile>
          <Tile label="Behind leader" testid="pickem-standings-behind-leader">
            {behindLeader == null ? '-' : behindLeader === 0 ? 'Leader' : `${Math.abs(behindLeader)} pts`}
          </Tile>
          <Tile label="Your accuracy" testid="pickem-standings-your-accuracy">
            {viewer.accuracy == null ? '-' : `${Math.round(viewer.accuracy * 100)}%`}
          </Tile>
          <Tile label="Best week" testid="pickem-standings-best-week">{viewer.bestWeek ? `Wk ${viewer.bestWeek.week}` : '-'}</Tile>
        </Box>
      )}
      <Box
        role="region"
        aria-label={`${title}, ${teamCount} ${noun}`}
        tabIndex={0}
        data-testid="pickem-standings-scroll"
        sx={{ overflowX: 'auto' }}
      >
        <Box component="table" sx={{ width: '100%', minWidth: '1146px', borderCollapse: 'separate', borderSpacing: 0 }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" scope="col" sx={headSx('left', { position: 'sticky', left: 0, zIndex: 1, width: 64, minWidth: 64 })}>Rank</Box>
              <Box component="th" scope="col" sx={headSx('left', { minWidth: '216px' })}>Team</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Points</Box>
              <Box component="th" scope="col" sx={headSx('right')}>{currentWeek != null ? `Wk ${currentWeek}` : 'This week'}</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Correct</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Missed</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Pending</Box>
              <Box component="th" scope="col" sx={headSx('left')}>Accuracy</Box>
              <Box component="th" scope="col" sx={headSx('left')}>{`Weekly points · Wk 1 to ${HEAT_WEEKS}`}</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Trend</Box>
            </Box>
          </Box>
          <Box component="tbody">
            {status === 'loading'
              ? Array.from({ length: Math.max(teamCount, 1) }, (_, i) => (
                <Box component="tr" key={`skeleton-${i}`} data-testid="pickem-standings-skeleton-row">
                  <Box component="td" colSpan={10} sx={cellSx('left', { borderBottom: '2px solid var(--ps-rule)' })}><Skel width="100%" height={16} /></Box>
                </Box>
              ))
              : rows.map((row) => <Row key={row.teamId ?? row.teamName} row={row} currentWeek={currentWeek} />)}
          </Box>
        </Box>
      </Box>
    </Frame>
  );
}
