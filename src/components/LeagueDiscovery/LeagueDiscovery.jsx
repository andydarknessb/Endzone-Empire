import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Alert,
  Box,
  Chip,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import apiClient from '../../api/apiClient';

const SCORING_LABEL = {
  standard: 'Standard',
  half_ppr: 'Half PPR',
  ppr: 'PPR',
};

function LeagueDiscovery() {
  const navigate = useNavigate();

  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [scoring, setScoring] = useState('');
  const [openSlotsOnly, setOpenSlotsOnly] = useState(false);
  const [sort, setSort] = useState('newest');

  // Tracks join-request outcomes made during this visit; falls back to the
  // server-provided myRequestStatus for leagues the user already requested
  // to join in a previous session.
  const [requestStatus, setRequestStatus] = useState({});

  const [joinTarget, setJoinTarget] = useState(null);
  const [teamName, setTeamName] = useState('');
  const [joinError, setJoinError] = useState(null);

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (scoring) params.set('scoring', scoring);
    if (openSlotsOnly) params.set('openSlots', 'true');
    if (sort) params.set('sort', sort);
    const qs = params.toString();
    return `/api/league/discover${qs ? `?${qs}` : ''}`;
  };

  const fetchLeagues = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(buildUrl());
      setLeagues(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLeagues();
  }, [scoring, openSlotsOnly, sort]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    fetchLeagues();
  };

  const handleOpenJoin = (league) => {
    setJoinError(null);
    setTeamName('');
    setJoinTarget(league);
  };

  const handleCloseJoin = () => {
    setJoinTarget(null);
  };

  const handleSubmitJoin = async () => {
    if (!joinTarget) return;
    try {
      setJoinError(null);
      const res = await apiClient.post(`/api/league/${joinTarget.id}/join-public`, {
        teamName,
      });
      if (res.status === 201) {
        setJoinTarget(null);
        navigate(`/league/${res.data.league.id}`);
        return;
      }
      // 202: queued for commissioner approval
      setRequestStatus((prev) => ({ ...prev, [joinTarget.id]: 'pending' }));
      setJoinTarget(null);
    } catch (err) {
      setJoinError(err.response?.data?.error || err.message);
    }
  };

  const statusFor = (league) => requestStatus[league.id] ?? league.myRequestStatus;

  if (loading && leagues.length === 0) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={260} height={48} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" height={80} sx={{ mb: 3, borderRadius: 1 }} />
        <Skeleton variant="rectangular" height={240} sx={{ borderRadius: 1 }} />
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        Discover Leagues
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper component="form" onSubmit={handleSearchSubmit} sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            label="Search"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="discover-scoring-label">Scoring</InputLabel>
            <Select
              labelId="discover-scoring-label"
              id="discover-scoring-select"
              label="Scoring"
              value={scoring}
              onChange={(e) => setScoring(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="standard">Standard</MenuItem>
              <MenuItem value="half_ppr">Half PPR</MenuItem>
              <MenuItem value="ppr">PPR</MenuItem>
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={openSlotsOnly}
                onChange={(e) => setOpenSlotsOnly(e.target.checked)}
              />
            }
            label="Open slots only"
          />

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="discover-sort-label">Sort by</InputLabel>
            <Select
              labelId="discover-sort-label"
              id="discover-sort-select"
              label="Sort by"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <MenuItem value="newest">Newest</MenuItem>
              <MenuItem value="draft_date">Draft date</MenuItem>
              <MenuItem value="open_slots">Open slots</MenuItem>
            </Select>
          </FormControl>

          <Button type="submit" variant="contained">
            Search
          </Button>
        </Box>
      </Paper>

      {leagues.length === 0 ? (
        <Typography color="text.secondary">
          No leagues match your filters — try widening your search.
        </Typography>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Teams</TableCell>
                <TableCell>Scoring</TableCell>
                <TableCell>Draft date</TableCell>
                <TableCell align="right">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {leagues.map((league) => {
                const status = statusFor(league);
                return (
                  <TableRow key={league.id}>
                    <TableCell>
                      <Typography variant="body1">{league.name}</Typography>
                    </TableCell>
                    <TableCell>
                      {league.teamCount}/{league.maxTeams}
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={SCORING_LABEL[league.scoringPreset] || league.scoringPreset || 'Standard'}
                        />
                        {league.bestBall && <Chip size="small" label="Best Ball" color="secondary" />}
                      </Box>
                    </TableCell>
                    <TableCell>
                      {league.draftDate ? new Date(league.draftDate).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell align="right">
                      {league.alreadyMember ? (
                        <Button component={Link} to={`/league/${league.id}`}>
                          View
                        </Button>
                      ) : status === 'pending' ? (
                        <Button disabled>Request pending</Button>
                      ) : (
                        <Button variant="outlined" onClick={() => handleOpenJoin(league)}>
                          {league.joinApproval ? 'Request to join' : 'Join'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={!!joinTarget} onClose={handleCloseJoin}>
        <DialogTitle>Join {joinTarget?.name}</DialogTitle>
        <DialogContent>
          {joinError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {joinError}
            </Alert>
          )}
          <TextField
            autoFocus
            margin="dense"
            label="Team name"
            fullWidth
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseJoin}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmitJoin} disabled={!teamName.trim()}>
            {joinTarget?.joinApproval ? 'Request to join' : 'Join'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default LeagueDiscovery;
