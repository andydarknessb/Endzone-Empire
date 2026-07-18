import React, { useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Avatar,
  Typography,
  Chip,
  Alert,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Link,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import InjuryBadge from '../InjuryBadge/InjuryBadge';

const STAT_LABELS = {
  passingYards: 'Pass Yds',
  passingTDs: 'Pass TD',
  interceptions: 'INT',
  rushingYards: 'Rush Yds',
  rushingTDs: 'Rush TD',
  receivingYards: 'Rec Yds',
  receivingTDs: 'Rec TD',
  receptions: 'Rec',
  fumbles: 'Fum',
};

function statLine(stats) {
  const parts = Object.entries(stats || {})
    .filter(([key, value]) => STAT_LABELS[key] && Number(value) !== 0)
    .map(([key, value]) => `${value} ${STAT_LABELS[key]}`);
  return parts.length > 0 ? parts.join(', ') : '—';
}

const POSITION_COLORS = {
  QB: 'primary',
  RB: 'success',
  WR: 'secondary',
  TE: 'warning',
  K: 'info',
  DEF: 'error',
};

function positionAvatarSx(position) {
  const key = POSITION_COLORS[position] || 'primary';
  return {
    width: 72,
    height: 72,
    bgcolor: `${key}.main`,
    color: `${key}.contrastText`,
  };
}

function initialsFor(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

// Module-level: persists the last-selected toggle across dialog opens for the
// duration of the session (resets on full page reload). Intentionally not
// localStorage per the component contract.
let lastView = 'current';

function PlayerQuickView({ open, onClose, playerId, leagueId, draftedBy }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState(lastView);

  useEffect(() => {
    if (!open || !playerId) return;
    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const config = leagueId != null ? { params: { leagueId } } : undefined;
        const res = await apiClient.get(`/api/players/${playerId}/summary`, config);
        setData(res.data);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
  }, [open, playerId, leagueId]);

  const handleViewChange = (event, newView) => {
    if (!newView) return;
    lastView = newView;
    setView(newView);
  };

  const player = data?.player;
  const fantasy = data?.fantasy || {};
  const currentSeason = data?.currentSeason;
  const previousSeasons = data?.previousSeasons || [];
  const hasFantasy =
    fantasy.adp != null || fantasy.projectedPoints != null || fantasy.previousSeasonTotal != null;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          {player && (
            <>
              <Avatar
                src={player.photo_url}
                imgProps={{ loading: 'lazy' }}
                sx={positionAvatarSx(player.position)}
              >
                {initialsFor(player.name)}
              </Avatar>
              <Box>
                <Typography variant="h5" component="div">
                  {player.name}
                  {player.jersey_number != null && (
                    <Typography component="span" variant="body1" sx={{ color: 'text.secondary', ml: 1 }}>
                      #{player.jersey_number}
                    </Typography>
                  )}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                  <Chip label={player.position} color="primary" size="small" />
                  <Chip label={player.nfl_team || 'Free Agent'} size="small" />
                  <InjuryBadge status={player.injury_status} detail={player.injury_detail} />
                  {player.bye_week != null && (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Bye: Wk {player.bye_week}
                    </Typography>
                  )}
                </Box>
              </Box>
            </>
          )}
        </Box>
        <IconButton aria-label="Close" onClick={onClose} size="small">
          ✕
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {draftedBy && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {`Drafted by ${draftedBy}`}
          </Alert>
        )}

        {loading && (
          <Box data-testid="quickview-skeleton">
            <Skeleton variant="text" width={180} height={32} sx={{ mb: 1 }} />
            <Skeleton variant="rectangular" height={40} sx={{ mb: 1, borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={40} sx={{ mb: 1, borderRadius: 1 }} />
            <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
          </Box>
        )}

        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && player && (
          <>
            {player.news && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {player.news}
              </Alert>
            )}

            {hasFantasy && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }} data-testid="fantasy-strip">
                {fantasy.adp != null && (
                  <Chip size="small" variant="outlined" label={`ADP ${fantasy.adp}`} />
                )}
                {fantasy.projectedPoints != null && (
                  <Chip
                    size="small"
                    color="info"
                    label={`${fantasy.projectionSeason} Proj ${fantasy.projectedPoints}`}
                  />
                )}
                {fantasy.previousSeasonTotal != null && (
                  <Chip
                    size="small"
                    color="success"
                    label={`${fantasy.previousSeasonYear}: ${fantasy.previousSeasonTotal} pts`}
                  />
                )}
              </Box>
            )}

            <ToggleButtonGroup
              value={view}
              exclusive
              onChange={handleViewChange}
              size="small"
              color="primary"
              sx={{ mb: 2 }}
            >
              <ToggleButton value="current">Current Season</ToggleButton>
              <ToggleButton value="previous">Previous Seasons</ToggleButton>
            </ToggleButtonGroup>

            {view === 'current' ? (
              !currentSeason || (currentSeason.weekly || []).length === 0 ? (
                <Typography sx={{ color: 'text.secondary' }}>No current-season stats yet</Typography>
              ) : (
                <>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                    <Chip label={`Games: ${currentSeason.games}`} />
                    <Chip label={`Points: ${currentSeason.points}`} color="success" />
                    {currentSeason.perGame != null && (
                      <Chip label={`Pts/G: ${currentSeason.perGame}`} color="info" />
                    )}
                  </Box>
                  <TableContainer component={Paper}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ bgcolor: 'primary.main' }}>
                          <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>Week</TableCell>
                          <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>
                            Stat Line
                          </TableCell>
                          <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="right">
                            Fantasy Pts
                          </TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {currentSeason.weekly.map((row) => (
                          <TableRow key={row.week}>
                            <TableCell>{row.week}</TableCell>
                            <TableCell>{statLine(row.stats)}</TableCell>
                            <TableCell align="right">{row.fantasy_points}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )
            ) : previousSeasons.length === 0 ? (
              <Typography sx={{ color: 'text.secondary' }}>
                No previous-season data available for this player.
              </Typography>
            ) : (
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'primary.main' }}>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>Season</TableCell>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>G</TableCell>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>Stat Line</TableCell>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="right">
                        FPTS
                      </TableCell>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="right">
                        FPTS/G
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previousSeasons.map((row) => (
                      <TableRow key={row.season}>
                        <TableCell>{row.season}</TableCell>
                        <TableCell>{row.games}</TableCell>
                        <TableCell>{statLine(row.stats)}</TableCell>
                        <TableCell align="right">{row.points}</TableCell>
                        <TableCell align="right">{row.perGame}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <Box sx={{ mt: 2, textAlign: 'right' }}>
              <Link component={RouterLink} to={`/players/${playerId}`} onClick={onClose}>
                Full profile →
              </Link>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PlayerQuickView;
