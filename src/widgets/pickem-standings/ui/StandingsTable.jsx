import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelArrow, PixelHeading, PixelWarn, PsButton, Skel, SR_ONLY_SX, TeamMark, YouTag, pixelSx,
} from '../../../shared/ui/playselect';
import { SegmentedControl } from '../../../shared/ui';
import usePickemStandingsTable from '../model/usePickemStandingsTable';
import { HEAT_WEEKS } from '../lib/heatBuckets';
import { ordinal } from '../../../shared/lib';

// Fill height by bucket: the weekly cell is data (how a week compares with the team's own best).
const HEAT_HEIGHT = { h1: 25, h2: 50, h3: 75, h4: 100 };

// 16px pixel arrows, 12 to 14px wide: a direction, never a number the entity does not provide.
const TREND = {
  up: ['M7 4h2v2H7zM5 6h6v2H5zM3 8h10v2H3zM1 10h14v2H1z', 'Trend: improved'],
  down: ['M1 4h14v2H1zM3 6h10v2H3zM5 8h6v2H5zM7 10h2v2H7z', 'Trend: declined'],
  flat: ['M2 6h12v4H2z', 'Trend: unchanged'],
};

const rankLabel = (row) => (row.tied ? `T-${row.rank}` : String(row.rank));
const listOf = (items) => (items.length < 2
  ? String(items[0])
  : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// Every tied best week is ringed and named: the entity's bestWeek names one week, but the strip
// belongs to the data it draws, so ties come from the played points themselves.
function bestWeeksOf(heat) {
  const played = (heat || []).filter((cell) => cell.points != null);
  if (played.length === 0) return [];
  const best = Math.max(...played.map((cell) => cell.points));
  return played.filter((cell) => cell.points === best).map((cell) => cell.week);
}

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

// Confidence leagues draw the ten-cell accuracy bar beside the percent; straight up draws the percent
// alone (the bar said it a second time).
function Accuracy({ accuracy, me, bar }) {
  const pct = accuracy == null ? null : Math.max(0, Math.min(100, Math.round(accuracy * 100)));
  const on = pct == null ? 0 : Math.round(pct / 10);
  const fill = me ? 'var(--ps-play-ink)' : 'var(--ps-frame)';
  const line = me ? 'var(--ps-play-dim)' : 'var(--ps-dim)';
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
      {bar && (
        <Box
          data-testid="pickem-standings-accuracy-bar"
          {...(pct == null ? { role: 'img', 'aria-label': 'No decided picks yet' } : { 'aria-hidden': 'true' })}
          sx={{ display: 'grid', gridTemplateColumns: 'repeat(10, 8px)', gap: '2px' }}
        >
          {Array.from({ length: 10 }, (unused, i) => (
            <Box
              key={i}
              component="span"
              sx={{ height: '12px', boxSizing: 'border-box', ...(i < on ? { backgroundColor: fill } : { border: `2px solid ${line}` }) }}
            />
          ))}
        </Box>
      )}
      <Box component="span" data-testid="pickem-standings-accuracy" sx={{ minWidth: '40px' }}>{pct == null ? '-' : `${pct}%`}</Box>
    </Box>
  );
}

function heatLabel(heat) {
  const played = (heat || []).filter((cell) => cell.points != null);
  if (played.length === 0) return 'Weekly points: none yet';
  const last = Math.max(...played.map((cell) => cell.week));
  const points = heat
    .filter((cell) => cell.week <= last)
    .map((cell) => (cell.points == null ? 'none' : cell.points));
  const bests = bestWeeksOf(heat);
  return `Weekly points, weeks 1 to ${last}: ${points.join(', ')}; best week${bests.length > 1 ? 's' : ''} ${listOf(bests)}`;
}

// One labelled image per row: the eighteen cells are decoration (aria-hidden), the sentence is the
// name, so a screen reader hears one sentence per team instead of eighteen cells.
function HeatStrip({ heat, me }) {
  const fill = me ? 'var(--ps-play-ink)' : 'var(--ps-frame)';
  const track = me ? 'var(--ps-play-field)' : 'var(--ps-field)';
  const line = me ? 'var(--ps-play-dim)' : 'var(--ps-dim)';
  const bests = bestWeeksOf(heat);
  return (
    <Box data-testid="pickem-standings-heat" role="img" aria-label={heatLabel(heat)} sx={{ display: 'flex', gap: '3px', padding: '2px 0' }}>
      {(heat || []).map((cell) => (
        <Box
          key={cell.week}
          component="span"
          aria-hidden="true"
          data-week={cell.week}
          data-bucket={cell.bucket || 'not-played'}
          data-best={bests.includes(cell.week) || undefined}
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
            outline: bests.includes(cell.week) ? `2px solid ${fill}` : 0,
            outlineOffset: '1px',
          }}
        >
          {cell.bucket && (
            <Box
              component="span"
              data-testid="pickem-standings-heat-cell-fill"
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

function Row({ row, currentWeek, straight }) {
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
      {!straight && <Box component="td" sx={cellSx('right', base)}>{row.correct}</Box>}
      <Box component="td" sx={cellSx('right', base)}>{row.incorrect}</Box>
      <Box component="td" sx={cellSx('right', base)}>{row.pending}</Box>
      <Box component="td" sx={cellSx('left', base)}><Accuracy accuracy={row.accuracy} me={me} bar={!straight} /></Box>
      <Box component="td" sx={cellSx('left', base)}><HeatStrip heat={row.heat} me={me} /></Box>
      <Box component="td" data-testid="pickem-standings-trend" data-trend={row.trend || undefined} sx={cellSx('right', base)}>
        {trend ? (
          <>
            <svg width="16" height="16" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" style={{ verticalAlign: 'middle' }}>
              <path d={trend[0]} fill="currentColor" />
            </svg>
            <Box component="span" sx={SR_ONLY_SX}>{trend[1]}</Box>
          </>
        ) : <Box component="span" sx={SR_ONLY_SX}>Trend: not available</Box>}
      </Box>
    </Box>
  );
}

/**
 * Pick'em standings widget (ADR 0038, Play-select in ADR 0067 wave 2): the Standings section, a
 * primary frame over the season leaderboard (docs/design/league/PickemStandings.dc.html). A viewer
 * strip (your rank, behind the leader, your accuracy, your best week) over a one-line legend for the
 * heat strip, then the table: rank, team, points, this week, Correct (confidence only), missed,
 * pending, accuracy, an eighteen-week heat strip and the trend, in tabular figures. The viewer's row
 * is Play blue with a pixel arrow (not a cursor). Straight up drops the Correct column (it equals
 * Points) and the ten-cell accuracy bars: the percent alone stays.
 *
 * Renders from the standings entity only (`usePickemStandingsTable`); the widget never calls a fetch
 * client itself. The table scrolls inside its own box (a keyboard-reachable, labelled scrollport,
 * first column sticky), so no width of table widens the page. The scroll box is positioned so the
 * visually hidden spans inside the table cannot widen the document either (measured on a phone:
 * `documentElement.scrollWidth` 1211 -> 390 with that one rule).
 *
 * The heat strip is one labelled image per row ("Weekly points, weeks 1 to 7: 9, 10, 7, 10, 7, 8, 1;
 * best weeks 2 and 4"), its cells aria-hidden, every tied best week ringed and named. Each cell's
 * fill height is its bucket (`lib/heatBuckets.js`), so a bucket reads by shape as well as tint
 * (WCAG 1.4.1, #1298).
 */
export default function StandingsTable({ leagueId, seasons, title = 'Standings' }) {
  const {
    status,
    rows,
    teamCount,
    season,
    seasons: seasonOptions,
    onSeasonChange,
    mode,
    viewer,
    behindLeader,
    currentWeek,
    refetch,
  } = usePickemStandingsTable(leagueId, { seasons });
  const headingId = useId();
  const straight = mode !== 'confidence';
  const noun = teamCount === 1 ? 'team' : 'teams';
  const viewerBests = viewer ? bestWeeksOf(viewer.heat) : [];
  const columns = straight ? 9 : 10;

  if (status === 'error') {
    return (
      <Frame
        component="div"
        tone="danger"
        role="alert"
        data-testid="pickem-standings-error"
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px 20px', padding: '16px 20px' }}
      >
        <Box sx={{ display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0 }}>
          <PixelWarn color="var(--ps-danger)" />
          <Box component="span" sx={{ fontSize: '16px' }}>We could not load the standings right now.</Box>
        </Box>
        <PsButton variant="ghost" onClick={refetch}>Retry</PsButton>
      </Frame>
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
      <Box component="p" sx={{ m: 0, padding: { xs: '10px 14px', md: '10px 20px' }, borderBottom: '2px solid var(--ps-rule)', fontSize: '14px', color: 'var(--ps-dim)' }}>
        <Box component="b" sx={{ fontWeight: 600, color: 'var(--ps-ink)' }}>Weekly points</Box>
        {` · one square per week, Wk 1 to ${HEAT_WEEKS}. Fill height: that week against the team's own best week. Ring: best week (every tied best week is ringed). Empty: not played.`}
      </Box>

      {(status === 'ready' && viewer) || seasonOptions.length > 1 ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', padding: { xs: '12px 14px', md: '14px 20px' }, borderBottom: '2px solid var(--ps-rule)' }}>
          {status === 'ready' && viewer && (
            <>
              <Tile label="Your rank" testid="pickem-standings-your-rank">{viewer.tied ? `T-${viewer.rank}` : ordinal(viewer.rank) || viewer.rank}</Tile>
              <Tile label="Behind leader" testid="pickem-standings-behind-leader">
                {behindLeader == null ? '-' : behindLeader === 0 ? 'Leader' : `${Math.abs(behindLeader)} pts`}
              </Tile>
              <Tile label="Your accuracy" testid="pickem-standings-your-accuracy">
                {viewer.accuracy == null ? '-' : `${Math.round(viewer.accuracy * 100)}%`}
              </Tile>
              <Tile label={`Best week${viewerBests.length > 1 ? 's' : ''}`} testid="pickem-standings-best-week">
                {viewerBests.length ? `Wk ${listOf(viewerBests)}` : '-'}
              </Tile>
            </>
          )}
          {seasonOptions.length > 1 && (
            <SegmentedControl
              aria-label="Season"
              data-testid="pickem-standings-season-switch"
              options={seasonOptions.map((value) => ({ value, label: String(value) }))}
              value={season}
              onChange={onSeasonChange}
              sx={{ marginLeft: 'auto' }}
            />
          )}
        </Box>
      ) : null}

      <Box
        role="region"
        aria-label="Standings table, scrollable"
        tabIndex={0}
        data-testid="pickem-standings-scroll"
        sx={{
          overflowX: 'auto',
          // The containing block for the table's visually hidden spans (see the docblock).
          position: 'relative',
        }}
      >
        <Box component="table" sx={{ width: '100%', minWidth: straight ? '1016px' : '1146px', borderCollapse: 'separate', borderSpacing: 0 }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" scope="col" sx={headSx('left', { position: 'sticky', left: 0, zIndex: 1, width: 64, minWidth: 64 })}>Rank</Box>
              <Box component="th" scope="col" sx={headSx('left', { minWidth: '216px' })}>Team</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Points</Box>
              <Box component="th" scope="col" sx={headSx('right')}>{currentWeek != null ? `Wk ${currentWeek}` : 'This week'}</Box>
              {!straight && <Box component="th" scope="col" sx={headSx('right')}>Correct</Box>}
              <Box component="th" scope="col" sx={headSx('right')}>Missed</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Pending</Box>
              <Box component="th" scope="col" sx={headSx('left')}>Accuracy</Box>
              <Box component="th" scope="col" sx={headSx('left')}>{`Weekly points · Wk 1 to ${HEAT_WEEKS}`}</Box>
              <Box component="th" scope="col" sx={headSx('right')}>Trend</Box>
            </Box>
          </Box>
          <Box component="tbody">
            {status === 'loading'
              ? Array.from({ length: Math.max(teamCount, 1) }, (unused, i) => (
                <Box component="tr" key={`skeleton-${i}`} data-testid="pickem-standings-skeleton-row">
                  <Box component="td" colSpan={columns} sx={cellSx('left', { borderBottom: '2px solid var(--ps-rule)' })}>
                    <Skel width="100%" height={16} data-testid="pickem-standings-skeleton" />
                  </Box>
                </Box>
              ))
              : rows.map((row) => <Row key={row.teamId ?? row.teamName} row={row} currentWeek={currentWeek} straight={straight} />)}
          </Box>
        </Box>
      </Box>
    </Frame>
  );
}
