import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Grid,
  Chip,
  Alert,
  CircularProgress,
  Box,
  List,
  ListItem,
} from '@mui/material';
import apiClient from '../../api/apiClient';
import { createDraftSocket } from '../../api/socket';
import InjuryBadge from '../InjuryBadge/InjuryBadge';

function TeamColumn({ team, teamName, score }) {
  const starters = team?.starters || [];
  return (
    <Grid item xs={12} md={6}>
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6">{teamName}</Typography>
        <Typography variant="h5" sx={{ mb: 2 }}>
          {score}
        </Typography>
        <List disablePadding>
          {starters.map((player) => (
            <ListItem key={player.id} sx={{ px: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
                <Chip label={player.slot} size="small" sx={{ minWidth: 56 }} />
                <Box sx={{ flexGrow: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body1">{player.name}</Typography>
                    <InjuryBadge status={player.injury_status} />
                  </Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {player.position} — {player.nfl_team}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ textAlign: 'right' }}>
                  {player.points}
                </Typography>
              </Box>
            </ListItem>
          ))}
        </List>
      </Paper>
    </Grid>
  );
}

function MatchupDetail() {
  const { leagueId, matchupId } = useParams();
  const [matchup, setMatchup] = useState(null);
  const [home, setHome] = useState(null);
  const [away, setAway] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    fetchData();
  }, [leagueId, matchupId]);

  useEffect(() => {
    const newSocket = createDraftSocket();
    socketRef.current = newSocket;

    newSocket.emit('league:join', { leagueId: Number(leagueId) });

    newSocket.on('scores:updated', (data) => {
      const scored = data.scored.find((s) => s.matchupId === Number(matchupId));
      if (!scored) return;

      setMatchup((prev) =>
        prev ? { ...prev, home_score: scored.homeScore, away_score: scored.awayScore } : prev
      );
    });

    return () => {
      socketRef.current.disconnect();
      socketRef.current = null;
    };
  }, [leagueId, matchupId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/matchups/${matchupId}`);
      setMatchup(res.data.matchup);
      setHome(res.data.home);
      setAway(res.data.away);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {matchup && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
            <Typography variant="h4">Week {matchup.week} Matchup</Typography>
            {matchup.is_playoff && <Chip label="Playoff" />}
            {matchup.final && <Chip label="Final" color="success" />}
          </Box>

          <Grid container spacing={2}>
            <TeamColumn
              team={home}
              teamName={matchup.home_team_name}
              score={Number(matchup.home_score)}
            />
            <TeamColumn
              team={away}
              teamName={matchup.away_team_name}
              score={Number(matchup.away_score)}
            />
          </Grid>
        </>
      )}
    </Container>
  );
}

export default MatchupDetail;
