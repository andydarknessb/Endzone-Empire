import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { Link as RouterLink } from 'react-router-dom';
import {
  Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, InputLabel, Alert, Switch, FormControlLabel,
  FormControl, Container, Box, Card, CardActionArea, CardContent, Chip,
  Skeleton, Stack, List, ListItem, ListItemText, Link,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { alpha } from '@mui/material/styles';
import SportsFootballIcon from '@mui/icons-material/SportsFootball';
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

  // Below-the-fold dashboard widgets — each fetches independently so a slow
  // or failed one never blocks the leagues list (or each other).
  const [newsItems, setNewsItems] = useState([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [newsError, setNewsError] = useState(false);

  const [activityItems, setActivityItems] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [activityError, setActivityError] = useState(false);

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

  const fetchNews = async () => {
    try {
      setLoadingNews(true);
      const response = await apiClient.get('/api/news');
      setNewsItems(response.data);
      setNewsError(false);
    } catch (err) {
      setNewsError(true);
    } finally {
      setLoadingNews(false);
    }
  };

  const fetchActivity = async () => {
    try {
      setLoadingActivity(true);
      const response = await apiClient.get('/api/notifications');
      setActivityItems((response.data.notifications || []).slice(0, 5));
      setActivityError(false);
    } catch (err) {
      setActivityError(true);
    } finally {
      setLoadingActivity(false);
    }
  };

  useEffect(() => {
    fetchMyLeagues();
    fetchNews();
    fetchActivity();
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

  return (
    // flexGrow cooperates with the flex column shell App.jsx sets up around
    // <Nav />/<Routes />/<Footer /> so short pages still pin the footer to the
    // bottom of the viewport, while tall pages scroll normally.
    <Box sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
      <Container maxWidth="lg" sx={{ py: 3 }}>
        {/* Unified hero: greeting + primary actions on the left, banner image
            contained on the right. Replaces the old disconnected banner +
            button row. */}
        <Card
          data-testid="dashboard-hero"
          elevation={0}
          sx={{
            mb: 4,
            p: { xs: 3, sm: 4 },
            borderRadius: 3,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Grid container spacing={4} alignItems="center">
            <Grid xs={12} md={7}>
              <Typography
                variant="overline"
                sx={{ color: 'primary.main', fontWeight: 700, letterSpacing: 1.2 }}
              >
                Endzone Empire
              </Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, mt: 0.5, mb: 1, lineHeight: 1.15 }}>
                Welcome, {user.username}!
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 460 }}>
                Your command center for every league you manage — drafts, matchups,
                waivers, and trades, all in one place.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button variant="contained" size="large" onClick={handleOpenCreateDialog}>
                  Create League
                </Button>
                <Button variant="outlined" size="large" onClick={handleOpenJoinDialog}>
                  Join League
                </Button>
              </Stack>
            </Grid>

            <Grid xs={12} md={5} sx={{ display: { xs: 'none', sm: 'block' } }}>
              <Box
                role="presentation"
                sx={{
                  position: 'relative',
                  height: { sm: 160, md: 200 },
                  borderRadius: 2,
                  overflow: 'hidden',
                  backgroundImage: 'url(/endzone.jpeg)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {/* Gradient scrim keeps this readable as a hero image even
                    though no text sits on top of it in this layout — kept
                    subtle so the photo still reads clearly. */}
                <Box
                  sx={(theme) => ({
                    position: 'absolute',
                    inset: 0,
                    background: `linear-gradient(135deg, ${alpha(theme.palette.common.black, 0.05)}, ${alpha(theme.palette.common.black, 0.45)})`,
                  })}
                />
              </Box>
            </Grid>
          </Grid>
        </Card>

        {error && <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>{error}</Alert>}
        {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ mb: 2 }}>{notice}</Alert>}

        <Typography variant="h5" sx={{ mb: 2, fontWeight: 700 }}>
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
          <Card
            data-testid="leagues-empty-state"
            variant="outlined"
            sx={{ py: 6, px: 3, bgcolor: 'background.paper' }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <SportsFootballIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" gutterBottom>
                You aren&apos;t managing any teams yet.
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 3, maxWidth: 380 }}>
                Start a brand-new league with your friends, or jump into one
                you&apos;ve already been invited to.
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <Button variant="contained" size="large" onClick={handleOpenCreateDialog}>
                  Create League
                </Button>
                <Button variant="outlined" size="large" onClick={handleOpenJoinDialog}>
                  Join League
                </Button>
              </Stack>
            </Box>
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

        {/* Below-the-fold dashboard real estate: real cross-app widgets. */}
        <Box sx={{ mt: 5 }}>
          <Grid container spacing={2}>
            <Grid xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', bgcolor: 'background.paper' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                    Latest NFL News
                  </Typography>
                  {loadingNews ? (
                    <Stack spacing={1}>
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} variant="text" width={`${85 - i * 10}%`} />
                      ))}
                    </Stack>
                  ) : newsError ? (
                    <Typography variant="body2" color="text.secondary">
                      Couldn&apos;t load the latest news right now.
                    </Typography>
                  ) : newsItems.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No news to show right now.
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {newsItems.map((item) => (
                        <ListItem key={item.link} disableGutters>
                          <ListItemText
                            primary={
                              <Link
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                underline="hover"
                                color="text.primary"
                              >
                                {item.title}
                              </Link>
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', bgcolor: 'background.paper' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                    Global Activity
                  </Typography>
                  {loadingActivity ? (
                    <Stack spacing={1}>
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} variant="text" width={`${85 - i * 10}%`} />
                      ))}
                    </Stack>
                  ) : activityError ? (
                    <Typography variant="body2" color="text.secondary">
                      Couldn&apos;t load recent activity right now.
                    </Typography>
                  ) : activityItems.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No recent activity across your leagues yet.
                    </Typography>
                  ) : (
                    <List dense disablePadding>
                      {activityItems.map((item) => (
                        <ListItem key={item.id} disableGutters>
                          <ListItemText
                            primary={item.message}
                            secondary={
                              item.league_name
                                ? `${item.league_name} · ${new Date(item.created_at).toLocaleDateString()}`
                                : new Date(item.created_at).toLocaleDateString()
                            }
                          />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Box>

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
      </Container>
    </Box>
  );
}

export default UserPage;
