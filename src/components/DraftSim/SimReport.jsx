import React from 'react';
import {
  Alert, AlertTitle, Box, Button, Chip, Divider, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import PositionChip from '../PlayerQuickView/PositionChip';
import CTABanner from '../public/kit/CTABanner';
import { templateFor } from '../../lib/draftSim/templates';

const GRADE_COLOR = { A: 'success.main', B: 'success.main', C: 'warning.main', D: 'error.main', F: 'error.main' };
const SEVERITY_TO_ALERT = { critical: 'error', warn: 'warning', info: 'info' };
const BALANCE_COLOR = { ok: 'success.main', warn: 'warning.main', critical: 'error.main' };

const LABEL_CHIP = {
  steal: { label: 'Steal', color: 'success' },
  reach: { label: 'Reach', color: 'error' },
  'no-market': { label: 'No market', color: 'default' },
};

function signed(value) {
  const n = Number(value) || 0;
  return n > 0 ? `+${n}` : String(n);
}

function StatTile({ label, value, hint }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
      {hint && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{hint}</Typography>
      )}
    </Box>
  );
}

/**
 * The post-draft report: an A-F grade against the CPU field, a per-pick value
 * table, position balance, and the roster-construction critiques that are the
 * actual point of running a mock.
 *
 * Position balance is drawn with plain Box widths rather than a chart library —
 * the initial-JS budget has no room for one, and a bar is a div.
 */
function SimReport({ report, config, onRestart, showCta = false }) {
  if (!report) return null;
  const template = templateFor(config.leagueType);
  const bench = report.totals.benchQuality;

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
          <Box
            sx={{
              width: 96, height: 96, borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              border: 3, borderStyle: 'solid', borderColor: GRADE_COLOR[report.grade] || 'text.primary',
              flexShrink: 0,
            }}
          >
            <Typography
              variant="h2"
              component="p"
              sx={{ fontWeight: 900, color: GRADE_COLOR[report.grade] || 'text.primary' }}
            >
              {report.grade}
            </Typography>
          </Box>
          <Box>
            <Typography variant="h4" component="h2" sx={{ fontWeight: 800 }}>
              Draft grade {report.grade}
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {report.rank ? `${report.rank} of ${report.teamCount}` : 'Ungraded'} in this{' '}
              {config.totalTeams}-team {template.name} mock. Grades compare every team&apos;s picks
              against market ADP — the same math the app uses to grade real league drafts.
            </Typography>
            {report.gradeCapped && (
              <Typography variant="body2" sx={{ color: 'warning.main', fontWeight: 600, mt: 1 }}>
                Graded down from {report.valueGrade} on market value —{' '}
                {report.criticalCount} critical roster gap{report.criticalCount === 1 ? '' : 's'} below
                cap{report.criticalCount === 1 ? 's' : ''} the grade at C. A lineup you can&apos;t field
                scores zero.
              </Typography>
            )}
          </Box>
        </Stack>

        <Divider sx={{ my: 2.5 }} />

        <Stack direction="row" spacing={4} flexWrap="wrap" useFlexGap>
          <StatTile label="Steals" value={report.totals.steals} hint="picks well below market" />
          <StatTile label="Reaches" value={report.totals.reaches} hint="picks well above market" />
          <StatTile label="Market delta" value={signed(report.totals.draftValueScore)} hint="lower is better" />
          <StatTile
            label="Projected starters"
            value={Math.round(report.totals.starterPoints)}
            hint="season points, best lineup"
          />
          {bench && <StatTile label="Bench" value={Math.round(bench.benchPoints)} hint={bench.label} />}
        </Stack>
      </Paper>

      {report.issues.length > 0 && (
        <Box>
          <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>What to do differently</Typography>
          <Stack spacing={1.5}>
            {report.issues.map((issue) => (
              <Alert key={issue.id} severity={SEVERITY_TO_ALERT[issue.severity] || 'info'}>
                <AlertTitle>{issue.title}</AlertTitle>
                <Typography variant="body2" sx={{ mb: 0.5 }}>{issue.detail}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{issue.suggestion}</Typography>
              </Alert>
            ))}
          </Stack>
        </Box>
      )}

      {report.issues.length === 0 && (
        <Alert severity="success">
          <AlertTitle>Clean build</AlertTitle>
          Nothing to flag — every starting slot is filled, byes are spread, and you have depth where
          it matters.
        </Alert>
      )}

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6" component="h2" sx={{ mb: 2 }}>Position balance</Typography>
        <Stack spacing={1.5}>
          {report.positionBalance.map((row) => {
            const scale = Math.max(row.max, row.count, 1);
            return (
              <Box key={row.position}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.position}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {row.count} rostered · {row.min} must start
                  </Typography>
                </Stack>
                <Box
                  role="img"
                  aria-label={`${row.position}: ${row.count} rostered, ${row.min} required`}
                  sx={{ height: 10, borderRadius: 5, bgcolor: 'action.hover', overflow: 'hidden' }}
                >
                  <Box
                    sx={{
                      height: '100%',
                      width: `${Math.min(100, (row.count / scale) * 100)}%`,
                      bgcolor: BALANCE_COLOR[row.status] || 'primary.main',
                    }}
                  />
                </Box>
              </Box>
            );
          })}
        </Stack>
      </Paper>

      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Typography variant="h6" component="h2" sx={{ mb: 2 }}>Your picks</Typography>
        <TableContainer sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Pick</TableCell>
                <TableCell>Player</TableCell>
                <TableCell align="right">ADP</TableCell>
                <TableCell align="right">vs. market</TableCell>
                <TableCell align="right">Bye</TableCell>
                <TableCell align="right">Proj</TableCell>
                <TableCell>Verdict</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {report.picks.map((pick) => {
                const chip = LABEL_CHIP[pick.label];
                return (
                  <TableRow key={pick.pickNumber}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {pick.round}.{String(pick.pickNumber).padStart(2, '0')}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <PositionChip position={pick.position} size="small" />
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{pick.name}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {pick.nflTeam || '—'}{pick.auto ? ' · auto-drafted' : ''}
                          </Typography>
                        </Box>
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{pick.adp == null ? '—' : pick.adp}</TableCell>
                    <TableCell align="right">
                      {pick.adpFallback ? '—' : signed(pick.draftValueScore)}
                    </TableCell>
                    <TableCell align="right">{pick.byeWeek ?? '—'}</TableCell>
                    <TableCell align="right">
                      {pick.projectedPoints == null ? '—' : Math.round(pick.projectedPoints)}
                    </TableCell>
                    <TableCell>
                      {chip ? <Chip size="small" label={chip.label} color={chip.color} /> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Box>
        <Button variant="contained" size="large" onClick={onRestart}>
          Run another mock draft
        </Button>
      </Box>

      {showCta && <CTABanner context="strategy" />}
    </Stack>
  );
}

export default SimReport;
