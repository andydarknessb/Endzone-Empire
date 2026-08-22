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
  Skeleton,
  Card,
  CardContent,
  CardActions,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import apiClient from '../../api/apiClient';
import { isPickemOnly, LEAGUE_TYPE } from '../../lib/leagueType';
import LeagueTypeChips from '../common/LeagueTypeChips';

function LeagueDiscovery() {
  const navigate = useNavigate();

  const [leagues, setLeagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [scoring, setScoring] = useState('');
  const [openSlotsOnly, setOpenSlotsOnly] = useState(false);
  const [sort, setSort] = useState('newest');
  // Type filter over the stored flag: '' (all), LEAGUE_TYPE.FANTASY (has a
  // fantasy side, which includes a fantasy league that also plays pick'em) or
  // LEAGUE_TYPE.PICKEM (pick'em-only pools). A pool has no scoring preset and
  // no draft, so choosing it retires the Scoring filter and the Draft date
  // sort (they could never match / order it).
  const [typeFilter, setTypeFilter] = useState('');
  const pickemOnlyFilter = typeFilter === LEAGUE_TYPE.PICKEM;
  const handleTypeFilterChange = (next) => {
    setTypeFilter(next);
    if (next === LEAGUE_TYPE.PICKEM) {
      if (scoring) setScoring('');
      if (sort === 'draft_date') setSort('newest');
    }
  };

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
    if (typeFilter) params.set('type', typeFilter);
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
    // Search is submit-driven; the remaining filters refresh immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoring, typeFilter, openSlotsOnly, sort]);

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

  // "Filters active" drives the empty state: only blame the filters when the
  // user has actually narrowed the search. Sort is ordering, not a filter.
  const hasActiveFilters = search.trim() !== '' || scoring !== '' || typeFilter !== '' || openSlotsOnly;

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

      <Paper component="form" onSubmit={handleSearchSubmit} variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-start' }}>
          <TextField
            label="Search"
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel id="discover-type-label">League type</InputLabel>
            <Select
              labelId="discover-type-label"
              id="discover-type-select"
              label="League type"
              value={typeFilter}
              onChange={(e) => handleTypeFilterChange(e.target.value)}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value={LEAGUE_TYPE.FANTASY}>Fantasy football</MenuItem>
              <MenuItem value={LEAGUE_TYPE.PICKEM}>Pick&apos;em only</MenuItem>
            </Select>
          </FormControl>

          {!pickemOnlyFilter && (
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
          )}

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
              {!pickemOnlyFilter && <MenuItem value="draft_date">Draft date</MenuItem>}
              <MenuItem value="open_slots">Open slots</MenuItem>
            </Select>
          </FormControl>

          <Button type="submit" variant="contained">
            Search
          </Button>
        </Box>
      </Paper>

      {!loading && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} aria-live="polite">
          {leagues.length} public league{leagues.length === 1 ? '' : 's'} found
        </Typography>
      )}

      {leagues.length === 0 ? (
        hasActiveFilters ? (
          <Typography color="text.secondary">
            No leagues match your filters. Try widening your search.
          </Typography>
        ) : (
          <Box sx={{ textAlign: 'center', py: 5 }}>
            <Typography color="text.secondary" gutterBottom>
              No public leagues yet. Be the first to start one.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="center" spacing={1.5} sx={{ mt: 2 }}>
              <Button component={Link} to="/league" variant="contained">Create a League</Button>
              <Button component={Link} to="/league" variant="outlined">Invite friends</Button>
            </Stack>
          </Box>
        )
      ) : (
        <Grid container spacing={2}>
          {leagues.map((league) => {
            const status = statusFor(league);
            const slotsOpen = Math.max(0, league.maxTeams - league.teamCount);
            return (
              <Grid xs={12} sm={6} md={4} key={league.id}>
                <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>{league.name}</Typography>
                    {/* The type chips are shared with the invite-code preview
                        (common/LeagueTypeChips) so a joiner reads the same
                        thing on either path. */}
                    <LeagueTypeChips league={league} sx={{ mb: 2 }} />
                    <Typography variant="body2" color="text.secondary">
                      {league.teamCount}/{league.maxTeams} teams · {slotsOpen} slot{slotsOpen === 1 ? '' : 's'} open
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {isPickemOnly(league)
                        ? 'Pick winners every week · no draft'
                        : league.draftDate
                          ? `Draft: ${new Date(league.draftDate).toLocaleString()}`
                          : 'Draft date not set'}
                    </Typography>
                  </CardContent>
                  <CardActions sx={{ px: 2, pb: 2 }}>
                    {league.alreadyMember ? (
                      <Button component={Link} to={`/league/${league.id}`}>View</Button>
                    ) : status === 'pending' ? (
                      <Button disabled>Request pending</Button>
                    ) : (
                      <Button variant="outlined" onClick={() => handleOpenJoin(league)}>
                        {league.joinApproval ? 'Request to join' : 'Join'}
                      </Button>
                    )}
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
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
            helperText={isPickemOnly(joinTarget) ? "Your name in the pick'em standings." : undefined}
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
