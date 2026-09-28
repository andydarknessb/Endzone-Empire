import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useSelector } from 'react-redux';
import { Link as RouterLink } from 'react-router-dom';
import {
  Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Select, MenuItem, InputLabel, Alert, Switch, FormControlLabel,
  FormControl, Container, Box, Card, CardContent, Paper,
  Skeleton, Stack, List, ListItem, ListItemText, Link,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { alpha } from '@mui/material/styles';
import SportsFootballIcon from '@mui/icons-material/SportsFootball';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import Countdown from '../Countdown/Countdown';
import LeagueStatusGrid from './LeagueStatusGrid';
import LeagueTypeFields from '../common/LeagueTypeFields';
import DraftScheduleField from '../common/DraftScheduleField';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import { browserTimeZone, zonedWallTimeToUtcIso } from '../../lib/draftTimezone';
import {
  LEAGUE_TYPE, MIN_TEAMS, capForType, clampTeamCount, includesFantasy, isPickemOnly, isPickemOnlyType, isValidTeamCount,
  leagueTypePayload,
} from '../../shared/lib/leagueType';

// Lazy: PublicHighlights imports the strategy-article registry (full JSX
// bodies), which must not ride in the initial main bundle. See the note in
// PublicHighlights.jsx.
const PublicHighlights = lazy(() => import('./PublicHighlights'));

function nextUpFor(leagues, activityItems) {
  const actionItem = activityItems.find((item) => /trade|invite|join request/i.test(item.message || ''));
  if (actionItem) {
    const trade = /trade/i.test(actionItem.message || '');
    return {
      eyebrow: 'Action needed',
      title: actionItem.message,
      action: trade ? 'Review trades' : 'Review league',
      to: actionItem.league_id
        ? `/league/${actionItem.league_id}${trade ? '/trades' : ''}`
        : '/league',
    };
  }

  const drafting = leagues.find((league) => deriveLeaguePhase(league) === LEAGUE_PHASE.DRAFTING);
  if (drafting) {
    return { eyebrow: 'Draft live', title: `${drafting.name} is on the clock.`, action: 'Open Draft Room', to: `/league/${drafting.id}/draft` };
  }

  const scheduled = leagues.find((league) => deriveLeaguePhase(league) === LEAGUE_PHASE.PRE_DRAFT && league.draft_date);
  if (scheduled) {
    return {
      eyebrow: 'Next up',
      title: `Draft day for ${scheduled.name}`,
      action: 'Draft Room',
      to: `/league/${scheduled.id}/draft`,
      draftDate: scheduled.draft_date,
      draftTimeZone: scheduled.draft_timezone,
    };
  }

  // A pick'em-only league is in season from day one and has no lineup to set:
  // its next step is always this week's picks.
  const picking = leagues.find((league) => isPickemOnly(league) && deriveLeaguePhase(league) === LEAGUE_PHASE.IN_SEASON);
  if (picking) {
    const week = picking.current_week ? `week ${picking.current_week} ` : '';
    return { eyebrow: 'Action needed', title: `Make your ${week}picks for ${picking.name}.`, action: 'Make picks', to: `/league/${picking.id}/pickem` };
  }

  const active = leagues.find((league) => [LEAGUE_PHASE.IN_SEASON, LEAGUE_PHASE.PLAYOFFS].includes(deriveLeaguePhase(league)));
  if (active) {
    const week = active.current_week ? `Week ${active.current_week} ` : '';
    return { eyebrow: 'Action needed', title: `Review your ${week}lineup for ${active.name}.`, action: 'Set Lineup', to: `/league/${active.id}/lineup` };
  }

  return { eyebrow: 'Next up', title: 'Create or join a league to start your season.', action: 'View leagues', to: '/league' };
}

function UserPage() {
  const user = useSelector((store) => store.user);

  const [myLeagues, setMyLeagues] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  // A failed leagues fetch is its own state, not the dialogs' `error`: it must
  // never fall through to the empty state (which tells a manager they have no
  // leagues) and opening Create or Join must not clear it.
  const [leaguesError, setLeaguesError] = useState(null);
  // Each dialog owns its failure message: it renders inside the dialog, which
  // stays open with the answers, and is the only place the error is announced.
  const [createError, setCreateError] = useState(null);
  const [joinError, setJoinError] = useState(null);
  // In-flight flags: POST /api/league is not idempotent, so a second click
  // while the first request is pending would create a second league.
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const notify = useSnackbar();

  // Create League dialog
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  const [leagueName, setLeagueName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [numTeams, setNumTeams] = useState(2);

  // League type is always sent; the pick'em mode only when the type includes
  // pick'em (see leagueTypePayload).
  const [leagueType, setLeagueType] = useState(LEAGUE_TYPE.FANTASY);
  const [pickemMode, setPickemMode] = useState('straight');

  // New league-creation options — all optional, sent only when the user
  // actually sets them (see handleCreateLeague).
  const [isPublic, setIsPublic] = useState(false);
  const [joinApproval, setJoinApproval] = useState(false);
  const [bestBall, setBestBall] = useState(false);
  // Half PPR is stored as the half_ppr preset rather than left NULL: the two
  // score identically, but only a stored preset shows the league's scoring
  // chip and matches Discover's scoring filter.
  const [scoringPreset, setScoringPreset] = useState('half_ppr');
  const [draftDate, setDraftDate] = useState('');
  const [draftTimezone, setDraftTimezone] = useState(browserTimeZone);
  const [draftAcknowledged, setDraftAcknowledged] = useState(false);

  // Join League dialog — leagues are private, so joining is always by invite code
  const [openJoinDialog, setOpenJoinDialog] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [joinTeamName, setJoinTeamName] = useState('');

  // Below-the-fold dashboard widgets — each fetches independently so a slow
  // or failed one never blocks the leagues list (or each other).
  const [newsItems, setNewsItems] = useState([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [newsError, setNewsError] = useState(false);

  const [activityItems, setActivityItems] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [activityError, setActivityError] = useState(false);
  const nextUp = nextUpFor(myLeagues, activityItems);
  // Skeletons only stand in for a list we don't have yet. A refetch (Try
  // again, or the refresh after a create or join) keeps the good list up.
  const awaitingFirstLeagues = loadingLeagues && myLeagues.length === 0;

  const fetchMyLeagues = async () => {
    try {
      setLoadingLeagues(true);
      const response = await apiClient.get('/api/league', { params: { include: 'status' } });
      setMyLeagues(response.data);
      setLeaguesError(null);
    } catch (err) {
      // Keep the last good list (if any) on screen under the alert.
      setLeaguesError(readHttpFailure(err).message || err.message);
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
    setCreateError(null);
  };

  // Switching type re-caps the team count: a 30-manager pick'em pool cannot
  // become a 30-team fantasy league.
  const handleLeagueTypeChange = (nextType) => {
    setLeagueType(nextType);
    setNumTeams((current) => clampTeamCount(current, capForType(nextType)));
  };

  // The fantasy Select can only hold 2..20, but the pick'em number field is
  // free text and this dialog is not a <form>, so native min/max never run:
  // gate Create on the count instead of letting the server 400 it.
  const teamCountValid = isValidTeamCount(numTeams, capForType(leagueType));
  // A Team name is required on every join path (#111); this dialog's own
  // gate mirrors the server's trimmed-non-blank rule so Create never fires
  // a request the server would only reject.
  const teamNameValid = teamName.trim().length > 0;
  // A scheduled draft needs its zone explicitly acknowledged before Create
  // can fire (#116 AC3); an empty draft date needs no acknowledgement, and
  // neither does a pick'em league, which never sends draftDate at all (a
  // date typed before switching away from fantasy is simply dropped).
  const draftScheduleReady = !includesFantasy(leagueType) || !draftDate || draftAcknowledged;
  // A disabled button alone doesn't say why (WCAG 3.3.2), so the first unmet
  // gate is spelled out beside it and tied to it with aria-describedby.
  let createBlocker = null;
  if (!leagueName.trim() || !teamNameValid) createBlocker = 'Add a league name and your Team name to continue.';
  else if (!teamCountValid) createBlocker = `Enter ${MIN_TEAMS} to ${capForType(leagueType)} teams to continue.`;
  else if (!draftScheduleReady) createBlocker = 'Confirm the draft date and time zone to continue.';
  const joinBlocker = !inviteCode.trim() || !joinTeamName.trim()
    ? 'Add the invite code and your Team name to continue.'
    : null;

  const handleCreateLeague = async () => {
    if (creating) return;
    setCreateError(null);
    setCreating(true);
    try {
      // maxTeams is always explicit: the server's default is the fantasy 10
      // for every type, so a pick'em pool must never rely on it.
      const draftDateUtc = draftDate ? zonedWallTimeToUtcIso(draftDate, draftTimezone) : null;
      const payload = {
        name: leagueName,
        teamName: teamName.trim(),
        maxTeams: Number(numTeams),
        ...leagueTypePayload({ leagueType, pickemMode, bestBall, scoringPreset, draftDate: draftDateUtc, draftTimezone }),
      };
      if (isPublic) payload.isPublic = true;
      if (isPublic && joinApproval) payload.joinApproval = true;

      await apiClient.post('/api/league', payload);
      // The snackbar is the one success announcement; the page adds none.
      notify('League created!');
      setLeagueName('');
      setTeamName('');
      setNumTeams(2);
      setLeagueType(LEAGUE_TYPE.FANTASY);
      setPickemMode('straight');
      setIsPublic(false);
      setJoinApproval(false);
      setBestBall(false);
      setScoringPreset('half_ppr');
      setDraftDate('');
      setDraftTimezone(browserTimeZone());
      setDraftAcknowledged(false);
      handleCloseCreateDialog();
      fetchMyLeagues();
    } catch (err) {
      setCreateError(readHttpFailure(err).message || err.message);
    } finally {
      setCreating(false);
    }
  };

  // Functions to handle join dialog
  const handleOpenJoinDialog = () => {
    setOpenJoinDialog(true);
  };

  const handleCloseJoinDialog = () => {
    setOpenJoinDialog(false);
    setJoinError(null);
  };

  const handleJoinLeague = async () => {
    if (joining) return;
    setJoinError(null);
    setJoining(true);
    try {
      await apiClient.post('/api/league/join', { inviteCode: inviteCode.trim(), teamName: joinTeamName.trim() });
      notify('Joined league!');
      setInviteCode('');
      setJoinTeamName('');
      handleCloseJoinDialog();
      fetchMyLeagues();
    } catch (err) {
      setJoinError(readHttpFailure(err).message || err.message);
    } finally {
      setJoining(false);
    }
  };

  return (
    // flexGrow cooperates with the flex column shell App.jsx sets up around
    // <Nav />/<Routes />/<Footer /> so short pages still pin the footer to the
    // bottom of the viewport, while tall pages scroll normally.
    // The page's one main landmark, named by its h1; the shell's skip link
    // (App.jsx SKIP_LINK_TARGETS) focuses it by id, hence tabIndex -1.
    <Box
      component="main"
      id="user-main-content"
      tabIndex={-1}
      aria-labelledby="user-page-heading"
      sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}
    >
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
              <Typography variant="h4" component="h1" id="user-page-heading" sx={{ fontWeight: 700, mt: 0.5, mb: 1, lineHeight: 1.15 }}>
                Welcome, {user.username}!
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 460 }}>
                Your command center for every league you manage: drafts, matchups,
                waivers, trades, and weekly picks, all in one place.
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
                  // Fixed, not keyed to myLeagues: that list is empty while loading,
                  // so a keyed height shifted the page once leagues arrived.
                  height: { sm: 140, md: 160 },
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


        <Typography variant="h5" component="h2" sx={{ mb: 2, fontWeight: 700 }}>
          My Leagues
        </Typography>

        {leaguesError && !loadingLeagues && (
          <Alert
            severity="error"
            sx={{ mb: 2 }}
            action={<Button color="inherit" size="small" onClick={fetchMyLeagues}>Try again</Button>}
          >
            {leaguesError}
          </Alert>
        )}

        {awaitingFirstLeagues ? (
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
        ) : myLeagues.length === 0 && leaguesError ? null : myLeagues.length === 0 ? (
          <Card
            data-testid="leagues-empty-state"
            variant="outlined"
            sx={{ py: 6, px: 3, bgcolor: 'background.paper' }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
              <SportsFootballIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
              <Typography variant="h6" component="h3" gutterBottom>
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
          <LeagueStatusGrid leagues={myLeagues} />
        )}

        {/* Next Up is computed from the leagues list, so it waits for a good
            one: while loading or after a failure it would fall back to
            "Create or join a league", which is false for an existing manager. */}
        {!awaitingFirstLeagues && !leaguesError && (
        <Paper
          variant="outlined"
          component="section"
          aria-labelledby="next-up-heading"
          sx={{ mt: 4, p: { xs: 2, sm: 3 }, borderLeft: '4px solid', borderLeftColor: 'primary.main' }}
        >
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={2}
          >
            <Box>
              <Typography variant="overline" color="primary.main">{nextUp.eyebrow}</Typography>
              <Typography id="next-up-heading" variant="h6" component="h2">{nextUp.title}</Typography>
              {nextUp.draftDate && (
                <Countdown variant="chip" date={nextUp.draftDate} timeZone={nextUp.draftTimeZone} />
              )}
            </Box>
            <Button component={RouterLink} to={nextUp.to} variant="contained">{nextUp.action}</Button>
          </Stack>
        </Paper>
        )}

        {/* Below-the-fold dashboard real estate: real cross-app widgets. */}
        <Box sx={{ mt: 5 }}>
          <Grid container spacing={2}>
            <Grid xs={12} md={6}>
              <Card variant="outlined" sx={{ height: '100%', bgcolor: 'background.paper' }}>
                <CardContent>
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
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
                      {/* The feed can carry two headlines pointing at the same
                          URL, so the link alone isn't a unique key. */}
                      {newsItems.map((item, index) => (
                        <ListItem key={`${item.link}-${index}`} disableGutters>
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
                  <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
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

        {/* Public-layer content (rankings, recaps, strategy) surfaced for
            logged-in users; links cross into the public site. */}
        <Suspense fallback={<Skeleton variant="rounded" height={220} sx={{ mt: 5 }} />}>
          <PublicHighlights />
        </Suspense>

        <Dialog open={openCreateDialog} onClose={handleCloseCreateDialog} className="dialogContainer">
          <DialogTitle className="dialogTitle">Create a New League</DialogTitle>
          <DialogContent>
            {createError && <Alert severity="error" sx={{ mb: 1 }}>{createError}</Alert>}
            <TextField className="dialogTextField" autoFocus margin="dense" label="League Name" required fullWidth value={leagueName} onChange={(event) => setLeagueName(event.target.value)} />
            <TextField
              className="dialogTextField"
              margin="dense"
              label="Team Name"
              fullWidth
              required
              inputProps={{ maxLength: 120 }}
              helperText="Your Team's identity in this league. Other managers never see your account email or username."
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
            />

            <LeagueTypeFields
              leagueType={leagueType}
              onLeagueTypeChange={handleLeagueTypeChange}
              pickemMode={pickemMode}
              onPickemModeChange={setPickemMode}
            />

            {isPickemOnlyType(leagueType) ? (
              // A pick'em pool takes up to 50 managers; a 49-item Select is
              // unusable, so the cap is entered as a number instead.
              <TextField
                className="dialogTextField"
                margin="dense"
                label="Teams"
                type="number"
                fullWidth
                inputProps={{ min: MIN_TEAMS, max: capForType(leagueType) }}
                error={!teamCountValid}
                helperText={`${MIN_TEAMS} to ${capForType(leagueType)} managers`}
                value={numTeams}
                onChange={(event) => setNumTeams(event.target.value)}
              />
            ) : (
              <FormControl margin="dense" sx={{ minWidth: 120 }}>
                <InputLabel id="numTeams-label">Teams</InputLabel>
                <Select
                  labelId="numTeams-label"
                  id="numTeams-select"
                  label="Teams"
                  value={numTeams}
                  onChange={(event) => setNumTeams(event.target.value)}
                >
                  {Array.from({ length: 19 }, (_, i) => i + 2).map((number) => (
                    <MenuItem key={number} value={number}>{number}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

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
            {/* Fantasy-only settings: a pick'em league has no lineups, scoring
                rules or draft, and the server rejects these fields for it. */}
            {includesFantasy(leagueType) && (
              <>
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
                Best ball: an optimal lineup is set automatically each week, with no manual lineup edits.
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
                <MenuItem value="standard">Standard</MenuItem>
                <MenuItem value="half_ppr">Half PPR</MenuItem>
                <MenuItem value="ppr">PPR</MenuItem>
              </Select>
            </FormControl>

            <DraftScheduleField
              wallTime={draftDate}
              onWallTimeChange={setDraftDate}
              timeZone={draftTimezone}
              onTimeZoneChange={setDraftTimezone}
              acknowledged={draftAcknowledged}
              onAcknowledgedChange={setDraftAcknowledged}
            />
              </>
            )}
            </DialogContent>
            <DialogActions>
            {createBlocker && (
              <Typography id="create-league-blocker" variant="body2" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
                {createBlocker}
              </Typography>
            )}
            <Button onClick={handleCloseCreateDialog} color="primary">
             Cancel
            </Button>
            <Button onClick={handleCreateLeague} color="primary" aria-describedby={createBlocker ? 'create-league-blocker' : undefined} disabled={creating || Boolean(createBlocker)}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
            </DialogActions>
            </Dialog>
        <Dialog open={openJoinDialog} onClose={handleCloseJoinDialog} className="dialogContainer">
          <DialogTitle className="dialogTitle">Join an Existing League</DialogTitle>
          <DialogContent>
            {joinError && <Alert severity="error" sx={{ mb: 1 }}>{joinError}</Alert>}
            <TextField
              className="dialogTextField"
              autoFocus
              margin="dense"
              label="Invite Code"
              required
              fullWidth
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
            />
            <TextField
              className="dialogTextField"
              margin="dense"
              label="Team Name"
              fullWidth
              required
              inputProps={{ maxLength: 120 }}
              helperText="Your Team's identity in this league. Other managers never see your account email or username."
              value={joinTeamName}
              onChange={(event) => setJoinTeamName(event.target.value)}
            />
          </DialogContent>
                  <DialogActions>
                    {joinBlocker && (
                      <Typography id="join-league-blocker" variant="body2" color="text.secondary" sx={{ mr: 'auto', pl: 1 }}>
                        {joinBlocker}
                      </Typography>
                    )}
                    <Button onClick={handleCloseJoinDialog} color="primary">
                      Cancel
                    </Button>
                    <Button onClick={handleJoinLeague} color="primary" aria-describedby={joinBlocker ? 'join-league-blocker' : undefined} disabled={joining || Boolean(joinBlocker)}>
                      {joining ? 'Joining…' : 'Join'}
                    </Button>
                  </DialogActions>
                </Dialog>
      </Container>
    </Box>
  );
}

export default UserPage;
