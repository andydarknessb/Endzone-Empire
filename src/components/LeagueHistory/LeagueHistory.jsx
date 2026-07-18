import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Typography,
  Alert,
  Box,
  Skeleton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
} from '@mui/material';
import { TROPHY_EMOJI } from '../TrophyCase/TrophyCase';
import { GRADE_COLORS } from '../DraftGradesCard/DraftGradesCard';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';

function SeasonPanel({ season, defaultExpanded }) {
  const standings = Array.isArray(season.standings) ? season.standings : [];
  const trophies = Array.isArray(season.trophies) ? season.trophies : [];
  const draftGrades = Array.isArray(season.draftGrades) ? season.draftGrades : null;

  return (
    <Accordion defaultExpanded={defaultExpanded} data-testid={`season-panel-${season.season}`}>
      <AccordionSummary expandIcon={<span role="img" aria-label="expand">▼</span>}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h6">Season {season.season}</Typography>
          {season.champion ? (
            <Chip
              color="warning"
              label={`🏆 Champion: ${season.champion.name}`}
              data-testid={`champion-${season.season}`}
            />
          ) : (
            <Chip label="No champion recorded" variant="outlined" />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Final Standings
        </Typography>
        <TableContainer component={Paper} sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rank</TableCell>
                <TableCell>Team</TableCell>
                <TableCell align="right">W-L</TableCell>
                <TableCell align="right">PF</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {standings.map((team) => (
                <TableRow key={team.teamId}>
                  <TableCell>{team.rank}</TableCell>
                  <TableCell>{team.name}</TableCell>
                  <TableCell align="right">{`${team.wins}-${team.losses}`}</TableCell>
                  <TableCell align="right">{team.pf}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {trophies.length > 0 && (
          <>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Trophies
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
              {trophies.map((trophy) => (
                <Chip
                  key={trophy.id}
                  variant="outlined"
                  label={`${TROPHY_EMOJI[trophy.type] || '🎖️'} ${trophy.label} — ${trophy.team_name}`}
                />
              ))}
            </Box>
          </>
        )}

        {draftGrades && draftGrades.length > 0 && (
          <>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Draft Grades
            </Typography>
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Rank</TableCell>
                    <TableCell>Team</TableCell>
                    <TableCell align="center">Grade</TableCell>
                    <TableCell align="right">Roster Value</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {draftGrades.map((row) => (
                    <TableRow key={row.teamId}>
                      <TableCell>{row.rank}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell align="center">
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            color: 'common.white',
                            bgcolor: GRADE_COLORS[row.grade] || 'grey.500',
                            fontWeight: 'bold',
                            fontSize: '0.85rem',
                          }}
                        >
                          {row.grade}
                        </Box>
                      </TableCell>
                      <TableCell align="right">{row.rosterValue}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function LeagueHistory() {
  const { leagueId } = useParams();
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchHistory();
  }, [leagueId]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/history`);
      setSeasons(Array.isArray(res.data?.seasons) ? res.data.seasons : []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSeasons([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={220} height={48} sx={{ mb: 3 }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={72} sx={{ mb: 2, borderRadius: 1 }} />
        ))}
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      <Typography variant="h4" sx={{ mb: 3 }}>
        League History
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!error && seasons.length === 0 && (
        <Alert severity="info" data-testid="history-empty">
          No completed seasons yet
        </Alert>
      )}

      {seasons.map((season, i) => (
        <SeasonPanel key={season.season} season={season} defaultExpanded={i === 0} />
      ))}
    </Container>
  );
}

export default LeagueHistory;
