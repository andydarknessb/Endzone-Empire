import React, { useId } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';
import { Card, PosChip } from '../../../shared/ui';
import PlayerAvatar from '../../../components/PlayerQuickView/PlayerAvatar';
import {
  columnTotals,
  formatPoints,
  formatStatLine,
  lineTwo,
  paceView,
  positionRingKey,
  starterStateView,
  unavailableLabel,
} from '../model/slotComparisonModel';

/**
 * The Starters table of Matchup Detail (ADR 0031, #899): one row per paired
 * slot instance, home on the left, the slot's PosChip in the middle, away on
 * the right, under a header row naming both Teams and above a totals footer.
 * Each filled side is a starter cell: the headshot (PlayerAvatar with a
 * position-colored ring and the initials fallback), the name with a state
 * marker (a live dot for `in_progress`, a check for `final`, a clock for
 * `scheduled`, nothing for an unknown state), "NFL vs OPP · clock" on the
 * second line, an inline pace bar with the projection on desktop, and the
 * tabular points. An Unavailable starter shows his reason ("on bye", "out",
 * "on IR") in place of the projection and no pace bar. On mobile a cell is
 * two lines, the points on the second, and the pace bar is dropped.
 *
 * The rows arrive already paired and ordered by the Matchup entity
 * (`pairStartersBySlot`, in the league's slot order); this widget renders
 * them as given and never pairs or re-sorts. Two callbacks: `onOpenPlayer(id)`
 * from a starter's name, and `onToggle(id)` from the rest of his cell, which
 * expands the row's stat line (`expandedId` is the open starter). The two are
 * sibling controls, not nested: the expand control is a full-cell button laid
 * under the cell's content, the name a button laid over it, so a click on
 * the name opens the player and a click anywhere else on the cell toggles.
 *
 * Composes `shared/ui` (Card, PosChip) and reaches below the island only for
 * PlayerAvatar, the sanctioned headshot (ADR 0031). Paints `dash-*` tokens,
 * the `pos-*` ring, and four app-group tokens: `--danger` for the live dot,
 * `--focus-ring` for the two controls' focus rings, `--radius-pill` for the
 * dot, the bars and the headshot ring, and `--transition-base` for the pace
 * fill. Every ink-on-surface pairing here (ink, dim and faint on the card and
 * on the surface2 footer and expanded strip) is already registered in
 * tokens.contrast.test.js; the pace fills (`dash-home` behind, `dash-away` at
 * or ahead, the design's success green in both themes) and the live dot
 * (`danger`, as the design paints it) are graphics beside text, not text
 * pairings.
 */
export default function SlotComparison({
  rows,
  homeName,
  awayName,
  expectedFinal,
  onOpenPlayer,
  expandedId,
  onToggle,
}) {
  const baseId = useId();
  // The headshot is a number-sized avatar, so its two sizes (38 desktop, 30
  // mobile, the sizes the brief rules; the canvas's mobile branch draws 28)
  // switch on the same breakpoint the CSS-only parts of the cell use.
  // `useTheme` falls back to the default theme outside a provider (a widget
  // test renders bare), where the callback form of useMediaQuery would not.
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const avatarSize = compact ? 30 : 38;
  const list = rows || [];
  const totals = columnTotals(list);
  const ef = expectedFinal || {};
  const count = `${list.length} ${list.length === 1 ? 'slot' : 'slots'}`;

  return (
    <Card data-testid="slot-comparison" title="Starters" count={count} tail={<Legend />}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          px: { xs: '14px', md: '18px' },
          py: '6px',
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--dash-faint)',
          borderBottom: '1px solid var(--dash-line)',
        }}
      >
        <Box component="span" sx={{ flex: '1 1 0', minWidth: 0, ...ELLIPSIS }}>
          {homeName || ''}
        </Box>
        <Box component="span" sx={{ flex: 'none', width: SLOT_COLUMN, textAlign: 'center' }}>
          Slot
        </Box>
        <Box component="span" sx={{ flex: '1 1 0', minWidth: 0, textAlign: 'right', ...ELLIPSIS }}>
          {awayName || ''}
        </Box>
      </Box>

      {list.length === 0 ? (
        <Box sx={{ px: { xs: '14px', md: '18px' }, py: '14px', fontSize: '13px', color: 'var(--dash-dim)' }}>
          No starters to compare yet.
        </Box>
      ) : (
        <>
          <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {list.map((row, i) => {
              const homeOpen = !!(row.home && expandedId != null && expandedId === row.home.id);
              const awayOpen = !!(row.away && expandedId != null && expandedId === row.away.id);
              const openPlayer = homeOpen ? row.home : awayOpen ? row.away : null;
              const panelId = `${baseId}-row-${i}-panel`;
              return (
                <Box
                  component="li"
                  data-testid="slot-row"
                  key={`${row.slot}-${row.home?.id ?? 'x'}-${row.away?.id ?? 'x'}-${i}`}
                  sx={{ borderTop: i ? '1px solid var(--dash-line)' : 0 }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', px: { xs: '8px', md: '6px' } }}>
                    <SideCell
                      player={row.home}
                      side="home"
                      expanded={homeOpen}
                      panelId={panelId}
                      avatarSize={avatarSize}
                      onToggle={onToggle}
                      onOpenPlayer={onOpenPlayer}
                    />
                    <Box sx={{ flex: 'none', width: SLOT_COLUMN, display: 'flex', justifyContent: 'center' }}>
                      <PosChip position={row.slot} />
                    </Box>
                    <SideCell
                      player={row.away}
                      side="away"
                      expanded={awayOpen}
                      panelId={panelId}
                      avatarSize={avatarSize}
                      onToggle={onToggle}
                      onOpenPlayer={onOpenPlayer}
                    />
                  </Box>
                  {openPlayer && <ExpandedStrip id={panelId} player={openPlayer} />}
                </Box>
              );
            })}
          </Box>

          <Box
            data-testid="slot-totals"
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              px: { xs: '14px', md: '18px' },
              py: '12px',
              borderTop: '1px solid var(--dash-line)',
              backgroundColor: 'var(--dash-surface2)',
              borderRadius: '0 0 var(--dash-radius) var(--dash-radius)',
            }}
          >
            <Box data-testid="slot-total-home" sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <Box component="span" sx={{ ...DISPLAY_NUM, fontSize: '22px' }}>{formatPoints(totals.home)}</Box>
              {ef.home != null && <Box component="span" sx={NOTE_NUM}>EF {formatPoints(ef.home)}</Box>}
            </Box>
            <Box component="span" sx={LABEL}>Totals</Box>
            <Box data-testid="slot-total-away" sx={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              {ef.away != null && <Box component="span" sx={NOTE_NUM}>EF {formatPoints(ef.away)}</Box>}
              <Box component="span" sx={{ ...DISPLAY_NUM, fontSize: '22px' }}>{formatPoints(totals.away)}</Box>
            </Box>
          </Box>
        </>
      )}
    </Card>
  );
}

// The slot column between the two sides: 56px desktop, 48px mobile.
const SLOT_COLUMN = { xs: 48, md: 56 };

const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

// The design's `.note`: 12px faint; `.num` adds tabular figures.
const NOTE = { fontSize: '12px', color: 'var(--dash-faint)' };
const NOTE_NUM = { ...NOTE, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

// The design's `.label`: the uppercase faint table label.
const LABEL = {
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--dash-faint)',
};

// The design's `.display.num` figure: the condensed face, tabular, bold, tight.
const DISPLAY_NUM = {
  fontFamily: 'var(--dash-font-display)',
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 700,
  lineHeight: 1,
  color: 'var(--dash-ink)',
};

const FOCUS_RING = { outline: '2px solid var(--focus-ring)', outlineOffset: -2 };

// Inline stroke icons on the design's 20px grid, one style (1.6 stroke, round
// caps and joins). Decorative: every use sits beside its meaning as text or
// inside a labelled marker.
const ICON_PATHS = {
  check: <path d="M4 10.5 8 14.5 16 6" />,
  clock: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </>
  ),
  chevU: <path d="M5 12.5 10 7.5l5 5" />,
};

function Icon({ name, size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', flex: 'none' }}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

// The design's `.dot` in the in-progress color: an 8px disc painted `--danger`,
// as build.mjs stateDot() and the slotList() legend paint it. The dashboard
// group has no dash-danger; `danger` is an app token defined in both themes
// (tokens.js), reached the way `--focus-ring` and `--radius-pill` are here, so
// the live marker stays red beside the pace bar's green at-or-ahead fill.
// `data-tone` declares that paint where a test can read it (jsdom drops a
// var() color from computed and inline style alike), as Badge's `data-variant`
// does; a regression to the accent changes both or is caught.
function LiveDot() {
  return (
    <Box
      component="span"
      data-testid="live-dot"
      data-tone="danger"
      aria-hidden="true"
      sx={{
        width: 8,
        height: 8,
        borderRadius: 'var(--radius-pill)',
        backgroundColor: 'var(--danger)',
        flex: 'none',
      }}
    />
  );
}

/**
 * A starter's state marker beside his name: the live dot, the final check or
 * the yet-to-play clock, as a labelled image so a screen reader hears the
 * state ("In progress") and not just a glyph. Nothing for an unknown state.
 */
function StateMark({ view }) {
  if (!view) return null;
  return (
    <Box
      component="span"
      role="img"
      aria-label={view.label}
      data-testid={`state-${view.kind}`}
      sx={{ display: 'flex', flex: 'none', color: 'var(--dash-faint)' }}
    >
      {view.kind === 'live' ? <LiveDot /> : <Icon name={view.kind === 'final' ? 'check' : 'clock'} size={14} />}
    </Box>
  );
}

// The header's legend (desktop only, as the design): the three markers with
// their words. Each marker is decorative here because its word sits beside it.
function Legend() {
  return (
    <Box
      component="span"
      data-testid="slot-legend"
      sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: '12px', whiteSpace: 'nowrap' }}
    >
      <Box component="span" sx={LEGEND_ITEM}><LiveDot />In progress</Box>
      <Box component="span" sx={LEGEND_ITEM}><Icon name="check" size={13} />Final</Box>
      <Box component="span" sx={LEGEND_ITEM}><Icon name="clock" size={13} />Yet to play</Box>
    </Box>
  );
}

const LEGEND_ITEM = { display: 'inline-flex', alignItems: 'center', gap: '4px' };

/**
 * The inline pace bar: the design's `.pace` track (5px, surface3) with the
 * filled share in `dash-home`, or `dash-away` once at or ahead of the
 * projection. Decorative: the points and the "N proj" text beside it say the
 * same thing in words. The fill width is an inline style so a test can read it.
 */
function PaceBar({ pace, width }) {
  return (
    <Box
      data-testid="pace-bar"
      aria-hidden="true"
      sx={{
        width,
        height: 5,
        flex: 'none',
        borderRadius: 'var(--radius-pill)',
        backgroundColor: 'var(--dash-surface3)',
        overflow: 'hidden',
      }}
    >
      <Box
        data-testid="pace-bar-fill"
        style={{ width: `${pace.percent}%` }}
        sx={{
          height: '100%',
          borderRadius: 'var(--radius-pill)',
          backgroundColor: pace.ahead ? 'var(--dash-away)' : 'var(--dash-home)',
          transition: 'width var(--transition-base) ease',
        }}
      />
    </Box>
  );
}

// The cell's grid: named areas so ONE markup serves both breakpoints. Desktop
// is the design's three-column cell (headshot, the name/line-two/pace stack,
// the 56px points column); mobile folds the points onto the second line beside
// line two and drops the pace row. The away side is the mirror image.
const CELL_GRID = {
  home: {
    xs: {
      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
      gridTemplateAreas: '"avatar name name" "avatar line2 points" "avatar pace pace"',
    },
    md: {
      gridTemplateColumns: 'auto minmax(0, 1fr) 56px',
      gridTemplateAreas: '"avatar name points" "avatar line2 points" "avatar pace points"',
    },
  },
  away: {
    xs: {
      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
      gridTemplateAreas: '"name name avatar" "points line2 avatar" "pace pace avatar"',
    },
    md: {
      gridTemplateColumns: '56px minmax(0, 1fr) auto',
      gridTemplateAreas: '"points name avatar" "points line2 avatar" "points pace avatar"',
    },
  },
};

/**
 * One side of a row. An empty side (a slot only the other manager filled)
 * keeps the column and draws nothing. A filled side is the design's
 * playerCell: two sibling controls, the full-cell expand button underneath
 * and the name button on top (see the widget docblock), and the content laid
 * over the expand button with pointer events off so a click on the headshot,
 * the line two or the points reaches the expand control.
 * The expand button names its panel through `aria-controls` only while the
 * panel is mounted, so the IDREF always resolves.
 */
function SideCell({ player, side, expanded, panelId, avatarSize, onToggle, onOpenPlayer }) {
  if (!player) {
    return <Box data-testid={`slot-cell-${side}`} sx={{ flex: '1 1 0', minWidth: 0 }} />;
  }
  const away = side === 'away';
  const state = starterStateView(player.game_state);
  // A starter yet to play is de-emphasized (the design's `dim`): dim name,
  // faint points.
  const dim = state?.kind === 'scheduled';
  const reason = unavailableLabel(player.availability);
  const pace = reason ? null : paceView(player.points, player.projected);
  const grid = CELL_GRID[side];

  return (
    <Box
      data-testid={`slot-cell-${side}`}
      sx={{
        position: 'relative',
        flex: '1 1 0',
        minWidth: 0,
        py: { xs: '8px', md: '10px' },
        px: { xs: '2px', md: '12px' },
      }}
    >
      <Box
        component="button"
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => onToggle?.(player.id)}
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          border: 0,
          p: 0,
          m: 0,
          background: 'transparent',
          borderRadius: '8px',
          cursor: 'pointer',
          pointerEvents: 'auto',
          '&:focus-visible': FOCUS_RING,
        }}
      >
        <Box component="span" sx={visuallyHidden}>{`Stats for ${player.name}`}</Box>
      </Box>

      <Box
        sx={{
          position: 'relative',
          pointerEvents: 'none',
          display: 'grid',
          alignItems: 'center',
          columnGap: { xs: '8px', md: '12px' },
          gridTemplateColumns: { xs: grid.xs.gridTemplateColumns, md: grid.md.gridTemplateColumns },
          gridTemplateAreas: { xs: grid.xs.gridTemplateAreas, md: grid.md.gridTemplateAreas },
          textAlign: away ? 'right' : 'left',
        }}
      >
        <Box
          data-testid="slot-headshot"
          sx={{
            gridArea: 'avatar',
            alignSelf: 'center',
            display: 'flex',
            flex: 'none',
            borderRadius: 'var(--radius-pill)',
            boxShadow: `0 0 0 2px var(--pos-${positionRingKey(player.position)})`,
          }}
        >
          <PlayerAvatar
            name={player.name}
            position={player.position}
            photoUrl={player.photo_url}
            size={avatarSize}
          />
        </Box>

        <Box
          sx={{
            gridArea: 'name',
            display: 'flex',
            alignItems: 'center',
            flexDirection: away ? 'row-reverse' : 'row',
            gap: { xs: '4px', md: '6px' },
            minWidth: 0,
          }}
        >
          <Box
            component="button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPlayer?.(player.id);
            }}
            sx={{
              position: 'relative',
              pointerEvents: 'auto',
              minWidth: 0,
              border: 0,
              p: 0,
              m: 0,
              background: 'transparent',
              font: 'inherit',
              fontSize: { xs: '13px', md: '14px' },
              fontWeight: 600,
              lineHeight: 1.45,
              textAlign: 'inherit',
              color: dim ? 'var(--dash-dim)' : 'var(--dash-ink)',
              cursor: 'pointer',
              ...ELLIPSIS,
              '&:hover': { textDecoration: 'underline' },
              '&:focus-visible': { ...FOCUS_RING, outlineOffset: 2, borderRadius: '4px' },
              // The name is a line of text; on mobile its hit area grows to
              // the 44px target without moving the layout.
              '&::after': {
                content: '""',
                position: 'absolute',
                top: -13,
                bottom: -13,
                left: -6,
                right: -6,
                display: { xs: 'block', md: 'none' },
              },
            }}
          >
            {player.name}
          </Box>
          <StateMark view={state} />
        </Box>

        <Box component="span" data-testid="slot-line2" sx={{ gridArea: 'line2', minWidth: 0, ...NOTE, ...ELLIPSIS }}>
          {lineTwo(player)}
        </Box>

        {reason ? (
          <Box
            component="span"
            data-testid="unavailable-reason"
            sx={{ gridArea: 'pace', mt: '2px', ...NOTE }}
          >
            {reason}
          </Box>
        ) : pace ? (
          <Box
            sx={{
              gridArea: 'pace',
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              flexDirection: away ? 'row-reverse' : 'row',
              gap: '8px',
              mt: '6px',
            }}
          >
            <PaceBar pace={pace} width={90} />
            <Box component="span" sx={NOTE_NUM}>{formatPoints(player.projected)} proj</Box>
          </Box>
        ) : null}

        <Box
          component="span"
          data-testid="slot-points"
          sx={{
            gridArea: 'points',
            alignSelf: 'center',
            justifySelf: 'end',
            textAlign: 'right',
            ...DISPLAY_NUM,
            fontSize: { xs: '18px', md: '24px' },
            color: dim ? 'var(--dash-faint)' : 'var(--dash-ink)',
          }}
        >
          {formatPoints(player.points)}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * The expanded row below a pair: the open starter's name and stat line on the
 * left, his pace bar and "points / projection proj" on the right (the reason
 * alone for an Unavailable starter), on the surface2 strip of the design. The
 * chevron is decorative and desktop-only, as the design draws it.
 */
function ExpandedStrip({ id, player }) {
  const statLine = formatStatLine(player.stats);
  const reason = unavailableLabel(player.availability);
  const pace = reason ? null : paceView(player.points, player.projected);
  return (
    <Box
      id={id}
      data-testid="slot-expanded"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { xs: 'flex-start', md: 'center' },
        gap: { xs: '6px', md: '12px' },
        px: { xs: '14px', md: '18px' },
        pt: '8px',
        pb: '12px',
        backgroundColor: 'var(--dash-surface2)',
        borderTop: '1px solid var(--dash-line)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0 }}>
        <Box component="span" sx={{ flex: 'none', ...NOTE }}>{player.name}</Box>
        <Box component="span" sx={{ fontSize: '13px', color: 'var(--dash-dim)' }}>
          {statLine || 'No stats recorded yet.'}
        </Box>
      </Box>
      <Box sx={{ flex: '1 1 0', display: { xs: 'none', md: 'block' } }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {reason ? (
          <Box component="span" data-testid="unavailable-reason" sx={NOTE}>{reason}</Box>
        ) : pace ? (
          <>
            <PaceBar pace={pace} width={120} />
            <Box component="span" sx={NOTE_NUM}>
              {formatPoints(player.points)} / {formatPoints(player.projected)} proj
            </Box>
          </>
        ) : (
          <Box component="span" sx={NOTE_NUM}>{formatPoints(player.points)} pts</Box>
        )}
        <Box sx={{ color: 'var(--dash-faint)', display: { xs: 'none', md: 'flex' } }}>
          <Icon name="chevU" size={16} />
        </Box>
      </Box>
    </Box>
  );
}
