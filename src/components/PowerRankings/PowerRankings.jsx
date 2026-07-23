import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
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
  TableSortLabel,
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Skeleton,
  Stack,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import LeaderboardOutlinedIcon from '@mui/icons-material/LeaderboardOutlined';
import apiClient from '../../api/apiClient';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import TeamAvatar from '../common/TeamAvatar';

function OddsCell({ value, label }) {
  const pct = Math.round((value || 0) * 1000) / 10;
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 140 }}>
      <Box sx={{ flexGrow: 1 }} aria-label={`${label} ${pct}%`}>
        <LinearProgress variant="determinate" value={clamped} />
      </Box>
      <Typography variant="body2" sx={{ minWidth: 42, textAlign: 'right' }}>
        {pct}%
      </Typography>
    </Box>
  );
}

function MovementCell({ change }) {
  if (change === null || change === undefined) {
    return <Chip size="small" label="NEW" data-testid="movement-new" />;
  }
  if (change === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }} aria-label="no change">
        –
      </Typography>
    );
  }
  const up = change > 0;
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        color: up ? 'success.main' : 'error.main',
      }}
      aria-label={`${up ? 'up' : 'down'} ${Math.abs(change)}`}
    >
      {up ? <ArrowDropUpIcon fontSize="small" /> : <ArrowDropDownIcon fontSize="small" />}
      <Typography variant="body2" component="span">
        {Math.abs(change)}
      </Typography>
    </Box>
  );
}

function formatRecord(record) {
  if (!record) return '—';
  return record.ties ? `${record.wins}-${record.losses}-${record.ties}` : `${record.wins}-${record.losses}`;
}

function HighlightCard({ label, team, change, up }) {
  return (
    <Card variant="outlined" sx={{ flex: 1, minWidth: 220 }} data-testid={`highlight-card-${up ? 'mover' : 'faller'}`}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
            <TeamAvatar name={team.name} avatarUrl={team.avatarUrl} avatarStaticUrl={team.avatarStaticUrl} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {label}
              </Typography>
              <Typography variant="subtitle1" noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                {team.name}
              </Typography>
            </Box>
          </Stack>
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.25}
            sx={{ color: up ? 'success.main' : 'error.main', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            {up ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />}
            <Typography variant="h6" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
              {Math.abs(change)} Spot{Math.abs(change) === 1 ? '' : 's'}
            </Typography>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

const SORT_DEFAULT_DIRECTION = { rank: 'asc', winPct: 'desc', avgScore: 'desc' };

function sortRankings(rankings, orderBy, order) {
  const sorted = [...rankings];
  sorted.sort((a, b) => {
    const diff = (a[orderBy] || 0) - (b[orderBy] || 0);
    return order === 'asc' ? diff : -diff;
  });
  return sorted;
}

function PowerRankings() {
  const { leagueId } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [payload, setPayload] = useState(null);
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notComputed, setNotComputed] = useState(false);
  const [orderBy, setOrderBy] = useState('rank');
  const [order, setOrder] = useState('asc');

  useEffect(() => {
    fetchRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setPayload((prev) => {
      const rankings = prev?.data?.rankings;
      if (!Array.isArray(rankings)) return prev;
      return {
        ...prev,
        data: { ...prev.data, rankings: rankings.map((team) => applyTeamProfileUpdate(team, update)) },
      };
    });
    setStandings((prev) => prev.map((team) => applyTeamProfileUpdate(team, update)));
  }), [leagueId]);

  const fetchRankings = async () => {
    try {
      setLoading(true);
      setError(null);
      setNotComputed(false);
      const res = await apiClient.get(`/api/scoring/league/${leagueId}/power-rankings`);
      setPayload(res.data);
      apiClient
        .get(`/api/scoring/league/${leagueId}/standings`)
        .then((standingsRes) => setStandings(standingsRes.data?.standings || []))
        .catch(() => setStandings([]));
    } catch (err) {
      if (err.response?.status === 404) {
        setNotComputed(true);
        setPayload(null);
      } else {
        setError(err.response?.data?.error || err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const rankings = useMemo(() => payload?.data?.rankings || [], [payload]);
  const viewerTeamId = payload?.viewerTeamId ?? null;

  const sortedRankings = useMemo(
    () => sortRankings(rankings, orderBy, order),
    [rankings, orderBy, order]
  );

  const recordByTeamId = useMemo(() => {
    const map = new Map();
    for (const s of standings) map.set(s.teamId, s);
    return map;
  }, [standings]);

  const { biggestMover, biggestFaller } = useMemo(() => {
    const movers = rankings.filter((t) => typeof t.change === 'number' && t.change > 0);
    const fallers = rankings.filter((t) => typeof t.change === 'number' && t.change < 0);
    const mover = movers.reduce((best, t) => (!best || t.change > best.change ? t : best), null);
    const faller = fallers.reduce((worst, t) => (!worst || t.change < worst.change ? t : worst), null);
    return { biggestMover: mover, biggestFaller: faller };
  }, [rankings]);

  const handleSort = (key) => {
    if (orderBy === key) {
      setOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setOrderBy(key);
      setOrder(SORT_DEFAULT_DIRECTION[key]);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={220} height={48} sx={{ mb: 3 }} />
        <Skeleton variant="text" width={160} sx={{ mb: 2 }} />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={44} sx={{ mb: 1, borderRadius: 1 }} />
        ))}
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Typography variant="h4">Power Rankings</Typography>
        {payload && (
          <Typography variant="subtitle1" sx={{ color: 'text.secondary' }}>
            Season {payload.season} · Week {payload.week}
          </Typography>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {notComputed && (
        <Stack
          alignItems="center"
          justifyContent="center"
          spacing={1.5}
          sx={{ minHeight: 320, textAlign: 'center', color: 'text.secondary' }}
          data-testid="power-rankings-empty"
        >
          <LeaderboardOutlinedIcon sx={{ fontSize: 64, color: 'text.disabled' }} />
          <Typography variant="h6" sx={{ color: 'text.primary' }}>
            No rankings yet
          </Typography>
          <Typography variant="body2" sx={{ maxWidth: 360 }}>
            Rankings appear after the first scored week
          </Typography>
        </Stack>
      )}

      {payload && (
        <>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', mb: 2, display: 'block' }}
          >
            Computed {new Date(payload.data.computedAt).toLocaleString()} · {payload.data.runs}{' '}
            simulation runs
          </Typography>

          {(biggestMover || biggestFaller) && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
              {biggestMover && (
                <HighlightCard label="Biggest Mover" team={biggestMover} change={biggestMover.change} up />
              )}
              {biggestFaller && (
                <HighlightCard label="Biggest Faller" team={biggestFaller} change={biggestFaller.change} up={false} />
              )}
            </Stack>
          )}

          {isMobile ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {sortedRankings.map((team) => {
                const isViewer = viewerTeamId != null && team.teamId === viewerTeamId;
                return (
                  <Card
                    key={team.teamId}
                    data-testid={`power-ranking-row-${team.teamId}`}
                    data-viewer-team={isViewer || undefined}
                    variant="outlined"
                    sx={{
                      ...(isViewer && {
                        bgcolor: 'var(--accent-soft)',
                        borderLeft: '3px solid',
                        borderLeftColor: 'primary.main',
                      }),
                    }}
                  >
                    <CardContent>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1,
                          flexWrap: 'wrap',
                          mb: 0.5,
                        }}
                      >
                        <TeamAvatar name={team.name} avatarUrl={team.avatarUrl} avatarStaticUrl={team.avatarStaticUrl} size={32} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          #{team.rank} {team.name}
                        </Typography>
                        <MovementCell change={team.change} />
                      </Box>
                      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                        Win {Math.round((team.winPct || 0) * 1000) / 10}% · Avg {team.avgScore} ·{' '}
                        {formatRecord(recordByTeamId.get(team.teamId))}
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Box>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Playoff
                          </Typography>
                          <OddsCell value={team.playoffOdds} label="Playoff odds" />
                        </Box>
                        <Box>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Title
                          </Typography>
                          <OddsCell value={team.titleOdds} label="Title odds" />
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          ) : (
            <TableContainer component={Paper}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sortDirection={orderBy === 'rank' ? order : false}>
                      <TableSortLabel
                        active={orderBy === 'rank'}
                        direction={orderBy === 'rank' ? order : 'asc'}
                        onClick={() => handleSort('rank')}
                      >
                        Rank
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell>Record</TableCell>
                    <TableCell>Move</TableCell>
                    <TableCell align="right" sortDirection={orderBy === 'winPct' ? order : false}>
                      <TableSortLabel
                        active={orderBy === 'winPct'}
                        direction={orderBy === 'winPct' ? order : 'desc'}
                        onClick={() => handleSort('winPct')}
                      >
                        Win %
                      </TableSortLabel>
                    </TableCell>
                    <TableCell
                      align="right"
                      sortDirection={orderBy === 'avgScore' ? order : false}
                    >
                      <TableSortLabel
                        active={orderBy === 'avgScore'}
                        direction={orderBy === 'avgScore' ? order : 'desc'}
                        onClick={() => handleSort('avgScore')}
                      >
                        Avg Score
                      </TableSortLabel>
                    </TableCell>
                    <TableCell>Playoff Odds</TableCell>
                    <TableCell>Title Odds</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedRankings.map((team) => {
                    const isViewer = viewerTeamId != null && team.teamId === viewerTeamId;
                    return (
                      <TableRow
                        key={team.teamId}
                        data-testid={`power-ranking-row-${team.teamId}`}
                        data-viewer-team={isViewer || undefined}
                        sx={{
                          ...(isViewer && {
                            bgcolor: 'var(--accent-soft)',
                            borderLeft: '3px solid',
                            borderLeftColor: 'primary.main',
                          }),
                        }}
                      >
                        <TableCell>
                          <Typography variant="body1" sx={{ fontWeight: 700 }}>
                            {team.rank}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <TeamAvatar name={team.name} avatarUrl={team.avatarUrl} avatarStaticUrl={team.avatarStaticUrl} size={28} />
                            <Typography variant="body2">{team.name}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell>{formatRecord(recordByTeamId.get(team.teamId))}</TableCell>
                        <TableCell>
                          <MovementCell change={team.change} />
                        </TableCell>
                        <TableCell align="right">
                          {Math.round((team.winPct || 0) * 1000) / 10}%
                        </TableCell>
                        <TableCell align="right">{team.avgScore}</TableCell>
                        <TableCell>
                          <OddsCell value={team.playoffOdds} label="Playoff odds" />
                        </TableCell>
                        <TableCell>
                          <OddsCell value={team.titleOdds} label="Title odds" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}
    </Container>
  );
}

export default PowerRankings;
