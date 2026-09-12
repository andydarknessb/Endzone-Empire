import React from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Badge, Card, SegmentedControl, Skeleton, StatTile, TeamAvatar } from '../../../shared/ui';
import usePickemStandingsTable from '../model/usePickemStandingsTable';
import { HEAT_WEEKS } from '../lib/heatBuckets';
import { ordinal } from '../lib/ordinal';

const TREND_LABEL = { up: 'Trend: improved', down: 'Trend: declined', flat: 'Trend: unchanged' };
const MEDAL_COLOR = { 1: 'var(--dash-warning)', 2: 'var(--medal-silver)', 3: 'var(--medal-bronze)' };

/**
 * Pick'em standings widget (#1266, ADR 0038): season leaderboard for a
 * pick'em league, with rank (medal fills for 1-3), Team identity, points,
 * this week's points, correct/missed/pending, an accuracy bar, an
 * eighteen-week heat strip with the best week outlined, a trend arrow and a
 * season switch, matching docs/design/pickem/Standings.dc.html.
 *
 * Composes `shared/ui` (ADR 0020) and paints only `dash-*` tokens - the same
 * kit and token set src/widgets/standings-table already uses for its own
 * league table, including the viewer-row treatment (accent tint + inset
 * accent bar + "You" pill), whose ink-on-tint pairings are already
 * registered in tokens.contrast.test.js ("the me-row team name on the
 * accent tint over a card", "the You pill on the viewer row tint over a
 * card"). The medal marks (LeagueHistoryPage's own pattern) are decorative
 * SVG glyphs beside the plain rank number, not colour-filled text, so they
 * introduce no new text/background pairing either. The weekly heat cells and
 * the accuracy bar are plain coloured boxes with no text of their own (the
 * same "no visible text -> no new pairing" shape as shared/ui's RangeBar),
 * so nothing here registers a new row in tokens.contrast.test.js.
 *
 * Renders from the standings entity only (`usePickemStandingsTable`); the
 * widget never calls a fetch client itself.
 */
export default function StandingsTable({ leagueId, seasons }) {
  const {
    status,
    rows,
    teamCount,
    season,
    seasons: seasonOptions,
    onSeasonChange,
    viewer,
    behindLeader,
    currentWeek,
  } = usePickemStandingsTable(leagueId, { seasons });

  const busy = status === 'loading';

  return (
    <Card
      title="Standings"
      count={
        <Box component="span" data-testid="pickem-standings-count">
          {`${teamCount} team${teamCount === 1 ? '' : 's'}`}
        </Box>
      }
      data-testid="pickem-standings"
      aria-busy={busy}
    >
      <Box sx={{ px: 2.25, py: 1.75, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center', borderBottom: '1px solid var(--dash-line)' }}>
        {status === 'ready' && viewer && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <StatTile
              label="Your rank"
              value={viewer.tied ? `T-${viewer.rank}` : ordinal(viewer.rank) || viewer.rank}
              data-testid="pickem-standings-your-rank"
            />
            <StatTile
              label="Behind leader"
              value={behindLeader == null ? '-' : behindLeader === 0 ? 'Leader' : `${behindLeader} pts`}
              data-testid="pickem-standings-behind-leader"
            />
            <StatTile
              label="Your accuracy"
              value={viewer.accuracy == null ? '-' : `${Math.round(viewer.accuracy * 100)}%`}
              data-testid="pickem-standings-your-accuracy"
            />
            <StatTile
              label="Best week"
              value={viewer.bestWeek ? `Wk ${viewer.bestWeek.week}` : '-'}
              data-testid="pickem-standings-best-week"
            />
          </Box>
        )}
        {seasonOptions.length > 1 && (
          <SegmentedControl
            aria-label="Season"
            data-testid="pickem-standings-season-switch"
            options={seasonOptions.map((value) => ({ value, label: String(value) }))}
            value={season}
            onChange={onSeasonChange}
            sx={{ ml: 'auto' }}
          />
        )}
      </Box>

      {status === 'error' ? (
        <Box sx={{ px: 2.25, py: 2 }}>
          <Typography role="alert" data-testid="pickem-standings-error" sx={{ fontSize: '13px', color: 'var(--dash-ink)' }}>
            We could not load the standings right now.
          </Typography>
        </Box>
      ) : (
        <Box data-testid="pickem-standings-scroll" sx={{ overflowX: 'auto' }}>
          <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--dash-font-body)' }}>
            <Box component="thead">
              <Box component="tr">
                <HeadCell align="right">Rank</HeadCell>
                <HeadCell>Team</HeadCell>
                <HeadCell align="right">Points</HeadCell>
                <HeadCell align="right">{currentWeek != null ? `Wk ${currentWeek}` : 'This week'}</HeadCell>
                <HeadCell align="right">Correct</HeadCell>
                <HeadCell align="right">Missed</HeadCell>
                <HeadCell align="right">Pending</HeadCell>
                <HeadCell>Accuracy</HeadCell>
                <HeadCell>{`Weekly points · Wk 1 to ${HEAT_WEEKS}`}</HeadCell>
                <HeadCell align="right">Trend</HeadCell>
              </Box>
            </Box>
            <Box component="tbody">
              {status === 'loading'
                ? Array.from({ length: Math.max(teamCount, 1) }, (_, i) => <SkeletonRow key={`skeleton-${i}`} />)
                : rows.map((row) => <StandingsRow key={row.teamId ?? row.teamName} row={row} currentWeek={currentWeek} />)}
            </Box>
          </Box>
        </Box>
      )}
    </Card>
  );
}

function StandingsRow({ row, currentWeek }) {
  const thisWeekPoints = currentWeek != null && row.weekly ? row.weekly[currentWeek] : undefined;
  return (
    <Box
      component="tr"
      data-testid={row.isViewer ? 'pickem-standings-you-row' : undefined}
      data-viewer-team={row.isViewer || undefined}
      sx={{
        ...(row.isViewer
          ? { backgroundColor: 'var(--dash-accent-soft)', boxShadow: 'inset 3px 0 0 var(--dash-accent)' }
          : {}),
        '& > td, & > th': { borderTop: '1px solid var(--dash-line)' },
      }}
    >
      <BodyCell align="right">
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <MedalIcon rank={row.rank} />
          <Box component="span" data-testid="pickem-standings-rank" sx={{ fontFamily: 'var(--dash-font-display)', fontWeight: 700 }}>
            {row.tied ? `T-${row.rank}` : row.rank}
          </Box>
        </Box>
      </BodyCell>
      <BodyCell asRowHeader>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ flex: 'none', display: 'flex' }}>
            <TeamAvatar name={row.teamName} avatarUrl={row.avatarUrl} avatarStaticUrl={row.avatarStaticUrl} size={28} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box
              component="span"
              sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '13.5px', fontWeight: 600, color: 'var(--dash-ink)' }}
            >
              {row.teamName}
            </Box>
            {row.isViewer && <Badge variant="you" sx={{ flex: 'none' }}>You</Badge>}
          </Box>
        </Box>
      </BodyCell>
      <BodyCell align="right">
        <Box component="span" sx={{ fontFamily: 'var(--dash-font-display)', fontWeight: 700, fontSize: '15px' }}>
          {row.points}
        </Box>
      </BodyCell>
      <BodyCell align="right">{thisWeekPoints == null ? '-' : thisWeekPoints}</BodyCell>
      <BodyCell align="right">{row.correct}</BodyCell>
      <BodyCell align="right">{row.incorrect}</BodyCell>
      <BodyCell align="right">{row.pending}</BodyCell>
      <BodyCell>
        <AccuracyBar accuracy={row.accuracy} />
      </BodyCell>
      <BodyCell>
        <HeatStrip heat={row.heat} />
      </BodyCell>
      <BodyCell align="right">
        <TrendMark trend={row.trend} />
      </BodyCell>
    </Box>
  );
}

function HeadCell({ children, align = 'left' }) {
  return (
    <Box
      component="th"
      scope="col"
      sx={{
        textAlign: align,
        px: 1.5,
        py: 1.25,
        borderBottom: '1px solid var(--dash-line)',
        backgroundColor: 'var(--dash-surface2)',
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--dash-faint)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

function BodyCell({ children, align = 'left', asRowHeader = false }) {
  return (
    <Box
      component={asRowHeader ? 'th' : 'td'}
      {...(asRowHeader ? { scope: 'row' } : {})}
      sx={{
        textAlign: align,
        px: 1.5,
        py: 1.25,
        fontSize: '13.5px',
        fontWeight: 400,
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--dash-ink)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

// Decorative medal marks (LeagueHistoryPage.jsx's own pattern): the rank
// number beside them carries the meaning, so these are aria-hidden and
// introduce no text-on-colour pairing for tokens.contrast.test.js.
function MedalIcon({ rank }) {
  const color = MEDAL_COLOR[rank];
  if (!color) return null;
  return (
    <Box
      component="svg"
      width={14}
      height={14}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-medal={rank}
      sx={{ color, flex: 'none' }}
    >
      <circle cx="10" cy="12.5" r="4.5" />
      <path d="M7 8.4 5 3.5h10l-2 4.9" />
    </Box>
  );
}

// A plain fill-percentage bar, local to this widget (shared/ui is read-only
// and RangeBar's floor/ceiling/tick shape does not fit a single percentage).
// No text sits on the fill, so - like RangeBar - it introduces no new
// foreground/background pairing.
function AccuracyBar({ accuracy }) {
  const pct = accuracy == null ? null : Math.max(0, Math.min(100, Math.round(accuracy * 100)));
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <Box
        role="img"
        aria-label={pct == null ? 'No decided picks yet' : `Accuracy ${pct}%`}
        data-testid="pickem-standings-accuracy-bar"
        sx={{ width: 64, height: 6, borderRadius: 'var(--radius-pill)', backgroundColor: 'var(--dash-surface3)', overflow: 'hidden' }}
      >
        {pct != null && (
          <Box style={{ width: `${pct}%` }} sx={{ height: '100%', backgroundColor: 'var(--dash-home)' }} />
        )}
      </Box>
      <Box component="span" sx={{ fontSize: '12.5px', color: 'var(--dash-dim)' }}>
        {pct == null ? '-' : `${pct}%`}
      </Box>
    </Box>
  );
}

// The eighteen-week heat strip: coloured, text-free cells (heatBuckets.js
// owns which bucket each week falls into), the best week outlined. Each cell
// carries its meaning in an aria-label rather than visible text.
function HeatStrip({ heat }) {
  return (
    <Box data-testid="pickem-standings-heat" sx={{ display: 'flex', gap: '3px' }}>
      {(heat || []).map((cell) => (
        <Box
          key={cell.week}
          data-testid="pickem-standings-heat-cell"
          data-week={cell.week}
          data-bucket={cell.bucket || 'not-played'}
          data-best={cell.isBest || undefined}
          role="img"
          aria-label={
            cell.points == null
              ? `Week ${cell.week}: no picks made`
              : `Week ${cell.week}: ${cell.points} points${cell.isBest ? ', best week' : ''}`
          }
          sx={{
            width: 14,
            height: 14,
            borderRadius: '4px',
            backgroundColor: cell.bucket ? 'var(--dash-accent)' : 'var(--dash-surface3)',
            opacity: BUCKET_OPACITY[cell.bucket] ?? 1,
            outline: cell.isBest ? '2px solid var(--dash-warning)' : 'none',
            outlineOffset: '1px',
          }}
        />
      ))}
    </Box>
  );
}

const BUCKET_OPACITY = { h1: 0.35, h2: 0.6, h3: 0.85, h4: 1 };

// Categorical only: the entity's `trend` is 'up' | 'down' | 'flat' | null
// (no rank-delta magnitude), so this renders a direction, never a number the
// entity does not provide.
function TrendMark({ trend }) {
  if (trend == null) {
    return (
      <Box component="span" data-testid="pickem-standings-trend" sx={{ color: 'var(--dash-faint)' }}>
        <span aria-hidden="true">-</span>
        <span style={visuallyHidden}>Trend: not available</span>
      </Box>
    );
  }
  const glyph = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '–';
  const color = trend === 'up' ? 'var(--dash-away)' : trend === 'down' ? 'var(--dash-danger)' : 'var(--dash-faint)';
  return (
    <Box component="span" data-testid="pickem-standings-trend" data-trend={trend} sx={{ color, fontWeight: 600 }}>
      <span aria-hidden="true">{glyph}</span>
      <span style={visuallyHidden}>{TREND_LABEL[trend]}</span>
    </Box>
  );
}

function SkeletonRow() {
  return (
    <Box component="tr" sx={{ '& > td': { borderTop: '1px solid var(--dash-line)' } }}>
      {Array.from({ length: 10 }, (_, i) => (
        <BodyCell key={i}>
          <Skeleton data-testid="pickem-standings-skeleton" variant="text" width={i === 1 ? 120 : 32} height={14} />
        </BodyCell>
      ))}
    </Box>
  );
}
