import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
  Chip,
  Alert,
  Box,
  Button,
  Skeleton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import apiClient from '../../api/apiClient';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import PlayerAvatar from '../PlayerQuickView/PlayerAvatar';
import PositionChip from '../PlayerQuickView/PositionChip';
import { statLine } from '../PlayerQuickView/statLine';

function PlayerDetail() {
  const { playerId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiClient.get(`/api/players/${playerId}/summary`);
        setSummary(res.data);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
  }, [playerId]);

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }} data-testid="page-skeleton">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
          <Skeleton variant="circular" width={96} height={96} />
          <Box sx={{ flexGrow: 1 }}>
            <Skeleton variant="text" width={220} height={48} />
            <Skeleton variant="text" width={160} height={32} />
          </Box>
        </Box>
        <Skeleton variant="rectangular" height={80} sx={{ mb: 3, borderRadius: 1 }} />
        <Skeleton variant="text" width={160} height={36} sx={{ mb: 2 }} />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 1, borderRadius: 1 }} />
        ))}
      </Container>
    );
  }

  if (error || !summary || !summary.player) {
    return (
      <Container sx={{ py: 4 }}>
        <Alert severity="error">{error || 'Player not available'}</Alert>
      </Container>
    );
  }

  const { player, fantasy = {}, currentSeason, previousSeasons = [] } = summary;
  const hasFantasy =
    fantasy.adp != null || fantasy.projectedPoints != null || fantasy.previousSeasonTotal != null;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate(-1)}
        sx={{ mb: 2 }}
        size="small"
      >
        Back
      </Button>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <PlayerAvatar
          name={player.name}
          position={player.position}
          photoUrl={player.photo_url}
          size={96}
        />
        <Box>
          <Typography variant="h4">
            {player.name}
            {player.jersey_number != null && (
              <Typography component="span" variant="h6" sx={{ color: 'text.secondary', ml: 1 }}>
                #{player.jersey_number}
              </Typography>
            )}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
            <PositionChip position={player.position} />
            <Chip label={player.nfl_team || 'Free Agent'} />
            <InjuryBadge status={player.injury_status} detail={player.injury_detail} />
            {player.bye_week != null && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Bye: Wk {player.bye_week}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {player.news && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {player.news}
        </Alert>
      )}

      {hasFantasy && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 3 }} data-testid="fantasy-strip">
          {fantasy.adp != null && <Chip variant="outlined" label={`ADP ${fantasy.adp}`} />}
          {fantasy.projectedPoints != null && (
            <Chip color="info" label={`${fantasy.projectionSeason} proj: ${fantasy.projectedPoints} pts`} />
          )}
          {fantasy.previousSeasonTotal != null && (
            <Chip color="success" label={`${fantasy.previousSeasonYear}: ${fantasy.previousSeasonTotal} pts`} />
          )}
        </Box>
      )}

      <Typography variant="h6" sx={{ mb: 2 }}>
        {currentSeason ? `${currentSeason.season} Season (In Progress)` : 'Current Season'}
      </Typography>
      {!currentSeason || currentSeason.weekly.length === 0 ? (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography sx={{ color: 'text.secondary' }}>No current-season stats yet</Typography>
        </Paper>
      ) : (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Chip label={`Games: ${currentSeason.games}`} />
            <Chip label={`Fantasy Points: ${currentSeason.points}`} color="success" />
            {currentSeason.perGame != null && (
              <Chip label={`Pts/G: ${currentSeason.perGame}`} color="info" />
            )}
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: 'primary.main' }}>
                  <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>Week</TableCell>
                  <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>Stat Line</TableCell>
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
        </Paper>
      )}

      <Typography variant="h6" sx={{ mb: 2 }}>
        Previous Seasons
      </Typography>
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
            {previousSeasons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>
                  No previous-season data available for this player.
                </TableCell>
              </TableRow>
            ) : (
              previousSeasons.map((row) => (
                <TableRow key={row.season}>
                  <TableCell>{row.season}</TableCell>
                  <TableCell>{row.games}</TableCell>
                  <TableCell>{statLine(row.stats)}</TableCell>
                  <TableCell align="right">{row.points}</TableCell>
                  <TableCell align="right">{row.perGame}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Container>
  );
}

export default PlayerDetail;
