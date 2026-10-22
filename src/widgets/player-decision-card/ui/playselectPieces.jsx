import React, { useId } from 'react';
import { Box } from '@mui/material';
import {
  Frame, FrameHead, PixelHeading, PixelWarn, SR_ONLY_SX,
} from '../../../shared/ui/playselect';
import {
  finite, formatPoints, reasonLabel as sharedReasonLabel, NO_HISTORY_LABEL,
} from '../../../shared/lib';

// The Player card's pieces (ADR 0067, spec #2347 ruling 7), drawn from docs/design/league/league-kit-card.js.
// Every piece keeps the test ids and accessible names of the default piece it stands in for.

/** A tertiary section frame: a 2px edge, a Pixel 16 h3 head over a 2px rule. `pad={false}` lets a table run edge to edge. */
export function PsSection({
  title, testId, level = 'h3', pad = true, children,
}) {
  const id = useId();
  return (
    <Frame
      tier="rule"
      labelledBy={title ? id : undefined}
      data-testid={testId}
      head={title ? (
        <FrameHead>
          <PixelHeading id={id} level={Number(level.slice(1))} size={16}>{title}</PixelHeading>
        </FrameHead>
      ) : null}
    >
      {pad
        ? <Box sx={{ p: '14px 20px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>{children}</Box>
        : children}
    </Frame>
  );
}

/** The stack the sections sit in: 16px gaps, never shrunk by the drawer's column flexbox. */
export const PS_STACK_SX = {
  display: 'flex', flexDirection: 'column', gap: '16px', p: '0 16px 16px', flexShrink: 0, minWidth: 0,
};

export const INK_LINE_SX = { fontFamily: 'inherit', fontSize: '15px', m: 0 };
export const DIM_LINE_SX = { fontFamily: 'inherit', fontSize: '14px', color: 'var(--ps-dim)', m: 0 };

/** An in-row badge: Archivo 13 700 uppercase on a 2px Rule edge (the product's neutral Badge). */
export function RowBadge({ children, onBand = false, ...rest }) {
  return (
    <Box
      component="span"
      {...rest}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        height: '22px',
        padding: '0 6px',
        // On the Play-blue header band the edge is Play dim and the text Play ink.
        border: `2px solid ${onBand ? 'var(--ps-play-dim)' : 'var(--ps-rule)'}`,
        color: onBand ? 'var(--ps-play-ink)' : 'var(--ps-ink)',
        fontSize: '13px',
        fontWeight: 700,
        letterSpacing: '.04em',
        textTransform: 'uppercase',
        lineHeight: 1,
        flex: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  );
}

const TONE_BG = { above: 'var(--ps-cell-above)', typical: 'var(--ps-cell)', below: 'var(--ps-cell-below)' };

function stickySx(i, offsets) {
  if (i >= offsets.length) return null;
  const width = i < offsets.length - 1 ? `${offsets[i + 1] - offsets[i]}px` : undefined;
  return { position: 'sticky', left: `${offsets[i]}px`, zIndex: 1, width, minWidth: width, maxWidth: width };
}

const CELL = {
  boxSizing: 'border-box', padding: '0 8px', whiteSpace: 'nowrap', backgroundColor: 'var(--ps-panel)',
};

/**
 * The kit table: a sticky first column, 40px head row and 44px body rows over 2px Rule lines, 8px cell padding.
 * `cols` is `[{ label, align, key }]` (`key` when two labels repeat); each row is `{ key, cells, tones }` with the first
 * cell its row header and `tones[i]` the above, typical or below fill of cell i. `stickyOffsets` are the left edges
 * of the fixed columns, so [0, 56] fixes the first two with the first 56px wide. The region scrolls sideways and is
 * a tab stop, so the card's arrow keys leave it alone (data-arrow-scroll-region).
 */
export function PsTable({
  label, cols, rows, testId, minWidth, stickyOffsets = [0],
}) {
  return (
    <Box
      role="region"
      aria-label={`${label} table`}
      tabIndex={0}
      data-arrow-scroll-region="true"
      // relative: an absolutely placed sr-only cell would otherwise escape this clip and widen the drawer.
      sx={{ overflowX: 'auto', position: 'relative' }}
    >
      <Box
        component="table"
        aria-label={label}
        data-testid={testId}
        sx={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          minWidth: minWidth ? `${minWidth}px` : undefined,
        }}
      >
        <thead>
          <tr>
            {cols.map((col, i) => (
              <Box
                key={col.key ?? col.label}
                component="th"
                scope="col"
                sx={{
                  ...CELL,
                  height: '40px',
                  textAlign: col.align || 'left',
                  borderBottom: '2px solid var(--ps-rule)',
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '.04em',
                  textTransform: 'uppercase',
                  color: 'var(--ps-dim)',
                  ...stickySx(i, stickyOffsets),
                }}
              >
                {col.label}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.key}>
              {row.cells.map((cell, i) => {
                const sx = {
                  ...CELL,
                  height: '44px',
                  textAlign: cols[i].align || 'left',
                  fontSize: '15px',
                  color: 'var(--ps-ink)',
                  borderBottom: ri === rows.length - 1 ? 0 : '2px solid var(--ps-rule)',
                  ...stickySx(i, stickyOffsets),
                  ...(row.tones?.[i] ? { backgroundColor: TONE_BG[row.tones[i]] } : null),
                };
                const key = cols[i].key ?? cols[i].label;
                return i === 0
                  ? <Box key={key} component="th" scope="row" sx={{ ...sx, fontWeight: 600 }}>{cell}</Box>
                  : <Box key={key} component="td" sx={sx}>{cell}</Box>;
              })}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

/** Floor to Ceiling: a Play-blue band in a Rule box with an Ink tick at the projection (the kit's rangeBar). */
export function PsRangeBar({
  floor, ceiling, projection, label, 'data-testid': testId = 'range-bar',
}) {
  const floorValue = finite(floor);
  const ceilingValue = finite(ceiling);
  const projectionValue = finite(projection);
  const max = Math.max(ceilingValue ?? 0, projectionValue ?? 0, 1);
  const pct = (v) => (v == null ? null : Math.max(0, Math.min(100, (v / max) * 100)));
  const floorPct = pct(floorValue);
  const ceilingPct = pct(ceilingValue);
  const projectionPct = pct(projectionValue);
  const hasBand = floorPct != null && ceilingPct != null;

  const parts = [];
  if (label) parts.push(label);
  if (floorValue != null) parts.push(`Floor ${floorValue.toFixed(1)}`);
  if (projectionValue != null) parts.push(`Projection ${projectionValue.toFixed(1)}`);
  if (ceilingValue != null) parts.push(`Ceiling ${ceilingValue.toFixed(1)}`);

  return (
    <Box
      role="img"
      aria-label={parts.length > 0 ? parts.join(', ') : 'No projection'}
      data-testid={testId}
      sx={{ position: 'relative', height: '16px', boxSizing: 'border-box', border: '2px solid var(--ps-rule)' }}
    >
      {hasBand && (
        <Box
          data-testid={`${testId}-band`}
          style={{ left: `${Math.min(floorPct, ceilingPct)}%`, width: `${Math.max(ceilingPct - floorPct, 0)}%` }}
          sx={{ position: 'absolute', top: '2px', bottom: '2px', backgroundColor: 'var(--ps-play)' }}
        />
      )}
      {projectionPct != null && (
        <Box
          data-testid={`${testId}-tick`}
          style={{ left: `${projectionPct}%` }}
          sx={{
            position: 'absolute',
            top: '-6px',
            bottom: '-6px',
            width: '4px',
            ml: '-4px',
            boxSizing: 'content-box',
            backgroundColor: 'var(--ps-ink)',
            border: '2px solid var(--ps-panel)',
          }}
        />
      )}
    </Box>
  );
}

function Tile({ label, testId, children }) {
  return (
    <Box data-testid={testId}>
      <Box sx={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ps-dim)' }}>
        {label}
      </Box>
      <Box sx={{ fontSize: '17px', fontWeight: 700, mt: '2px' }}>{children}</Box>
    </Box>
  );
}

const Sub = ({ children }) => (
  <Box component="span" sx={{ fontSize: '13px', fontWeight: 400, color: 'var(--ps-dim)', ml: '4px' }}>{children}</Box>
);

/**
 * The decision strip on the kit's two-column tiles. Same tiles and the same null-hides-the-tile rules as
 * `entities/player`'s DecisionStrip; the Upgrade pill is an outlined Ink badge, not green.
 */
export function PsDecisionStrip({
  decision, usage, ownership, depth, rosterStatus, noHistory = false,
}) {
  const tiles = [];
  if (decision?.projWeek && decision.projWeek.points != null) {
    tiles.push(
      <Tile key="proj" label={`Week ${decision.projWeek.week} projection`} testId="decision-strip-proj-week">
        {decision.projWeek.reason
          ? (sharedReasonLabel(decision.projWeek.reason) || decision.projWeek.reason)
          : (noHistory ? NO_HISTORY_LABEL : formatPoints(decision.projWeek.points))}
      </Tile>
    );
  }
  if (decision?.ros && decision.ros.points != null) {
    tiles.push(
      <Tile
        key="ros"
        label={decision.ros.throughWeek != null ? `Rest of season (thru Wk ${decision.ros.throughWeek})` : 'Rest of season'}
        testId="decision-strip-ros"
      >
        {formatPoints(decision.ros.points)}
      </Tile>
    );
  }
  const percentOwned = finite(ownership?.percentOwned);
  const ownershipChange = finite(ownership?.change);
  if (percentOwned != null) {
    tiles.push(
      <Tile key="ownership" label="Ownership" testId="decision-strip-ownership">
        {`${percentOwned.toFixed(1)}%`}
        {ownershipChange != null && <Sub>{`${ownershipChange >= 0 ? '+' : ''}${ownershipChange.toFixed(1)} 7d`}</Sub>}
      </Tile>
    );
  }
  if (depth && depth.positionGroup && depth.rank != null) {
    tiles.push(<Tile key="depth" label="Depth chart" testId="decision-strip-depth">{`${depth.positionGroup}${depth.rank}`}</Tile>);
  }
  if (rosterStatus) {
    tiles.push(<Tile key="roster-status" label="NFL roster" testId="decision-strip-roster-status">{rosterStatus}</Tile>);
  }
  if (decision?.upgrade?.points > 0) {
    const upgradeWeek = decision.upgrade.week;
    const weekLabel = upgradeWeek != null && decision.projWeek?.week != null && upgradeWeek !== decision.projWeek.week
      ? ` Wk ${upgradeWeek}`
      : '';
    tiles.push(
      <Tile key="upgrade" label="Upgrade" testId="decision-strip-upgrade">
        <Box
          component="span"
          data-testid="decision-strip-upgrade-pill"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            height: '24px',
            boxSizing: 'border-box',
            padding: '0 6px',
            border: '2px solid var(--ps-ink)',
            fontSize: '15px',
            fontWeight: 700,
          }}
        >
          +{formatPoints(decision.upgrade.points)}{weekLabel}
        </Box>
        {decision.upgrade.slot && <Sub>{`at ${decision.upgrade.slot}`}</Sub>}
      </Tile>
    );
  }
  if (usage?.seasonAverage && usage.seasonAverage.fantasyPoints != null) {
    tiles.push(
      <Tile key="usage" label="Usage (season avg)" testId="decision-strip-usage">
        {formatPoints(usage.seasonAverage.fantasyPoints)}
        <Sub>FPTS/gm</Sub>
      </Tile>
    );
  }
  if (tiles.length === 0) return null;
  return (
    <Box
      data-testid="decision-strip"
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 16px', alignItems: 'start' }}
    >
      {tiles}
    </Box>
  );
}

function reasonLabel(reason) {
  return sharedReasonLabel(reason) || reason;
}

function weekTitle(week) {
  const opponent = week.opponent ? ` vs ${week.opponent}` : '';
  if (week.kind === 'bye') return `Week ${week.week}: ${sharedReasonLabel('bye')}`;
  if (week.kind === 'unavailable') return `Week ${week.week}${opponent}: ${reasonLabel(week.reason)}`;
  const points = week.points != null ? formatPoints(week.points) : 'no number';
  return `Week ${week.week}${opponent}: ${week.kind === 'projected' ? `${points} projected` : points}`;
}

const BAR_H = 88;

function WeekBar({ week, maxPoints, isCurrent, isSeasonEnd }) {
  const title = weekTitle(week);
  const h = Math.max(6, Math.round(((Number(week.points) || 0) / maxPoints) * BAR_H));
  return (
    <Box
      role="listitem"
      title={title}
      aria-label={title}
      aria-current={isCurrent ? 'true' : undefined}
      data-testid={`weekly-bar-${week.week}`}
      data-kind={week.kind}
      data-season-end={isSeasonEnd ? 'true' : undefined}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        flex: '1 1 0',
        minWidth: '16px',
        // The ADR 0042 season end: a dashed Frame rule after the last playoff week.
        ...(isSeasonEnd ? { borderRight: '2px dashed var(--ps-frame)', pr: '4px', mr: '2px' } : null),
      }}
    >
      <Box sx={{ height: `${BAR_H}px`, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
        {week.kind === 'bye' && (
          <Box data-testid={`weekly-bar-${week.week}-bye`} sx={{ height: `${BAR_H}px`, boxSizing: 'border-box', border: '2px dashed var(--ps-rule)' }} />
        )}
        {week.kind === 'unavailable' && (
          <Box
            data-testid={`weekly-bar-${week.week}-unavailable`}
            sx={{ display: 'grid', placeItems: 'center', height: '22px', boxSizing: 'border-box', border: '2px solid var(--ps-ink)' }}
          >
            <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true" shapeRendering="crispEdges">
              <path d="M1 1h2v2H1zM3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM9 1h2v2H9zM7 3h2v2H7zM3 7h2v2H3zM1 9h2v2H1z" fill="currentColor" />
            </svg>
            <Box component="span" data-testid={`weekly-bar-${week.week}-reason`} sx={SR_ONLY_SX}>{reasonLabel(week.reason)}</Box>
          </Box>
        )}
        {(week.kind === 'actual' || week.kind === 'projected') && (
          <Box
            data-testid={`weekly-bar-${week.week}-fill`}
            sx={{
              height: `${h}px`,
              boxSizing: 'border-box',
              // Solid Ink is scored; an outlined Dim bar is projected.
              ...(week.kind === 'actual'
                ? { backgroundColor: 'var(--ps-ink)' }
                : { border: '2px solid var(--ps-dim)' }),
            }}
          />
        )}
      </Box>
      <Box
        component="span"
        aria-hidden="true"
        data-testid={isCurrent ? `weekly-bar-${week.week}-current` : undefined}
        sx={{
          textAlign: 'center',
          fontSize: '13px',
          lineHeight: '20px',
          boxSizing: 'border-box',
          ...(isCurrent ? { border: '2px solid var(--ps-ink)', fontWeight: 700 } : { border: '2px solid transparent' }),
        }}
      >
        {week.week}
      </Box>
    </Box>
  );
}

/**
 * The eighteen-week bars on the kit's marks: solid Ink scored, outlined Dim projected, a dashed box for a bye,
 * an X for an Unavailable week (its reason stays in the name), the current week's number boxed. Keeps the
 * default strip's test ids, scroll region and arrow-key opt-in.
 */
export function PsWeeklyBars({ weeks, currentWeek, seasonEnd }) {
  if (!Array.isArray(weeks) || weeks.length === 0) return null;
  const maxPoints = Math.max(1, ...weeks.map((w) => (typeof w.points === 'number' ? w.points : 0)));
  return (
    <>
      <Box
        data-testid="weekly-points-bars"
        role="list"
        aria-label="Weekly points, actual and projected"
        tabIndex={0}
        data-arrow-scroll-region="true"
        sx={{ display: 'flex', alignItems: 'flex-end', gap: '4px', overflowX: 'auto', position: 'relative', flexShrink: 0 }}
      >
        {weeks.map((week) => (
          <WeekBar
            key={week.week}
            week={week}
            maxPoints={maxPoints}
            isCurrent={currentWeek != null && week.week === currentWeek}
            isSeasonEnd={seasonEnd != null && week.week === seasonEnd}
          />
        ))}
      </Box>
      <Box component="p" sx={{ ...DIM_LINE_SX, fontSize: '13px', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        <span>Solid: scored</span>
        <span>Outlined: projected</span>
        <span>Dashed box: bye</span>
        <span>X: out</span>
        {seasonEnd != null && <span>{`Dashed rule: end of Wk ${seasonEnd}`}</span>}
      </Box>
    </>
  );
}

const LINK_SX = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '44px',
  fontSize: '15px',
  fontWeight: 600,
  color: 'var(--ps-ink)',
  textDecoration: 'underline',
  textDecorationThickness: '2px',
  textUnderlineOffset: '5px',
  textDecorationColor: 'var(--ps-dim)',
};

/** The news list: a 44px underlined link per item (or plain text with no url), blurb and date in Dim. */
export function PsNewsList({ news }) {
  if (!Array.isArray(news) || news.length === 0) return null;
  return (
    <Box data-testid="decision-card-news" component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {news.map((item, i) => (
        // eslint-disable-next-line react/no-array-index-key -- no stable id on a news item
        <Box component="li" key={i} sx={{ pb: '10px', ...(i < news.length - 1 ? { borderBottom: '2px solid var(--ps-rule)', mb: '10px' } : null) }}>
          {item.url ? (
            <Box component="a" href={item.url} target="_blank" rel="noopener noreferrer" sx={LINK_SX}>{item.headline}</Box>
          ) : (
            <Box component="p" sx={{ ...INK_LINE_SX, fontWeight: 600 }}>{item.headline}</Box>
          )}
          {item.blurb && (
            <Box
              component="p"
              data-testid="decision-card-news-blurb"
              sx={{
                ...DIM_LINE_SX,
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {item.blurb}
            </Box>
          )}
          {item.publishedAt && (
            <Box component="p" sx={{ ...DIM_LINE_SX, fontSize: '13px' }}>{new Date(item.publishedAt).toLocaleDateString()}</Box>
          )}
        </Box>
      ))}
    </Box>
  );
}

/** The Bio tile: a three-column definition list (the card ships `bio: null` today, so this draws nothing). */
export function PsBio({ bio }) {
  const fields = [
    ['Age', bio?.age], ['Height', bio?.height], ['Weight', bio?.weight],
    ['College', bio?.college], ['Experience', bio?.experience], ['Draft', bio?.draft],
  ].filter(([, value]) => value != null);
  if (fields.length === 0) return null;
  return (
    <PsSection title="Bio" testId="decision-card-bio-section">
      <Box
        component="dl"
        data-testid="decision-card-bio"
        sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px 12px' }}
      >
        {fields.map(([label, value]) => (
          <Box key={label}>
            <Box component="dt" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{label}</Box>
            <Box component="dd" sx={{ m: 0, fontSize: '15px', fontWeight: 600 }}>{value}</Box>
          </Box>
        ))}
      </Box>
    </PsSection>
  );
}

/** The failed load: a 2px Danger edge, the warn pictogram and the house copy. A role=alert holds text only. */
export function PsLoadError({ children }) {
  return (
    <Box
      role="alert"
      data-testid="decision-card-load-error"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        m: '0 20px 20px',
        p: '12px 14px',
        border: '2px solid var(--ps-danger)',
        fontSize: '16px',
      }}
    >
      <PixelWarn color="var(--ps-danger)" />
      <span>{children}</span>
    </Box>
  );
}
