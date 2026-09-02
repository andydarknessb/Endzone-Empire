import React from 'react';
import { Box, Table, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Card, GradeChip, Skeleton } from '../../../shared/ui';
import useDraftGrades from '../model/useDraftGrades';

/**
 * League Dashboard rail-top widget (ticket #642): every Team ranked by its
 * draft grade, with a round letter grade chip, the Team name, and the roster
 * value as a number plus a proportional bar. The viewer's own row carries the
 * accent row treatment so it stands out in a list of every Team, not just its
 * own.
 *
 * Composes `shared/ui` (ADR 0020): `Card` for the labelled region and header
 * (title + the "Roster value" tail), `GradeChip` for the per-row letter chip.
 * Colors come only from `--dash-*` tokens.
 *
 * Bars scale to the highest roster value in the response, so that row alone
 * reaches 100%. Each bar is a real `progressbar`: `aria-valuenow` carries the
 * roster value and `aria-valuemax` the highest value in the response, so the
 * proportion is observable to assistive tech, not only visual. `aria-valuetext`
 * is required alongside those: without it, assistive tech reads the value as a
 * PERCENTAGE of min/max (the ARIA default), which would announce "81%" for a
 * number the sighted reader sees as 1,284 - so it carries the same "N of max"
 * reading a sighted user gets from the number beside the bar.
 *
 * The viewer's row gets the accent background/border (color only, as the
 * mockup has it) plus a visually-hidden "Your team" marker in the name cell,
 * so the row is identifiable in the accessibility tree, not only by color
 * (WCAG 1.4.1). This is a widget-local choice, not the `data-viewer-team` /
 * no-label convention #182 set for PowerRankings and Pick'em standings: #182
 * scoped itself to those two surfaces and left every other one ("#113's
 * surfaces decide that for themselves") to choose its own treatment.
 *
 * The card owns its one read (the draft-grades endpoint) and is the region
 * that owns it, so it carries `aria-busy` while that read is in flight
 * (Skeleton.jsx: the loading state is announced by the owning card, not by
 * each aria-hidden shape).
 */
export default function DraftGrades({ leagueId }) {
  const { phase, rows, viewerTeamId, maxRosterValue } = useDraftGrades(leagueId);

  return (
    <Card
      data-testid="draft-grades"
      title="Draft Grades"
      tail="Roster value"
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
        <Table size="small" aria-label="Draft grades by Team">
          <TableBody>
            {rows.map((row) => {
              const isViewer = row.teamId === viewerTeamId;
              // A malformed roster value (a legacy/partial computed row) falls
              // back to 0 for the bar's math rather than feeding NaN into
              // aria-valuenow / a "NaN%" width.
              const hasValue = Number.isFinite(row.rosterValue);
              const safeValue = hasValue ? row.rosterValue : 0;
              const pct = hasValue && maxRosterValue > 0 ? (safeValue / maxRosterValue) * 100 : 0;
              const valueText = hasValue
                ? `${safeValue.toLocaleString('en-US')} of ${maxRosterValue.toLocaleString('en-US')}`
                : 'Not available';
              return (
                <TableRow
                  key={row.teamId}
                  data-testid={`draft-grades-row-${row.teamId}`}
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
                      <Box component="span" sx={{ fontSize: '13.5px', color: 'var(--dash-ink)' }}>
                        {row.teamName}
                      </Box>
                      {isViewer && (
                        <Box component="span" sx={visuallyHidden}>
                          Your team
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ borderBottom: '1px solid var(--dash-line)' }}>
                    <Box sx={{ display: 'grid', gap: 0.5, justifyItems: 'end', minWidth: 90 }}>
                      <Box
                        component="span"
                        sx={{
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: '12.5px',
                          color: 'var(--dash-dim)',
                        }}
                      >
                        {hasValue ? (
                          safeValue.toLocaleString('en-US')
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
                      <Box
                        role="progressbar"
                        aria-label={`${row.teamName} roster value`}
                        aria-valuenow={safeValue}
                        aria-valuemin={0}
                        aria-valuemax={maxRosterValue}
                        aria-valuetext={valueText}
                        sx={{
                          width: '100%',
                          height: 4,
                          borderRadius: '2px',
                          backgroundColor: 'var(--dash-surface2)',
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          sx={{
                            height: '100%',
                            borderRadius: '2px',
                            backgroundColor: 'var(--dash-accent)',
                            width: `${pct}%`,
                          }}
                        />
                      </Box>
                    </Box>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
