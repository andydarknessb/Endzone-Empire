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
 * centre column, a header row naming both Teams, the "Pts / proj" and "Exp final" column labels, and a
 * Totals row. The viewer's side comes first (Critique 4 item 1, spec #2402): the page hands the
 * board's `first` and `second` sides and the rows in that order, and the widget draws them as given,
 * first on the left and second on the right, right-aligned. A cell's test id keeps the side's `origin`
 * ('home' or 'away'), so a reader finds a team by what it is.
 *
 * Each filled side is a starter cell: the name (a button that opens the player) with his injury tag,
 * "NFL vs OPP · clock" on line two (the product's text; the product has no per-starter kickoff, so
 * none is drawn; a starter on bye reads "DET · Bye"), the state mark with its words while the matchup has
 * started (In progress a solid red square that blinks, stepped, lit then dim, and holds lit under reduced
 * motion; Final a 3x3 pixel checker; Yet to play an empty outline square; the legend's red sample never
 * blinks, #2395), the figure: his points, or "proj 17.9" while his game has not started (the reason ("out",
 * "on bye") in place of the projection for an Unavailable starter), and, on a wide screen while the
 * matchup is live, his Exp final (the producer's `expected_final`, a dash when it priced none). Before
 * kickoff no row repeats "Yet to play": the head says "Every starter yet to play" once and every figure
 * is a Proj, with no Exp final column (it would equal Proj). Once settled (`played` or `final`) every
 * starter is done: the head says "Every starter final" once in place of the legend and no row draws a
 * mark or its word (a `final` matchup is never priced, so its rows carry no state anyway, #2429).
 *
 * On a phone a cell is three lines (#2008, #2395): the name and injury tag; the mark (its word screen-reader
 * only) and the figure; the game on its own line, wrapping at spaces inside the half-width cell; each half keeps its side of a
 * 48px slot column so team names stay inside their halves. There is no Exp final column; the Totals
 * carry each Team's.
 *
 * An unfilled slot reads "Empty" before kickoff and "No starter" once started. `fillBy` is the lock
 * ("Sun 3:25 PM") and the page passes it only while its lineup note is showing; it is said on the
 * viewer's own side only, as "Fill by {lock}" before kickoff and "Empty · next kickoff {lock}" live.
 * The opponent's empty slot, a non-participant's and a best ball league's say nothing about a lock.
 *
 * The Totals row prints each Team's Matchup score (the board's `scoreLabel`, handed down as
 * `scoreLabels` `{ first, second }`; the widget sums nothing) with its Exp final, or the Proj total before kickoff.
 *
 * The rows (`[{ slot, first, second }]`) arrive already paired and ordered by the Matchup page model
 * (`pairStartersBySlot`); this widget renders them as given. `first` and `second` are the board's sides
 * (`{ name, origin, isViewer }` is all it reads); `expectedFinal` is `{ first, second }`. Two callbacks: `onOpenPlayer(id)` from a starter's name, and
 * `onToggle(id)` from the rest of his cell, which expands the row's stat line (`expandedId` is the
 * open starter). The two are sibling controls, not nested: the expand control is a full-cell button
 * laid under the cell's content, the name a button laid over it.
 *
 * Paints only `ps-*` tokens and the `pos-*` position tags (a data encoding).
 */
export default function SlotComparison({
  rows,
  first,
  second,
  expectedFinal,
  scoreLabels,
  status,
  onOpenPlayer,
  expandedId,
  onToggle,
  fillBy,
}) {
  const baseId = useId();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('md'));
  const list = rows || [];
  const phase = matchupPhase(status);
  const pre = phase.hasStarted === false;
  // The Exp final column: wide screens, once started, until the matchup settles (the strip and the LED
  // board hide it then, and the server still prices one, #2008 QA).
  const showExp = phase.hasStarted === true && !phase.settled && !compact;
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
          {pre || phase.settled
            ? <Box component="span" sx={{ ...META, flexBasis: { xs: '100%', md: 'auto' } }}>{pre ? 'Every starter yet to play' : 'Every starter final'}</Box>
            : <Legend />}
        </FrameHead>
      )}
    >
      <Box sx={{ ...COLUMNS, alignItems: 'start', padding: { xs: '12px 14px 8px', md: '14px 20px 8px' }, borderBottom: '2px solid var(--ps-rule)' }}>
        <TeamHead name={first?.name} you={!!first?.isViewer} />
        <Box component="span" sx={{ ...LABEL, textAlign: 'center' }}>Slot</Box>
        <TeamHead name={second?.name} you={!!second?.isViewer} right />
      </Box>
      {!compact && (
        <Box aria-hidden="true" sx={{ ...COLUMNS, padding: '6px 20px', borderBottom: '2px solid var(--ps-rule)', ...LABEL }}>
          <ColumnLabel pre={pre} showExp={showExp} />
          <span />
          <ColumnLabel pre={pre} showExp={showExp} right />
        </Box>
      )}

      {list.length === 0 ? (
        <Box sx={{ padding: '14px 20px', fontSize: '15px', color: 'var(--ps-dim)' }}>No starters to compare yet.</Box>
      ) : (
        <>
          <Box component="ul" role="list" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {list.map((row, i) => {
              const open = (key) => !!(row[key] && expandedId != null && expandedId === row[key].id);
              const openPlayer = open('first') ? row.first : open('second') ? row.second : null;
              const panelId = `${baseId}-row-${i}-panel`;
              const cellFor = (key, right) => (
                <SideCell
                  player={row[key]}
                  side={(right ? second : first)?.origin}
                  right={right}
                  pre={pre}
                  settled={phase.settled}
                  showExp={showExp}
                  expanded={open(key)}
                  panelId={panelId}
                  compact={compact}
                  fillBy={(right ? second : first)?.isViewer ? fillBy : undefined}
                  onToggle={onToggle}
                  onOpenPlayer={onOpenPlayer}
                />
              );
              return (
                <Box
                  component="li"
                  data-testid="slot-row"
                  key={`${row.slot}-${row.first?.id ?? 'x'}-${row.second?.id ?? 'x'}-${i}`}
                  sx={{ borderBottom: '2px solid var(--ps-rule)' }}
                >
                  <Box sx={{ ...COLUMNS, alignItems: 'center', minHeight: '56px', padding: { xs: '6px 14px', md: '6px 20px' } }}>
                    {cellFor('first', false)}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                      <PosTag position={row.slot} />
                      <Box component="span" sx={{ fontSize: '13px', fontWeight: 700, letterSpacing: '.04em', color: 'var(--ps-dim)', whiteSpace: 'nowrap' }}>{row.slot}</Box>
                    </Box>
                    {cellFor('second', true)}
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
            <Total side={first?.origin} now={scoreLabels?.first} ef={ef.first} pre={pre} showExp={showExp} />
            <Box component="span" sx={{ ...LABEL, textAlign: 'center', fontWeight: 700, color: 'var(--ps-ink)' }}>Totals</Box>
            <Total side={second?.origin} now={scoreLabels?.second} ef={ef.second} pre={pre} showExp={showExp} right />
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
const EXP_WIDTH = 64;
const STATE_WIDTH = 112;

function ColumnLabel({ pre, showExp, right }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexDirection: right ? 'row-reverse' : 'row', gap: '12px' }}>
      <span style={{ flex: 1 }} />
      {!pre && <span style={{ width: STATE_WIDTH, flex: 'none' }} />}
      <Box component="span" sx={{ width: FIG_WIDTH, flex: 'none', textAlign: 'right', whiteSpace: 'nowrap' }}>{pre ? 'Proj' : 'Pts / proj'}</Box>
      {showExp && <Box component="span" sx={{ width: EXP_WIDTH, flex: 'none', textAlign: 'right', whiteSpace: 'nowrap' }}>Exp final</Box>}
    </Box>
  );
}

// The YOU tag sits under the name so it never takes name width; the name truncates to one line (#2363).
function TeamHead({ name, you, right }) {
  return (
    <Box data-testid="slot-team-head" sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexDirection: right ? 'row-reverse' : 'row', minWidth: 0, textAlign: right ? 'right' : 'left' }}>
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}><TeamMark name={name || ''} /></Box>
      <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: right ? 'flex-end' : 'flex-start', gap: '4px' }}>
        <Box component="span" data-testid="slot-team-name" title={name || undefined} sx={{ ...pixelSx(16), minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || ''}</Box>
        {you && <YouTag />}
      </Box>
    </Box>
  );
}

// The three state marks (#2395): a blinking red square for in progress (the legend's sample holds
// still), a 3x3 pixel checker for final, an empty outline square for yet to play. Each sets its own
// colour; the words ride beside them on a wide screen and are screen-reader-only on a phone.
function StateShape({ kind, still }) {
  const base = { width: '12px', height: '12px', flex: 'none', boxSizing: 'border-box', display: 'block' };
  if (kind === 'live') return <Box component="span" aria-hidden="true" data-testid="state-live" className={still ? undefined : 'live-light'} sx={{ ...base, backgroundColor: 'var(--ps-danger)' }} />;
  if (kind === 'final') {
    return (
      <Box component="svg" aria-hidden="true" data-testid="state-final" viewBox="0 0 3 3" shapeRendering="crispEdges" sx={{ ...base, fill: 'var(--ps-ink)' }}>
        {[[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="1" height="1" />)}
      </Box>
    );
  }
  return <Box component="span" aria-hidden="true" data-testid="state-scheduled" sx={{ ...base, border: '2px solid var(--ps-dim)' }} />;
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
          <StateShape kind={kind} still />
          {word}
        </Box>
      ))}
    </Box>
  );
}

// An Exp final figure: a hundredth-rounded number to one decimal, a dash when nothing priced it.
const expText = (value) => (value == null || !Number.isFinite(Number(value)) ? '–' : formatPoints(value));

// The Exp final cell of a row or the Totals: "Exp final" for a screen reader beside the figure (the column label is aria-hidden).
function ExpCell({ value, testId }) {
  return (
    <Box
      component="span"
      data-testid={testId}
      sx={{ width: EXP_WIDTH, flex: 'none', textAlign: 'right', fontSize: '15px', color: 'var(--ps-dim)', fontVariantNumeric: 'tabular-nums' }}
    >
      <Box component="span" sx={SR_ONLY_SX}>Exp final </Box>
      {expText(value)}
    </Box>
  );
}

function Total({
  side, now, ef, pre, showExp, right,
}) {
  const ink = { fontSize: '18px', fontWeight: 700 };
  if (showExp) {
    // A wide live screen: the score under "Pts / proj" and the Exp final under "Exp final", in the rows' columns.
    return (
      <Box
        data-testid={`slot-total-${side}`}
        sx={{ display: 'flex', alignItems: 'center', gap: '12px', flexDirection: right ? 'row-reverse' : 'row', fontVariantNumeric: 'tabular-nums' }}
      >
        <span style={{ flex: 1 }} />
        <span style={{ width: STATE_WIDTH, flex: 'none' }} />
        <Box component="span" sx={{ width: FIG_WIDTH, flex: 'none', textAlign: 'right' }}>
          <Box component="b" sx={ink}>{now}</Box>
          {' '}
          <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>pts</Box>
        </Box>
        {ef != null && <ExpCell value={ef} testId="slot-exp-final" />}
      </Box>
    );
  }
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

/**
 * An unfilled slot: "Empty" before kickoff, "No starter" once started. On the viewer's own side with
 * a lock to name (`fillBy`): "Fill by {lock}" before kickoff, "Empty · next kickoff {lock}" live. A
 * wide started row also prints the 0.0 an empty slot scores, in the figure column (and the Exp final one while live).
 */
function EmptyCell({
  side, right, pre, compact, showExp, fillBy,
}) {
  const second = fillBy ? (pre ? `Fill by ${fillBy}` : `Empty · next kickoff ${fillBy}`) : null;
  return (
    <Box data-testid={`slot-cell-${side}`} sx={{ display: 'flex', alignItems: 'center', gap: '12px', flexDirection: right ? 'row-reverse' : 'row', minWidth: 0, textAlign: right ? 'right' : 'left', py: '6px' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ fontSize: '15px', color: 'var(--ps-dim)' }}>{pre ? 'Empty' : 'No starter'}</Box>
        {second && <Box sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{second}</Box>}
      </Box>
      {!compact && !pre && (
        <>
          <span style={{ width: STATE_WIDTH, flex: 'none' }} />
          <Box component="span" sx={{ width: FIG_WIDTH, flex: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            <Box component="b" sx={{ fontSize: '16px', fontWeight: 700 }}>0.0</Box>
            {' '}
            <Box component="span" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>pts</Box>
          </Box>
          {showExp && <ExpCell value={0} />}
        </>
      )}
    </Box>
  );
}

const FOCUS_RING = { outline: '3px solid var(--ps-focus)', outlineOffset: 0, boxShadow: '0 0 0 7px var(--ps-halo)' };

/**
 * One side of a row. An empty side renders EmptyCell. A filled side is two sibling controls, the
 * full-cell expand button underneath and the name button on top, the content laid over the expand
 * button with pointer events off so a click anywhere but the name reaches the expand control. The
 * expand button names its panel through `aria-controls` only while the panel is mounted, so the
 * IDREF always resolves. `right` is the visual position (the right column mirrors the left); `side` is
 * the side's `origin` ('home' or 'away'), used for the test id.
 */
function SideCell({
  player, side, right, pre, settled, showExp, expanded, panelId, compact, fillBy, onToggle, onOpenPlayer,
}) {
  if (!player) return <EmptyCell side={side} right={right} pre={pre} compact={compact} showExp={showExp} fillBy={fillBy} />;
  // A settled matchup is never priced, so every game is final and the head says so once; no per-row mark.
  const state = settled ? null : starterStateView(player.game_state);
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
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--ps-dim)', flexDirection: right ? 'row-reverse' : 'row' }}>
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
          position: 'relative', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: '12px', flexDirection: right ? 'row-reverse' : 'row', textAlign: right ? 'right' : 'left',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: '4px 8px', justifyContent: right ? 'flex-end' : 'flex-start' }}>
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
            <>
              <Box
                data-testid="slot-line2"
                sx={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', fontSize: '14px', justifyContent: right ? 'flex-end' : 'flex-start', fontVariantNumeric: 'tabular-nums',
                }}
              >
                {!pre && state && (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexDirection: right ? 'row-reverse' : 'row' }}>
                    <StateShape kind={state.kind} />
                    <Box component="span" sx={SR_ONLY_SX}>{state.label}</Box>
                  </Box>
                )}
                <span data-testid="slot-points">{figure}</span>
              </Box>
              <Box data-testid="slot-game" sx={{ fontSize: '13px', color: 'var(--ps-dim)', overflowWrap: 'break-word' }}>{lineTwo(player, notStarted)}</Box>
            </>
          ) : (
            <Box data-testid="slot-line2" sx={{ fontSize: '13px', color: 'var(--ps-dim)' }}>{lineTwo(player, notStarted)}</Box>
          )}
        </Box>
        {!compact && !pre && <Box sx={{ width: STATE_WIDTH, flex: 'none' }}>{marker}</Box>}
        {!compact && (
          <Box data-testid="slot-points" sx={{ width: FIG_WIDTH, flex: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{figure}</Box>
        )}
        {showExp && <ExpCell value={player.expected_final} testId="slot-row-exp-final" />}
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
