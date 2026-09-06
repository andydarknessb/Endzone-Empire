import React from 'react';
import { Box, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Badge, Card, GradeChip, Skeleton } from '../../../shared/ui';
import useDraftGrades from '../model/useDraftGrades';

/**
 * League Dashboard rail-top widget (ticket #642): every Team ranked by its
 * draft grade, with a round letter grade chip, the Team name, the one number
 * the grade is ranked on (Net vs ADP: how far the Team's picks beat their
 * market ADP, summed, higher is better) and the Team's best steal and worst
 * reach, so a manager can see how the grade was earned. Projected roster
 * value used to sit here; it is not what the grade is based on and is null
 * at week 1 of a season, so it was showing a 0 beside every grade.
 *
 * Composes `shared/ui` (ADR 0020): `Card` for the labelled region and header
 * (title + the "Net vs ADP" tail), `GradeChip` for the per-row letter chip.
 * Colors come only from `--dash-*` tokens.
 *
 * The table is plain `table`/`tbody`/`tr`/`th`/`td` elements, NOT MUI's Table
 * primitives, and that is load-bearing rather than a style preference. The app
 * theme's `MuiTableBody` override (AppThemeProvider.jsx) emits
 * `.<tbody> .MuiTableRow-root { background-color: ... }` at specificity
 * (0,2,0), which beats any row-level `sx` at (0,1,0): under MUI this card's
 * viewer tint never painted (the app's zebra stripe won) while its inset accent
 * bar, a property the override does not set, did. `MuiTableCell` separately
 * spreads the `body2` typography, so every cell rendered in the app's Inter
 * instead of the island's inherited Archivo. Raising this widget's specificity
 * would be a war with the theme; leaving MUI's table is the fix, and it is the
 * same markup standings-table uses, so the two tables in this island share one
 * language.
 *
 * Table semantics follow standings-table: the Team cell is the row header
 * (`th scope="row"`), so a screen reader reading the number cell hears the
 * Team first; the number cell carries a visually hidden "Net vs ADP" label
 * because the table has no column header row, and the explainer under the
 * table is wired to it through `aria-describedby`.
 *
 * The viewer's row carries the visible `Badge variant="you"` pill (the League
 * Dashboard island's shared viewer-row marker, per #671) in the name cell,
 * plus the row's `data-viewer-team` attribute, so the row is identifiable in
 * the accessibility tree and to tooling, not only by color (WCAG 1.4.1). The
 * accent row background/border stays as a redundant visual cue rather than
 * the sole marker. #671 decided the question #182 left open for this table.
 *
 * The card owns its one read (the draft-grades endpoint) and is the region
 * that owns it, so it carries `aria-busy` while that read is in flight
 * (Skeleton.jsx: the loading state is announced by the owning card, not by
 * each aria-hidden shape).
 */

const NET_FORMAT = { maximumFractionDigits: 1 };

export const EXPLAINER_COPY =
  'Net vs ADP adds up how far each pick beat its market ADP. Higher is better: a steal fell to the Team later than its ADP, a reach went earlier.';

function formatNet(value) {
  const text = value.toLocaleString('en-US', NET_FORMAT);
  return value > 0 ? `+${text}` : text;
}

function describePick(pick) {
  const num = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US', NET_FORMAT) : '?');
  return `${pick.name} (pick ${num(pick.pickNumber)}, ADP ${num(pick.marketAdp)})`;
}

// A Team with no priced pick (no market ADP for any of them, the IDP-heavy
// case) has nothing to compare against; that is a different sentence from a
// priced draft where every pick landed exactly at its ADP.
function pickLine(row) {
  const parts = [];
  if (row.steal) parts.push(`Steal: ${describePick(row.steal)}`);
  if (row.reach) parts.push(`Reach: ${describePick(row.reach)}`);
  if (parts.length > 0) return parts.join(' · ');
  if (row.pricedPicks === 0) return 'No market ADP for these picks';
  return 'Every pick landed at its ADP';
}

const NotAvailable = () => (
  <>
    <Box component="span" aria-hidden="true">
      -
    </Box>
    <Box component="span" sx={visuallyHidden}>
      Not available
    </Box>
  </>
);

// The two cells' shared box: padding, the hairline under the row, and the
// normal body weight (a `th` defaults to bold, and the name span sets its own).
const CELL_SX = {
  px: 1.5,
  py: 1.25,
  borderBottom: '1px solid var(--dash-line)',
  fontWeight: 400,
};

// The table wrapper is the one box on this card allowed a zero minimum without
// a clip of its own: it scrolls (`overflowX`), so an over-wide table pans here
// instead of widening the rail.
function TableShell({ children, ...rest }) {
  return (
    <Box data-testid="draft-grades-scroll" sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          fontFamily: 'var(--dash-font-body)',
        }}
        {...rest}
      >
        <Box component="tbody">{children}</Box>
      </Box>
    </Box>
  );
}

export default function DraftGrades({ leagueId }) {
  const { phase, rows, viewerTeamId, teamCount } = useDraftGrades(leagueId);
  const explainerId = `draft-grades-explainer-${leagueId}`;

  // The placeholder holds the shape the real table will take: one skeleton row
  // per Team in the league, read from the membership this widget already has,
  // so the rail does not jump from a three-line block to twelve two-line rows
  // when the grades land. The floor of 1 covers the window where the league
  // read itself has not resolved and the count is still unknown.
  const skeletonRows = Math.max(teamCount, 1);

  return (
    <Card
      data-testid="draft-grades"
      title="Draft Grades"
      tail="Net vs ADP"
      aria-busy={phase === 'loading'}
      sx={{ p: 0 }}
    >
      {phase === 'loading' && (
        // Every shape inside is decorative and the owning Card already reports
        // `aria-busy`, so the placeholder table is hidden whole rather than
        // announced as a table of empty rows.
        <TableShell aria-hidden="true">
          {Array.from({ length: skeletonRows }, (_, i) => (
            <SkeletonRow key={`skeleton-${i}`} />
          ))}
        </TableShell>
      )}

      {phase === 'pending' && (
        <Typography
          data-testid="draft-grades-pending"
          sx={{ p: 2.25, fontSize: '13px', color: 'var(--dash-dim)' }}
        >
          Draft grades arrive once the draft is complete.
        </Typography>
      )}

      {phase === 'error' && (
        <Typography
          role="alert"
          data-testid="draft-grades-error"
          sx={{ p: 2.25, fontSize: '13px', color: 'var(--dash-ink)' }}
        >
          We could not load draft grades right now.
        </Typography>
      )}

      {phase === 'ready' && (
        <>
          <TableShell aria-label="Draft grades by Team" aria-describedby={explainerId}>
            {rows.map((row) => {
              const isViewer = row.teamId === viewerTeamId;
              // A malformed net (a legacy/partial computed row) renders as
              // not available rather than "NaN".
              const hasNet = Number.isFinite(row.adpNet);
              return (
                <Box
                  component="tr"
                  key={row.teamId}
                  data-testid={`draft-grades-row-${row.teamId}`}
                  data-viewer-team={isViewer || undefined}
                  sx={{
                    transition: 'background-color var(--transition-fast) ease',
                    ...(isViewer
                      ? {
                          backgroundColor: 'var(--dash-accent-soft)',
                          boxShadow: 'inset 3px 0 0 var(--dash-accent)',
                        }
                      : {
                          // `surface3`, not `surface2`: surface2 is a resting
                          // fill elsewhere on this island (stat tiles, the
                          // commissioner disclosure), so hovering to it would
                          // read as a state the row settled into rather than a
                          // pointer response. Both tables now mark the viewer
                          // with the accent tint above, so the old reason for
                          // avoiding surface2 (standings used it as the viewer
                          // marker) no longer applies; the choice does. Guarded
                          // on a real pointer so a tap does not leave a phantom
                          // hover behind on a touch screen.
                          '@media (hover: hover)': {
                            '&:hover': { backgroundColor: 'var(--dash-surface3)' },
                          },
                        }),
                  }}
                >
                  <Box component="th" scope="row" sx={{ ...CELL_SX, textAlign: 'left' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box sx={{ flex: 'none', display: 'flex' }}>
                        <GradeChip grade={row.grade} />
                      </Box>
                      {/* The zero minimum lets this column shrink below its
                          longest word; both lines inside clip, so it shrinks
                          rather than pushing the number cell off the card. */}
                      <Box sx={{ display: 'grid', gap: 0.25, minWidth: 0, overflow: 'hidden' }}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <Box
                            component="span"
                            sx={{
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '13.5px',
                              color: 'var(--dash-ink)',
                            }}
                          >
                            {row.teamName}
                          </Box>
                          {isViewer && <Badge variant="you" sx={{ flex: 'none' }}>You</Badge>}
                        </Box>
                        {/* Two lines, then ellipsis: a steal and a reach with
                            long player names is the common case and used to run
                            this rail card to twice the height of the standings
                            beside it. */}
                        <Box
                          component="span"
                          data-testid="draft-grades-picks"
                          sx={{
                            fontSize: '11.5px',
                            color: 'var(--dash-dim)',
                            fontWeight: 400,
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: 2,
                            overflow: 'hidden',
                          }}
                        >
                          {pickLine(row)}
                        </Box>
                      </Box>
                    </Box>
                  </Box>
                  <Box
                    component="td"
                    sx={{ ...CELL_SX, textAlign: 'right', verticalAlign: 'top' }}
                  >
                    <Box
                      component="span"
                      data-testid="draft-grades-net"
                      sx={{
                        fontVariantNumeric: 'tabular-nums',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--dash-ink)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <Box component="span" sx={visuallyHidden}>
                        Net vs ADP{' '}
                      </Box>
                      {hasNet ? formatNet(row.adpNet) : <NotAvailable />}
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </TableShell>
          <Typography
            id={explainerId}
            data-testid="draft-grades-explainer"
            sx={{ px: 2.25, py: 1.5, fontSize: '11.5px', color: 'var(--dash-dim)' }}
          >
            {EXPLAINER_COPY}
          </Typography>
        </>
      )}
    </Card>
  );
}

// One skeleton row holds the two-line shape of a real row (chip, name, pick
// line) so the placeholder and the loaded table are the same height.
function SkeletonRow() {
  return (
    <Box component="tr">
      <Box component="th" scope="row" sx={{ ...CELL_SX, textAlign: 'left' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Skeleton data-testid="draft-grades-skeleton" variant="circular" width={26} height={26} />
          <Box sx={{ display: 'grid', gap: 0.25, flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <Skeleton data-testid="draft-grades-skeleton" variant="text" width="60%" height={14} />
            <Skeleton data-testid="draft-grades-skeleton" variant="text" width="90%" height={12} />
          </Box>
        </Box>
      </Box>
      <Box component="td" sx={{ ...CELL_SX, textAlign: 'right' }}>
        <Skeleton
          data-testid="draft-grades-skeleton"
          variant="text"
          width={44}
          height={14}
          sx={{ ml: 'auto' }}
        />
      </Box>
    </Box>
  );
}
