import React, { useEffect, useState } from 'react';
import {
  Container,
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  Box,
  Chip,
  Button,
  TextField,
  Skeleton,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import apiClient from '../../api/apiClient';
import { isPickemOnly, shortLeagueTypeLabel } from '../../lib/leagueType';

// Turns a whole number of seconds into a short humanized string, e.g. "3h 42m".
function humanizeUptime(uptimeSec) {
  if (uptimeSec == null || Number.isNaN(uptimeSec)) return '-';
  const totalSeconds = Math.max(0, Math.floor(uptimeSec));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

const SYNC_JOBS = [
  { job: 'players', label: 'Sync Players' },
  { job: 'schedule', label: 'Sync Schedule' },
  { job: 'injuries', label: 'Sync Injuries' },
];

// Free, no-key data sources — usable without RapidAPI. These power the
// player quick-view (headshots, ADP, real prior-season stats).
const FREE_SYNC_JOBS = [
  { job: 'photos', label: 'Sync Headshots (TheSportsDB)' },
  { job: 'adp', label: 'Sync ADP (Fantasy Football Calculator)' },
  { job: 'season-stats', label: 'Sync Season Stats (Sleeper)' },
  { job: 'backfill-seasons', label: 'Backfill Seasons (from weekly stats)' },
  { job: 'defenses', label: 'Sync Team Defenses' },
];

// Tank01 allows ~1,000 requests a MONTH, so quota is an operational number, not
// a curiosity: at 'degraded' news stops and pollers slow down, at
// 'essential-only' only a finalized game's box score still goes out. Surfaced
// here so a burn is obvious without reading logs.
const QUOTA_MODE_COLOR = {
  ok: 'success',
  degraded: 'warning',
  'essential-only': 'warning',
  blocked: 'error',
};

function StatTile({ label, value, caption, tone }) {
  return (
    <Grid xs={12} sm={6} md={3}>
      <Paper
        sx={{
          p: 2,
          height: '100%',
          ...(tone === 'error' ? { bgcolor: 'error.main', color: 'error.contrastText' } : {}),
        }}
      >
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          {label}
        </Typography>
        <Typography variant="h4">{value}</Typography>
        {caption && (
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.85 }}>
            {caption}
          </Typography>
        )}
      </Paper>
    </Grid>
  );
}

function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState(null);

  const [season, setSeason] = useState('');
  const [week, setWeek] = useState('');
  const [syncState, setSyncState] = useState({
    players: { running: false, result: null, error: null },
    schedule: { running: false, result: null, error: null },
    injuries: { running: false, result: null, error: null },
    stats: { running: false, result: null, error: null },
    photos: { running: false, result: null, error: null },
    adp: { running: false, result: null, error: null },
    'season-stats': { running: false, result: null, error: null },
    'backfill-seasons': { running: false, result: null, error: null },
    defenses: { running: false, result: null, error: null },
  });

  useEffect(() => {
    fetchOverview();
  }, []);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setError(null);
      setForbidden(false);
      const res = await apiClient.get('/api/admin/overview');
      setOverview(res.data);
    } catch (err) {
      if (err.response?.status === 403) {
        setForbidden(true);
      } else {
        setError(err.response?.data?.error || err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const rapidApiConfigured = overview?.sync?.rapidApiConfigured !== false;

  const runSync = async (job) => {
    if (job === 'stats' && week === '') {
      setSyncState((prev) => ({
        ...prev,
        stats: { running: false, result: null, error: 'Week is required to sync stats' },
      }));
      return;
    }

    setSyncState((prev) => ({ ...prev, [job]: { running: true, result: null, error: null } }));

    try {
      const body = {};
      if (season !== '') body.season = Number(season);
      if (job === 'stats') body.week = Number(week);

      const res = await apiClient.post(`/api/admin/sync/${job}`, body);
      setSyncState((prev) => ({
        ...prev,
        [job]: { running: false, result: JSON.stringify(res.data), error: null },
      }));
    } catch (err) {
      setSyncState((prev) => ({
        ...prev,
        [job]: {
          running: false,
          result: null,
          error: err.response?.data?.error || err.message,
        },
      }));
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={220} height={48} sx={{ mb: 2 }} />
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {[0, 1, 2, 3].map((i) => (
            <Grid xs={12} sm={6} md={3} key={i}>
              <Skeleton variant="rounded" height={100} />
            </Grid>
          ))}
        </Grid>
        <Skeleton variant="rectangular" height={160} sx={{ mb: 3, borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 1 }} />
      </Container>
    );
  }

  if (forbidden) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error">Admin access required</Alert>
      </Container>
    );
  }

  if (!overview) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="error">{error || 'Unable to load the admin dashboard'}</Alert>
      </Container>
    );
  }

  const { users, leagues, recentSignups, sync, errors: errorInfo, uptimeSec } = overview;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Admin Dashboard
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <StatTile label="Total Users" value={users.total} />
        <StatTile
          label="Signups"
          value={`${users.signupsLast7Days} / ${users.signupsLast30Days}`}
          caption="Last 7 days / last 30 days"
        />
        <StatTile label="Uptime" value={humanizeUptime(uptimeSec)} />
        <StatTile
          label="Errors Since Boot"
          value={errorInfo.errorsSinceBoot}
          tone={errorInfo.errorsSinceBoot > 0 ? 'error' : undefined}
          caption={
            (errorInfo.lastErrorMessage || errorInfo.lastErrorAt
              ? `${errorInfo.lastErrorMessage || ''}${
                  errorInfo.lastErrorAt
                    ? ` (${new Date(errorInfo.lastErrorAt).toLocaleString()})`
                    : ''
                } · `
              : '') + `Sentry: ${errorInfo.sentryConfigured ? 'configured' : 'not configured'}`
          }
        />
      </Grid>

      <Paper sx={{ p: 2, mb: 3 }} data-testid="leagues-panel">
        <Typography variant="h6" sx={{ mb: 2 }}>
          Leagues
        </Typography>
        {leagues.length === 0 ? (
          <Typography sx={{ color: 'text.secondary' }}>No leagues yet</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>League Type</TableCell>
                  <TableCell>Draft Status</TableCell>
                  <TableCell>Season Status</TableCell>
                  <TableCell align="right">Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leagues.map((row, idx) => (
                  <TableRow key={`${isPickemOnly(row) ? 'pickem' : 'fantasy'}-${row.draft_status}-${row.season_status}-${idx}`}>
                    <TableCell>{shortLeagueTypeLabel(row)}</TableCell>
                    <TableCell>{row.draft_status}</TableCell>
                    <TableCell>{row.season_status}</TableCell>
                    <TableCell align="right">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} data-testid="sync-health-card">
        <Typography variant="h6" sx={{ mb: 2 }}>
          Sync Health
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography variant="body2">
            Last scheduler tick:{' '}
            {sync.scheduler.lastTickAt
              ? new Date(sync.scheduler.lastTickAt).toLocaleString()
              : 'Never'}
          </Typography>
          {sync.scheduler.lastTickError && (
            <Typography variant="body2" sx={{ color: 'error.main' }}>
              Last tick error: {sync.scheduler.lastTickError}
            </Typography>
          )}
          <Typography variant="body2">
            Last sync: {sync.scheduler.lastSyncAt ? new Date(sync.scheduler.lastSyncAt).toLocaleString() : 'Never'}
          </Typography>
          <Typography variant="body2">
            {sync.statsCoverage?.rows
              ? `${sync.statsCoverage.rows} stat rows through season ${sync.statsCoverage.season} week ${sync.statsCoverage.week}`
              : 'No stats synced yet'}
          </Typography>
          {sync.quota && (
            <Typography variant="body2" data-testid="quota-usage">
              {`Tank01 quota: ${sync.quota.used} / ${sync.quota.budget} calls this cycle `}
              {`(since ${sync.quota.cycleStart}, hard ceiling ${sync.quota.hardCeiling})`}
            </Typography>
          )}
          {sync.liveGameEngine && (
            <Typography variant="body2">
              {`Live clock source: ${sync.liveGameEngine.clockSource}`}
              {sync.liveGameEngine.clockSource !== sync.liveGameEngine.configuredClockSource
                ? ` (fallback: ESPN failed ${sync.liveGameEngine.espnConsecutiveFailures}x)`
                : ''}
              {sync.liveGameEngine.lastRunAt
                ? `, last tick ${new Date(sync.liveGameEngine.lastRunAt).toLocaleString()}`
                : ''}
            </Typography>
          )}
          {sync.liveGameEngine?.lastError && (
            <Typography variant="body2" sx={{ color: 'error.main' }}>
              Live clock error: {sync.liveGameEngine.lastError}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              label={rapidApiConfigured ? 'RapidAPI configured' : 'RapidAPI missing'}
              color={rapidApiConfigured ? 'success' : 'warning'}
              size="small"
            />
            {sync.quota && (
              <Chip
                label={`Quota ${sync.quota.mode}`}
                color={QUOTA_MODE_COLOR[sync.quota.mode] || 'default'}
                size="small"
                data-testid="quota-mode-chip"
              />
            )}
            {sync.liveGameEngine && (
              <Chip
                label={`Clock: ${sync.liveGameEngine.clockSource}`}
                color={sync.liveGameEngine.clockSource === 'espn' ? 'success' : 'warning'}
                size="small"
                data-testid="clock-source-chip"
              />
            )}
          </Box>
        </Box>
      </Paper>

      <Paper sx={{ p: 2, mb: 3 }} data-testid="recent-signups-panel">
        <Typography variant="h6" sx={{ mb: 2 }}>
          Recent Signups
        </Typography>
        {recentSignups.length === 0 ? (
          <Typography sx={{ color: 'text.secondary' }}>No recent signups</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Username</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {recentSignups.map((signup) => (
                  <TableRow key={signup.id}>
                    <TableCell>{signup.username}</TableCell>
                    <TableCell>{new Date(signup.created_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Paper sx={{ p: 2 }} data-testid="manual-sync-card">
        <Typography variant="h6" sx={{ mb: 2 }}>
          Manual Sync
        </Typography>

        {!rapidApiConfigured && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            RapidAPI credentials are not configured, so sync buttons are disabled.
          </Alert>
        )}

        <TextField
          label="Season"
          type="number"
          size="small"
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          sx={{ mb: 2, width: 140 }}
        />

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SYNC_JOBS.map(({ job, label }) => (
            <Box key={job}>
              <Button
                variant="contained"
                onClick={() => runSync(job)}
                disabled={!rapidApiConfigured || syncState[job].running}
              >
                {syncState[job].running ? `${label}…` : label}
              </Button>
              {syncState[job].error && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {syncState[job].error}
                </Alert>
              )}
              {syncState[job].result && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  {syncState[job].result}
                </Alert>
              )}
            </Box>
          ))}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextField
              label="Week"
              type="number"
              size="small"
              value={week}
              onChange={(e) => setWeek(e.target.value)}
              sx={{ width: 100 }}
            />
            <Button
              variant="contained"
              onClick={() => runSync('stats')}
              disabled={!rapidApiConfigured || syncState.stats.running || week === ''}
            >
              {syncState.stats.running ? 'Sync Stats…' : 'Sync Stats'}
            </Button>
          </Box>
          {syncState.stats.error && <Alert severity="error">{syncState.stats.error}</Alert>}
          {syncState.stats.result && <Alert severity="success">{syncState.stats.result}</Alert>}
        </Box>
      </Paper>

      <Paper sx={{ p: 2, mt: 3 }} data-testid="data-enrichment-card">
        <Typography variant="h6" sx={{ mb: 1 }}>
          Data Enrichment
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          Free, no-key sources that power the player quick-view. Safe to re-run;
          Headshots and Season Stats take up to a minute.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {FREE_SYNC_JOBS.map(({ job, label }) => (
            <Box key={job}>
              <Button
                variant="outlined"
                onClick={() => runSync(job)}
                disabled={syncState[job].running}
              >
                {syncState[job].running ? `${label}…` : label}
              </Button>
              {syncState[job].error && (
                <Alert severity="error" sx={{ mt: 1 }}>
                  {syncState[job].error}
                </Alert>
              )}
              {syncState[job].result && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  {syncState[job].result}
                </Alert>
              )}
            </Box>
          ))}
        </Box>
      </Paper>
    </Container>
  );
}

export default AdminDashboard;
