import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Link as RouterLink } from 'react-router-dom';
import {
  Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, InputLabel, Alert, Switch, FormControlLabel,
  FormControl, Tooltip, Container, Box, Card, CardActionArea, CardContent, Chip,
  Skeleton,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import apiClient from '../../api/apiClient';
import Countdown from '../Countdown/Countdown';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

// Draft status -> readable chip on each league card.
const STATUS_LABEL = { pending: 'Pre-draft', active: 'Draft live', complete: 'In season' };
const STATUS_COLOR = { pending: 'default', active: 'warning', complete: 'success' };

function UserPage() {
  const user = useSelector((store) => store.user);

  const [myLeagues, setMyLeagues] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const notify = useSnackbar();

  // Create League dialog
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [leagueName, setLeagueName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [numTeams, setNumTeams] = useState(2);

  // New league-creation options — all optional, sent only when the user
  // actually sets them (see handleCreateLeague).
  const [isPublic, setIsPublic] = useState(false);
  const [joinApproval, setJoinApproval] = useState(false);
  const [bestBall, setBestBall] = useState(false);
  const [scoringPreset, setScoringPreset] = useState('');
  const [draftDate, setDraftDate] = useState('');

  // Join League dialog — leagues are private, so joining is always by invite code
  const [openJoinDialog, setOpenJoinDialog] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  // Rename Team dialog — a team can't exist outside a league, so renaming
  // (not standalone creation) is the real operation here
  const [openRenameTeamDialog, setOpenRenameTeamDialog] = useState(false);
  const [renameLeagueId, setRenameLeagueId] = useState('');
  const [newTeamName, setNewTeamName] = useState('');

  const fetchMyLeagues = async () => {
    try {
      setLoadingLeagues(true);
      const response = await apiClient.get('/api/league');
      setMyLeagues(response.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoadingLeagues(false);
    }
  };

  useEffect(() => {
    fetchMyLeagues();
  }, []);

  // Functions to handle create dialog
  const handleOpenCreateDialog = () => {
    setOpenCreateDialog(true);
  };

  const handleCloseCreateDialog = () => {
    setOpenCreateDialog(false);
  };

  const handleCreateLeague = async () => {
    setError(null);
    try {
      const payload = {
        name: leagueName,
        teamName: teamName || undefined,
        maxTeams: numTeams,
      };
      if (isPublic) payload.isPublic = true;
      if (isPublic && joinApproval) payload.joinApproval = true;
      if (bestBall) payload.bestBall = true;
      if (scoringPreset) payload.scoringPreset = scoringPreset;
      if (draftDate) payload.draftDate = new Date(draftDate).toISOString();

      await apiClient.post('/api/league', payload);
      setNotice('League created!');
      notify('League created!');
      setLeagueName('');
      setTeamName('');
      setIsPublic(false);
      setJoinApproval(false);
      setBestBall(false);
      setScoringPreset('');
      setDraftDate('');
      fetchMyLeagues();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    } finally {
      handleCloseCreateDialog();
    }
  };

  // Functions to handle join dialog
  const handleOpenJoinDialog = () => {
    setOpenJoinDialog(true);
  };

  const handleCloseJoinDialog = () => {
    setOpenJoinDialog(false);
  };

  const handleJoinLeague = async () => {
    setError(null);
    try {
      await apiClient.post('/api/league/join', { inviteCode: inviteCode.trim() });
      setNotice('Joined league!');
      notify('Joined league!');
      setInviteCode('');
      fetchMyLeagues();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    } finally {
      handleCloseJoinDialog();
    }
  };

  // Functions to handle rename team dialog
  const handleOpenRenameTeamDialog = () => {
    setOpenRenameTeamDialog(true);
  };

  const handleCloseRenameTeamDialog = () => {
    setOpenRenameTeamDialog(false);
  };

  const handleRenameTeam = async () => {
    setError(null);
    try {
      const league = myLeagues.find((l) => l.id === renameLeagueId);
      if (!league) throw new Error('Select a league first');
      await apiClient.put(`/api/team/${league.my_team_id}`, { name: newTeamName });
      setNotice('Team renamed!');
      notify('Team renamed!');
      setNewTeamName('');
      fetchMyLeagues();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    } finally {
      handleCloseRenameTeamDialog();
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      {/* Header banner — the logo is an accent, not the whole page */}
      <Box
        sx={{
          position: 'relative',
          borderRadius: 2,
          overflow: 'hidden',
          mb: 3,
          minHeight: { xs: 120, md: 160 },
          display: 'flex',
          alignItems: 'flex-end',
          backgroundImage: 'url(/endzone.jpeg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'common.black', opacity: 0.5 }} />
        <Box sx={{ position: 'relative', p: { xs: 2, md: 3 }, color: 'common.white' }}>
          <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
            Endzone Empire
          </Typography>
          <Typography variant="h6" sx={{ opacity: 0.92 }}>
            Welcome, {user.username}!
          </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>{notice}</Alert>}

      {/* Primary actions */}
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
        <Button variant="contained" color="primary" onClick={handleOpenCreateDialog}>
          Create League
        </Button>
        <Button variant="outlined" color="primary" onClick={handleOpenJoinDialog}>
          Join League
        </Button>
        <Tooltip title={myLeagues.length === 0 ? 'Join a league first' : ''}>
          <span>
            <Button
              variant="outlined"
              color="primary"
              onClick={handleOpenRenameTeamDialog}
              disabled={myLeagues.length === 0}
            >
              Rename Team
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Typography variant="h5" sx={{ mb: 2 }}>
        My Leagues
      </Typography>

      {loadingLeagues ? (
        <Grid container spacing={2}>
          {[0, 1, 2].map((i) => (
            <Grid xs={12} sm={6} md={4} key={i}>
              <Card variant="outlined" sx={{ height: '100%' }} data-testid="league-skeleton">
                <CardContent>
                  <Skeleton variant="text" width="60%" height={32} />
                  <Skeleton variant="text" width="45%" />
                  <Skeleton variant="text" width="30%" />
                  <Skeleton variant="rounded" width={80} height={24} sx={{ mt: 1 }} />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : myLeagues.length === 0 ? (
        <Card variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            You&apos;re not in a league yet
          </Typography>
          <Typography color="text.secondary">
            Use <strong>Create League</strong> or <strong>Join League</strong> above to get started.
          </Typography>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {myLeagues.map((league) => (
            <Grid xs={12} sm={6} md={4} key={league.id}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardActionArea
                  component={RouterLink}
                  to={`/league/${league.id}`}
                  sx={{ height: '100%' }}
                >
                  <CardContent>
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 1,
                        mb: 1,
                      }}
                    >
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {league.name}
                      </Typography>
                      <Chip
                        size="small"
                        label={STATUS_LABEL[league.draft_status] || league.draft_status}
                        color={STATUS_COLOR[league.draft_status] || 'default'}
                      />
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                      Team: {league.my_team_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                      {league.team_count != null ? league.team_count : '—'}
                      {league.max_teams ? `/${league.max_teams}` : ''} teams
                    </Typography>
                    {league.draft_status === 'pending' && league.draft_date && (
                      <Countdown variant="chip" date={league.draft_date} />
                    )}
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
      <Dialog open={openCreateDialog} onClose={handleCloseCreateDialog} className="dialogContainer">
        <DialogTitle className="dialogTitle">Create a New League</DialogTitle>
        <DialogContent>
          <TextField className="dialogTextField" autoFocus margin="dense" label="League Name" fullWidth value={leagueName} onChange={(event) => setLeagueName(event.target.value)} />
          <TextField className="dialogTextField" margin="dense" label="Team Name" fullWidth value={teamName} onChange={(event) => setTeamName(event.target.value)} />
          <InputLabel id="numTeams-label"></InputLabel>
          <div style={{display: 'flex', alignItems: 'center', marginTop: '1em'}}>
          <Typography variant="body1" style={{marginRight: '1em', color: 'var(--text-primary)', fontWeight: 'bold', fontSize: '1.2em'}}>Teams:</Typography>
        <Select
            labelId="numTeams-label"
            value={numTeams}
            onChange={(event) => setNumTeams(event.target.value)}
            style={{minWidth: 120}}
        >
            {Array.from({length: 19}, (_, i) => i+2).map((number) => (
            <MenuItem key={number} value={number}>{number}</MenuItem>
            ))}
        </Select>
      </div>

          <FormControlLabel
            control={
              <Switch
                checked={isPublic}
                onChange={(event) => setIsPublic(event.target.checked)}
              />
            }
            label="Public league"
          />
          {isPublic && (
            <FormControlLabel
              sx={{ ml: 2 }}
              control={
                <Switch
                  checked={joinApproval}
                  onChange={(event) => setJoinApproval(event.target.checked)}
                />
              }
              label="Require commissioner approval to join"
            />
          )}
          <FormControlLabel
            control={
              <Switch
                checked={bestBall}
                onChange={(event) => setBestBall(event.target.checked)}
              />
            }
            label="Best ball mode"
          />
          {bestBall && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Best ball: an optimal lineup is set automatically each week — no manual lineup edits.
            </Typography>
          )}

          <FormControl fullWidth margin="dense" size="small">
            <InputLabel id="scoring-preset-label">Scoring</InputLabel>
            <Select
              labelId="scoring-preset-label"
              id="scoring-preset-select"
              label="Scoring"
              value={scoringPreset}
              onChange={(event) => setScoringPreset(event.target.value)}
            >
              {/* No preset sent = the built-in default rules, which are half-PPR */}
              <MenuItem value="">League default (Half PPR)</MenuItem>
              <MenuItem value="standard">Standard</MenuItem>
              <MenuItem value="half_ppr">Half PPR</MenuItem>
              <MenuItem value="ppr">PPR</MenuItem>
            </Select>
          </FormControl>

          <TextField
            className="dialogTextField"
            margin="dense"
            label="Draft date"
            type="datetime-local"
            fullWidth
            InputLabelProps={{ shrink: true }}
            sx={(theme) => ({ colorScheme: theme.palette.mode })}
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
          />
          </DialogContent>
          <DialogActions>
          <Button onClick={handleCloseCreateDialog} color="primary">
           Cancel
          </Button>
          <Button onClick={handleCreateLeague} color="primary" disabled={!leagueName.trim()}>
           Create
          </Button>
          </DialogActions>
          </Dialog>
      <Dialog open={openJoinDialog} onClose={handleCloseJoinDialog} className="dialogContainer">
        <DialogTitle className="dialogTitle">Join an Existing League</DialogTitle>
        <DialogContent>
          <TextField
            className="dialogTextField"
            autoFocus
            margin="dense"
            label="Invite Code"
            fullWidth
            value={inviteCode}
            onChange={(event) => setInviteCode(event.target.value)}
          />
        </DialogContent>
                <DialogActions>
                  <Button onClick={handleCloseJoinDialog} color="primary">
                    Cancel
                  </Button>
                  <Button onClick={handleJoinLeague} color="primary" disabled={!inviteCode.trim()}>
                    Join
                  </Button>
                </DialogActions>
              </Dialog>
      <Dialog open={openRenameTeamDialog} onClose={handleCloseRenameTeamDialog} className="dialogContainer">
      <DialogTitle className="dialogTitle">Rename Team</DialogTitle>
      <DialogContent>
      <InputLabel id="rename-league-label">League</InputLabel>
      <Select
        labelId="rename-league-label"
        fullWidth
        value={renameLeagueId}
        onChange={(event) => setRenameLeagueId(event.target.value)}
      >
        {myLeagues.map((league) => (
          <MenuItem key={league.id} value={league.id}>
            {league.name} ({league.my_team_name})
          </MenuItem>
        ))}
      </Select>
      <TextField className="dialogTextField" margin="dense" label="New Team Name" fullWidth value={newTeamName} onChange={(event) => setNewTeamName(event.target.value)} />
      </DialogContent>
      <DialogActions>
      <Button onClick={handleCloseRenameTeamDialog} color="primary">
      Cancel
    </Button>
    <Button onClick={handleRenameTeam} color="primary" disabled={!renameLeagueId || !newTeamName.trim()}>
                  Rename
                </Button>
              </DialogActions>
            </Dialog>
    </Container>
  );
}

export default UserPage;
