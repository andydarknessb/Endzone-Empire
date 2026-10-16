import React, { useId } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { matchupPhase } from '../../../entities/matchup';
import {
  Frame, FrameHead, InjuryTag, PixelHeading, PosTag, pixelSx, SR_ONLY_SX, TeamMark, YouTag,
} from '../../../shared/ui/playselect';
import {
  formatPoints,
  formatStatLine,
  lineTwo,
  starterStateView,
} from '../model/slotComparisonModel';
import { unavailableLabel } from '../../../entities/roster';

/**
 * The Starters frame of Matchup Detail (ADR 0031, #899), drawn as the board's primary frame (ADR
 * 0067 wave 2, spec #2334 ruling 4): both sides on one row with the slot and its position tag in the
 * centre column, a header row naming both Teams, the "Pts / proj" column label, and a Totals row.
 * Each filled side is a starter cell: the name (a button that opens the player) with his injury tag,
 * "NFL vs OPP · clock" on line two (the product's text; the product has no per-starter kickoff, so
 * none is drawn), the state marker with its words while the matchup has started (In progress a filled
 * square, Final an outline square, Yet to play an outline square with a dot, always beside the
 * words), and the figure: his points, or "proj 17.9" while his game has not started (the reason
 * ("out", "on bye") in place of the projection for an Unavailable starter). Before kickoff no row
 * repeats "Yet to play": the head says "Every starter yet to play" once and every figure is a Proj.
 *
 * On a phone a cell is two lines (#2008): the name and injury tag, then the state marker, the figure
 * and the game, wrapping rather than overflowing the half-width cell; each half keeps its side of a
 * 48px slot column so team names stay inside their halves.
 *
 * An unfilled slot reads "Empty" before kickoff and "No starter" once started, with "Fill by {lock}"
 * on line two when the page passes `fillBy` (the lock text). The Totals row prints each Team's Matchup
 * score (the board's `scoreLabel`, handed down as `scoreLabels`; the widget sums nothing) with "Exp
 * final {x}" under it, or the Proj total before kickoff.
 *
 * The rows arrive already paired and ordered by the Matchup page model (`pairStartersBySlot`); this
 * widget renders them as given. Two callbacks: `onOpenPlayer(id)` from a starter's name, and
 * `onToggle(id)` from the rest of his cell, which expands the row's stat line (`expandedId` is the
 * open starter). The two are sibling controls, not nested: the expand control is a full-cell button
 * laid under the cell's content, the name a button laid over it.
 *
 * Paints only `ps-*` tokens and the `pos-*` position tags (a data encoding).
 */
export default function SlotComparison({
  rows,
  homeName,
  awayName,
  expectedFinal,
  scoreLabels,
  status,
  onOpenPlayer,
  expandedId,
  onToggle,
  viewerSide,
  fillBy,
}) {
  const baseId = useId();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const list = rows || [];
  const phase = matchupPhase(status);
  const pre = phase.hasStarted === false;
  // A settled Matchup (played or final) has no Expected final to show: the strip and the LED board
  // hide it, and the server still prices one (#2008 QA).
  const ef = phase.settled ? {} : expectedFinal || {};
  const count = `${list.length} ${list.length === 1 ? 'slot' : 'slots'}`;
  const headingId = `${baseId}-h`;

  return (
    <Frame
      labelledBy={headingId}
      data-testid="slot-comparison"
      head={(
        <FrameHead>
          <PixelHeading id={headingId}>Starters</PixelHeading>
          <Box component="span" sx={{ ...META, ml: 'auto' }}>{count}</Box>
          {pre ? <Box component="span" sx={{ ...META, flexBasis: { xs: '100%', md: 'auto' } }}>Every starter yet to play</Box> : <Legend />}
        </FrameHead>
      )}
    >
      <Box sx={{ ...COLUMNS, alignItems: 'center', padding: { xs: '12px 14px 8px', md: '14px 20px 8px' }, borderBottom: '2px solid var(--ps-rule)' }}>
        <TeamHead name={homeName} you={viewerSide === 'home'} />
        <Box component="span" sx={{ ...LABEL, textAlign: 'center' }}>Slot</Box>
        <TeamHead name={awayName} you={viewerSide === 'away'} right />
      </Box>
      {!compact && (
        <Box aria-hidden="true" sx={{ ...COLUMNS, padding: '6px 20px', borderBottom: '2px solid var(--ps-rule)', ...LABEL }}>
          <ColumnLabel pre={pre} />
          <span />
          <ColumnLabel pre={pre} right />
        </Box>
      )}

      {list.length === 0 ? (
        <Box sx={{ padding: '14px 20px', fontSize: '15px', color: 'var(--ps-dim)' }}>No starters to compare yet.</Box>
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
                  sx={{ borderBottom: '2px solid var(--ps-rule)' }}
                >
                  <Box sx={{ ...COLUMNS, alignItems: 'center', minHeight: '56px', padding: { xs: '6px 14px', md: '6px 20px' } }}>
                    <SideCell
                      player={row.home}
                      side="home"
                      pre={pre}
                      expanded={homeOpen}
                      panelId={panelId}
                      compact={compact}
                      fillBy={fillBy}
                      onToggle={onToggle}
                      onOpenPlayer={onOpenPlayer}
                    />
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <PosTag position={row.slot} />
                      <Box component="span" sx={{ fontSize: '13px', fontWeight: 700, letterSpacing: '.04em', color: 'var(--ps-dim)', whiteSpace: 'nowrap' }}>{row.slot}</Box>
                    </Box>
                    <SideCell
                      player={row.away}
                      side="away"
                      pre={pre}
                      expanded={awayOpen}
                      panelId={panelId}
                      compact={compact}
                      fillBy={fillBy}
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
              ...COLUMNS, alignItems: 'center', padding: { xs: '12px 14px', md: '12px 20px' }, borderTop: '2px solid var(--ps-frame)', backgroundColor: 'var(--ps-field)',
            }}
          >
            <Total side="home" now={scoreLabels?.home} ef={ef.home} pre={pre} />
            <Box component="span" sx={{ ...LABEL, textAlign: 'center', fontWeight: 700, color: 'var(--ps-ink)' }}>Totals</Box>
            <Total side="away" now={scoreLabels?.away} ef={ef.away} pre={pre} />
          </Box>
        </>
      )}
    </Frame>
  );
}

// Both sides around the slot column: 48px on a phone, 88px from md up.
const COLUMNS = {
  display: 'grid',
  gridTemplateColumns: { xs: 'minmax(0, 1fr) 48px minmax(0, 1fr)', md: 'minmax(0, 1fr) 88px minmax(0, 1fr)' },
  gap: { xs: '0 8px', md: '0 20px' },
};

const META = { fontSize: '13px', color: 'var(--ps-dim)' };

const LABEL = {
  fontSize: '13px',
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: 'var(--ps-dim)',
};

const FIG_WIDTH = 84;

function ColumnLabel({ pre, right }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row', gap: '12px' }}>
      <span style={{ flex: 1 }} />
      <Box component="span" sx={{ width: FIG_WIDTH, flex: 'none', textAlign: 'right', whiteSpace: 'nowrap' }}>{pre ? 'Proj' : 'Pts / proj'}</Box>
    </Box>
  );
}

function TeamHead({ name, you, right }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexDirection: right ? 'row-reverse' : 'row', minWidth: 0, textAlign: right ? 'right' : 'left' }}>
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}><TeamMark name={name || ''} /></Box>
      <Box component="span" sx={{ ...pixelSx(16), minWidth: 0, overflowWrap: 'anywhere' }}>{name || ''}</Box>
      {you && <YouTag />}
    </Box>
  );
}

// The three state shapes (RULINGS Wave 2 boards): a filled square, an outline square, an outline
// square with a dot; the words always ride beside them.
function StateShape({ kind }) {
  const base = { width: '12px', height: '12px', flex: 'none', boxSizing: 'border-box' };
  if (kind === 'live') return <Box component="span" aria-hidden="true" data-testid="state-live" sx={{ ...base, backgroundColor: 'currentColor' }} />;
  if (kind === 'final') return <Box component="span" aria-hidden="true" data-testid="state-final" sx={{ ...base, border: '2px solid currentColor' }} />;
  return (
    <Box component="span" aria-hidden="true" data-testid="state-scheduled" sx={{ ...base, border: '2px solid currentColor', display: 'grid', placeItems: 'center' }}>
      <Box component="span" sx={{ width: '4px', height: '4px', backgroundColor: 'currentColor' }} />
    </Box>
  );
}

function Legend() {
  return (
    <Box
      component="span"
      data-testid="slot-legend"
      sx={{
        ...META, display: 'inline-flex', flexWrap: 'wrap', gap: '4px 20px', flexBasis: { xs: '100%', md: 'auto' },
      }}
    >
      {[['live', 'In progress'], ['final', 'Final'], ['scheduled', 'Yet to play']].map(([kind, word]) => (
        <Box key={kind} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <StateShape kind={kind} />
          {word}
        </Box>
      ))}
    </Box>
  );
}

function Total({ side, now, ef, pre }) {
  const right = side === 'away';
  const ink = { fontSize: '18px', fontWeight: 700 };
  return (
    <Box data-testid={`slot-total-${side}`} sx={{ minWidth: 0, textAlign: right ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>
      {pre ? (
        <span>
          <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>proj </Box>
          <Box component="b" sx={ink}>{ef != null ? formatPoints(ef) : '-'}</Box>
        </span>
      ) : (
        <>
          <Box component="b" sx={ink}>{now}</Box>
          {' '}
          <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>pts</Box>
          {ef != null && <Box data-testid="slot-exp-final" sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>{`Exp final ${formatPoints(ef)}`}</Box>}
        </>
      )}
    </Box>
  );
}

/** An unfilled slot: "Empty" before kickoff, "No starter" once started, and when the viewer can still fill it the lock. */
function EmptyCell({ side, pre, fillBy }) {
  const away = side === 'away';
  return (
    <Box data-testid={`slot-cell-${side}`} sx={{ minWidth: 0, textAlign: away ? 'right' : 'left', py: '6px' }}>
      <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>{pre ? 'Empty' : 'No starter'}</Box>
      {fillBy && <Box sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{`Fill by ${fillBy}`}</Box>}
    </Box>
  );
}

const FOCUS_RING = { outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)' };

/**
 * One side of a row. An empty side renders EmptyCell. A filled side is two sibling controls, the
 * full-cell expand button underneath and the name button on top, the content laid over the expand
 * button with pointer events off so a click anywhere but the name reaches the expand control. The
 * expand button names its panel through `aria-controls` only while the panel is mounted, so the
 * IDREF always resolves.
 */
function SideCell({ player, side, pre, expanded, panelId, compact, fillBy, onToggle, onOpenPlayer }) {
  if (!player) return <EmptyCell side={side} pre={pre} fillBy={fillBy} />;
  const away = side === 'away';
  const state = starterStateView(player.game_state);
  const reason = unavailableLabel(player);
  const notStarted = pre || player.game_state === 'scheduled';
  // "proj x" while his game has not started (the reason in its place for an Unavailable starter);
  // his points once it has. A starter yet to play is dim: nothing has happened.
  const figure = notStarted ? (
    reason ? <Box component="span" data-testid="unavailable-reason" sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>{reason}</Box> : (
      <>
        <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>proj </Box>
        <Box component="b" sx={{ fontSize: '16px', fontWeight: 600, color: 'var(--ps-dim)' }}>{formatPoints(player.projected)}</Box>
      </>
    )
  ) : (
    <>
      <Box component="b" sx={{ fontSize: '16px', fontWeight: 700 }}>{formatPoints(player.points)}</Box>
      {' '}
      <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>pts</Box>
    </>
  );
  const marker = !pre && state ? (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ps-dim)', flexDirection: away ? 'row-reverse' : 'row' }}>
      <StateShape kind={state.kind} />
      {state.label}
    </Box>
  ) : null;

  return (
    <Box data-testid={`slot-cell-${side}`} sx={{ position: 'relative', minWidth: 0, py: '6px' }}>
      <Box
        component="button"
        type="button"
        aria-expanded={expanded}
        aria-controls={expanded ? panelId : undefined}
        onClick={() => onToggle?.(player.id)}
        sx={{
          position: 'absolute', inset: 0, width: '100%', border: 0, p: 0, m: 0, background: 'transparent', borderRadius: 0, cursor: 'pointer', '&:focus-visible': FOCUS_RING,
        }}
      >
        <Box component="span" sx={SR_ONLY_SX}>{`Stats for ${player.name}`}</Box>
      </Box>
      <Box
        sx={{
          position: 'relative', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: '12px', flexDirection: away ? 'row-reverse' : 'row', textAlign: away ? 'right' : 'left',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', justifyContent: away ? 'flex-end' : 'flex-start' }}>
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
                fontSize: '15px',
                fontWeight: 600,
                lineHeight: 1.45,
                textAlign: 'inherit',
                color: 'var(--ps-ink)',
                cursor: 'pointer',
                overflowWrap: 'anywhere',
                '&:hover': { textDecoration: 'underline' },
                '&:focus-visible': FOCUS_RING,
                // A line of text; the hit area grows to the 44px target without moving the layout.
                '&::after': {
                  content: '""', position: 'absolute', top: -13, bottom: -13, left: -6, right: -6,
                },
              }}
            >
              {player.name}
            </Box>
            <InjuryTag status={player.injury_status} data-testid="injury-tag" />
          </Box>
          {compact ? (
            <Box
              data-testid="slot-line2"
              sx={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', fontSize: '14px', justifyContent: away ? 'flex-end' : 'flex-start', flexDirection: 'row', fontVariantNumeric: 'tabular-nums',
              }}
            >
              {!pre && state && (
                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--ps-dim)', flexDirection: away ? 'row-reverse' : 'row' }}>
                  <StateShape kind={state.kind} />
                  <Box component="span" sx={SR_ONLY_SX}>{state.label}</Box>
                </Box>
              )}
              <span data-testid="slot-points">{figure}</span>
              <Box component="span" data-testid="slot-game" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{lineTwo(player)}</Box>
            </Box>
          ) : (
            <Box data-testid="slot-line2" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{lineTwo(player)}</Box>
          )}
        </Box>
        {!compact && marker && <Box sx={{ width: '112px', flex: 'none' }}>{marker}</Box>}
        {!compact && (
          <Box data-testid="slot-points" sx={{ width: FIG_WIDTH, flex: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{figure}</Box>
        )}
      </Box>
    </Box>
  );
}

/**
 * The expanded row below a pair: the open starter's name and stat line on the left, his
 * "points / projection proj" (the reason alone for an Unavailable starter) on the right.
 */
function ExpandedStrip({ id, player }) {
  const statLine = formatStatLine(player.stats);
  const reason = unavailableLabel(player);
  return (
    <Box
      id={id}
      data-testid="slot-expanded"
      sx={{
        display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'flex-start', md: 'center' }, justifyContent: 'space-between', gap: { xs: '6px', md: '12px' }, padding: { xs: '8px 14px 12px', md: '8px 20px 12px' }, backgroundColor: 'var(--ps-field)', borderTop: '2px solid var(--ps-rule)', fontSize: '14px',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, flexWrap: 'wrap' }}>
        <Box component="span" sx={{ fontWeight: 600 }}>{player.name}</Box>
        <Box component="span" sx={{ color: 'var(--ps-dim)' }}>{statLine || 'No stats recorded yet.'}</Box>
      </Box>
      <Box sx={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ps-dim)' }}>
        {reason ? <span data-testid="unavailable-reason">{reason}</span> : player.projected != null
          ? `${formatPoints(player.points)} / ${formatPoints(player.projected)} proj`
          : `${formatPoints(player.points)} pts`}
      </Box>
    </Box>
  );
}
