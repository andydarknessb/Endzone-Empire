import React from 'react';
import { Box, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
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

export default function DraftGrades({ leagueId }) {
  const { phase, rows, viewerTeamId } = useDraftGrades(leagueId);
  const explainerId = `draft-grades-explainer-${leagueId}`;

  return (
    <Card
      data-testid="draft-grades"
      title="Draft Grades"
      tail="Net vs ADP"
      aria-busy={phase === 'loading'}
      sx={{ p: 0 }}
    >
      {phase === 'loading' && (
        <Box sx={{ p: 2.25, display: 'grid', gap: 1.25 }}>
          <Skeleton data-testid="draft-grades-skeleton" variant="text" width="100%" height={18} />
          <Skeleton data-testid="draft-grades-skeleton" variant="text" width="100%" height={18} />
          <Skeleton data-testid="draft-grades-skeleton" variant="text" width="100%" height={18} />
        </Box>
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
          <Table size="small" aria-label="Draft grades by Team" aria-describedby={explainerId}>
            <TableBody>
              {rows.map((row) => {
                const isViewer = row.teamId === viewerTeamId;
                // A malformed net (a legacy/partial computed row) renders as
                // not available rather than "NaN".
                const hasNet = Number.isFinite(row.adpNet);
                return (
                  <TableRow
                    key={row.teamId}
                    data-testid={`draft-grades-row-${row.teamId}`}
                    data-viewer-team={isViewer || undefined}
                    sx={
                      isViewer
                        ? {
                            backgroundColor: 'var(--dash-accent-soft)',
                            boxShadow: 'inset 3px 0 0 var(--dash-accent)',
                          }
                        : undefined
                    }
                  >
                    <TableCell
                      component="th"
                      scope="row"
                      sx={{ borderBottom: '1px solid var(--dash-line)', fontWeight: 'inherit' }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        <GradeChip grade={row.grade} />
                        <Box sx={{ display: 'grid', gap: 0.25, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Box component="span" sx={{ fontSize: '13.5px', color: 'var(--dash-ink)' }}>
                              {row.teamName}
                            </Box>
                            {isViewer && <Badge variant="you">You</Badge>}
                          </Box>
                          <Box
                            component="span"
                            data-testid="draft-grades-picks"
                            sx={{ fontSize: '11.5px', color: 'var(--dash-dim)', fontWeight: 400 }}
                          >
                            {pickLine(row)}
                          </Box>
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ borderBottom: '1px solid var(--dash-line)', verticalAlign: 'top' }}
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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
