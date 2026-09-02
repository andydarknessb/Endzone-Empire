import React from 'react';
import { Box, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Badge, Card, GradeChip, Skeleton } from '../../../shared/ui';
import useDraftGrades from '../model/useDraftGrades';

/**
 * League Dashboard rail-top widget (ticket #642): every Team ranked by its
 * draft grade, with a round letter grade chip, the Team name, the one number
 * the grade is ranked on (Net vs ADP: how far the Team's picks landed past
 * their market ADP, summed, higher is better) and the Team's best steal and
 * worst reach, so a manager can see how the grade was earned. Projected
 * roster value used to sit here; it is not what the grade is based on and is
 * null at week 1 of a season, so it was showing a 0 beside every grade.
 *
 * Composes `shared/ui` (ADR 0020): `Card` for the labelled region and header
 * (title + the "Net vs ADP" tail), `GradeChip` for the per-row letter chip.
 * Colors come only from `--dash-*` tokens.
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

function formatNet(value) {
  const text = value.toLocaleString('en-US', NET_FORMAT);
  return value > 0 ? `+${text}` : text;
}

function describePick(pick) {
  const adp = Number.isFinite(pick.marketAdp) ? pick.marketAdp.toLocaleString('en-US', NET_FORMAT) : '?';
  return `${pick.name} (pick ${pick.pickNumber}, ADP ${adp})`;
}

function pickLine(row) {
  const parts = [];
  if (row.steal) parts.push(`Steal: ${describePick(row.steal)}`);
  if (row.reach) parts.push(`Reach: ${describePick(row.reach)}`);
  return parts.length > 0 ? parts.join(' · ') : 'Every pick landed at its ADP';
}

export default function DraftGrades({ leagueId }) {
  const { phase, rows, viewerTeamId } = useDraftGrades(leagueId);

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
          <Table size="small" aria-label="Draft grades by Team">
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
                    <TableCell sx={{ borderBottom: '1px solid var(--dash-line)' }}>
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
                            sx={{ fontSize: '11.5px', color: 'var(--dash-dim)' }}
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
                        {hasNet ? (
                          formatNet(row.adpNet)
                        ) : (
                          <>
                            <Box component="span" aria-hidden="true">
                              -
                            </Box>
                            <Box component="span" sx={visuallyHidden}>
                              Not available
                            </Box>
                          </>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <Typography
            data-testid="draft-grades-explainer"
            sx={{ px: 2.25, py: 1.5, fontSize: '11.5px', color: 'var(--dash-dim)' }}
          >
            Net vs ADP adds up how far each pick landed past its market ADP. Higher is better; a
            steal fell to the Team, a reach went early.
          </Typography>
        </>
      )}
    </Card>
  );
}
