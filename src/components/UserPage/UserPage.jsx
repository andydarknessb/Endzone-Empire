import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useSelector } from 'react-redux';
import {
  Typography, Button, Alert, Container, Box, Card, CardContent,
  Skeleton, Stack, List, ListItem, ListItemText, Link,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import SportsFootballIcon from '@mui/icons-material/SportsFootball';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import LeagueStatusGrid from './LeagueStatusGrid';
import ActionQueue from './ActionQueue';
import NextDraftCard, { nextScheduledDraft } from './NextDraftCard';
import JoinLeagueDialog from './JoinLeagueDialog';
import CreateLeagueStepper from './CreateLeagueStepper';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';

// Lazy: PublicHighlights imports the strategy-article registry (full JSX
// bodies), which must not ride in the initial main bundle. See the note in
// PublicHighlights.jsx.
const PublicHighlights = lazy(() => import('./PublicHighlights'));

// The greeting's "Week 4 · Sunday, Oct 4" line: the NFL week the manager's
// in-season leagues are in, or null when none is in season or they disagree
// (then the line is left out rather than guessed).
function sharedCurrentWeek(leagues) {
  const weeks = new Set(
    leagues
      .filter((league) => [LEAGUE_PHASE.IN_SEASON, LEAGUE_PHASE.PLAYOFFS].includes(deriveLeaguePhase(league)))
      .map((league) => Number(league.current_week))
      .filter((week) => Number.isInteger(week) && week > 0)
  );
  return weeks.size === 1 ? [...weeks][0] : null;
}

const greetingDateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

function UserPage() {
  const user = useSelector((store) => store.user);

  const [myLeagues, setMyLeagues] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  // A failed leagues fetch is its own state, not the dialogs' `error`: it must
  // never fall through to the empty state (which tells a manager they have no
  // leagues) and opening Create or Join must not clear it.
  const [leaguesError, setLeaguesError] = useState(null);

  // Create League stepper: its answers and request live in CreateLeagueStepper.
  const [openCreateDialog, setOpenCreateDialog] = useState(false);

  // Join League dialog — leagues are private, so joining is always by invite
  // code. The dialog owns its answers, preview and in-flight state.
  const [openJoinDialog, setOpenJoinDialog] = useState(false);

  // Below-the-fold dashboard widgets — each fetches independently so a slow
  // or failed one never blocks the leagues list (or each other).
  const [newsItems, setNewsItems] = useState([]);
  const [loadingNews, setLoadingNews] = useState(true);
  const [newsError, setNewsError] = useState(false);

  const [activityItems, setActivityItems] = useState([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [activityError, setActivityError] = useState(false);
  // Skeletons only stand in for a list we don't have yet. A refetch (Try
  // again, or the refresh after a create or join) keeps the good list up.
  const awaitingFirstLeagues = loadingLeagues && myLeagues.length === 0;
  const nextDraft = nextScheduledDraft(myLeagues);
  const currentWeek = sharedCurrentWeek(myLeagues);

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
  };

  // Functions to handle join dialog
  const handleOpenJoinDialog = () => {
    setOpenJoinDialog(true);
  };

  const handleCloseJoinDialog = () => {
    setOpenJoinDialog(false);
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
        {/* Greeting header (Home v2): the page's one h1, with Create and Join
            beside it (under it below md). */}
        <Stack
          component="header"
          data-testid="dashboard-hero"
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'flex-end' }}
          spacing={2}
          sx={{ mb: 3 }}
        >
          <Box>
            {currentWeek && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1 }}
              >
                {`Week ${currentWeek} · ${greetingDateFormat.format(new Date())}`}
              </Typography>
            )}
            <Typography variant="h4" component="h1" id="user-page-heading" sx={{ fontWeight: 700, lineHeight: 1.15 }}>
              Welcome back, {user.username}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" size="large" onClick={handleOpenJoinDialog}>
              Join League
            </Button>
            <Button variant="contained" size="large" onClick={handleOpenCreateDialog}>
              Create League
            </Button>
          </Stack>
        </Stack>

        {/* The to-do list replaces the old hero and "Next up" nudge. It owns
            its own fetch and states, so it never holds up My Leagues. */}
        <Grid container spacing={3} sx={{ mb: 4 }}>
          <Grid xs={12} lg={nextDraft ? 8 : 12}>
            <ActionQueue />
          </Grid>
          {nextDraft && (
            <Grid xs={12} lg={4}>
              <NextDraftCard league={nextDraft} />
            </Grid>
          )}
        </Grid>


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

        <CreateLeagueStepper
          open={openCreateDialog}
          onClose={handleCloseCreateDialog}
          onCreated={fetchMyLeagues}
        />
        <JoinLeagueDialog open={openJoinDialog} onClose={handleCloseJoinDialog} onJoined={fetchMyLeagues} />
      </Container>
    </Box>
  );
}

export default UserPage;
