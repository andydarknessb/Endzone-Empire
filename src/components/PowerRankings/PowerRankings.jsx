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
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notComputed, setNotComputed] = useState(false);
  const [orderBy, setOrderBy] = useState('rank');
  const [order, setOrder] = useState('asc');

  useEffect(() => {
    fetchRankings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  const fetchRankings = async () => {
    try {
      setLoading(true);
      setError(null);
      setNotComputed(false);
      const res = await apiClient.get(`/api/scoring/league/${leagueId}/power-rankings`);
      setPayload(res.data);
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

  const rankings = payload?.data?.rankings || [];
  const viewerTeamId = payload?.viewerTeamId ?? null;

  const sortedRankings = useMemo(
    () => sortRankings(rankings, orderBy, order),
    [rankings, orderBy, order]
  );

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
        <Alert severity="info" data-testid="power-rankings-empty">
          Rankings appear after the first scored week
        </Alert>
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
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          #{team.rank} {team.name}
                        </Typography>
                        <MovementCell change={team.change} />
                      </Box>
                      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                        Win {Math.round((team.winPct || 0) * 1000) / 10}% · Avg {team.avgScore}
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
                        <TableCell>{team.rank}</TableCell>
                        <TableCell>{team.name}</TableCell>
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
