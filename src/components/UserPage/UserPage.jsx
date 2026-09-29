import React, {
  useState, useEffect, useMemo, lazy, Suspense,
} from 'react';
import { useSelector } from 'react-redux';
import {
  Typography, Button, Alert, Container, Box, Card, CardContent,
  Skeleton, Stack, List, ListItem, ListItemText, Link,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ThemeProvider, useTheme } from '@mui/material/styles';
import SportsFootballIcon from '@mui/icons-material/SportsFootball';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import LeagueStatusGrid from './LeagueStatusGrid';
import ActionQueue from './ActionQueue';
import NextDraftCard, { nextScheduledDraft } from './NextDraftCard';
import {
  GreetingStats, GreetingSummary, LiveMatchupsChip, liveMatchupCount,
} from './GreetingHeader';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import homeTheme from './homeTheme';
import {
  DISPLAY_FONT, alertActionSx, alertSx, dimSx, ghostButtonSx, homeRootSx, panelSx, panelTitleSx,
  primaryButtonSx, sectionTitleSx, skeletonSx,
} from '../common/homeIslandSx';

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

const greetingDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

// The feed cards below the fold (News, Activity) on the island: a panel, a
// display-face title, ink rows with dim secondary lines, all on a card.
const feedCardSx = { ...panelSx, height: '100%' };
const feedTitleSx = { ...panelTitleSx, fontSize: '18px', mb: 1.5 };
const feedListSx = {
  '& .MuiListItemText-primary': { color: 'var(--dash-ink)' },
  '& .MuiListItemText-secondary': dimSx,
};
const feedStatusSx = { ...dimSx, fontSize: '14px' };
const heroButtonSx = { minHeight: 48, px: 2.5, fontSize: '15px' };
// Join sits on the page, so the ghost paints its own `dash-surface` fill (the
// board's Join league button): ink on a card surface, a registered pairing.
const heroGhostSx = {
  ...ghostButtonSx,
  ...heroButtonSx,
  backgroundColor: 'var(--dash-surface)',
  '&:hover': { ...ghostButtonSx['&:hover'], backgroundColor: 'var(--dash-surface)' },
};

// The create and join flows load when a Manager first opens them: Home is in
// the initial bundle, and neither dialog is needed to paint it.
const JoinLeagueDialog = lazy(() => import('./JoinLeagueDialog'));
const CreateLeagueStepper = lazy(() => import('./CreateLeagueStepper'));

function UserPage() {
  const user = useSelector((store) => store.user);
  const outerTheme = useTheme();
  const theme = useMemo(() => homeTheme(outerTheme), [outerTheme]);

  const [myLeagues, setMyLeagues] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  // A failed leagues fetch is its own state, not the dialogs' `error`: it must
  // never fall through to the empty state (which tells a manager they have no
  // leagues) and opening Create or Join must not clear it.
  const [leaguesError, setLeaguesError] = useState(null);

  // Create League stepper: its answers and request live in CreateLeagueStepper.
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  // Each dialog mounts on its first open and then stays mounted, so closing the
  // stepper mid-way keeps its answers.
  const [createOpened, setCreateOpened] = useState(false);
  const [joinOpened, setJoinOpened] = useState(false);

  // The to-do list body ActionQueue fetched, lifted for the greeting's
  // summary line (one request, not two). Null until it loads and on error.
  const [actionItems, setActionItems] = useState(null);

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
  const liveMatchups = liveMatchupCount(myLeagues);

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
    setCreateOpened(true);
  };

  const handleCloseCreateDialog = () => {
    setOpenCreateDialog(false);
  };

  // Functions to handle join dialog
  const handleOpenJoinDialog = () => {
    setOpenJoinDialog(true);
    setJoinOpened(true);
  };

  const handleCloseJoinDialog = () => {
    setOpenJoinDialog(false);
  };

  return (
    // Home joins the island (ADR 0051): homeTheme sets every Typography,
    // button and input in the island's body face, and the root paints its
    // token context (`dash-bg`, `dash-ink`, the body face). Nav and Footer
    // stay on the app tokens.
    <ThemeProvider theme={theme}>
      {/* flexGrow cooperates with the flex column shell App.jsx sets up
          around <Nav />/<Routes />/<Footer /> so short pages still pin the
          footer to the bottom of the viewport, while tall pages scroll
          normally. The page's one main landmark, named by its h1; the shell's
          skip link (App.jsx SKIP_LINK_TARGETS) focuses it by id, hence
          tabIndex -1. */}
      <Box
        component="main"
        id="user-main-content"
        tabIndex={-1}
        aria-labelledby="user-page-heading"
        sx={{ ...homeRootSx, display: 'flex', flexDirection: 'column', flexGrow: 1 }}
      >
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4.5 } }}>
          {/* Greeting header (Home v2): the page's one h1, with Create and Join
              beside it (under it below md). */}
          <Stack
            component="header"
            data-testid="dashboard-hero"
            direction={{ xs: 'column', md: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', md: 'flex-end' }}
            spacing={2}
            sx={{ mb: 4 }}
          >
            <Box>
              {/* The eyebrow row: the week line and the live chip, each left
                  out when it has nothing to say. */}
              {(currentWeek || liveMatchups > 0) && (
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                  useFlexGap
                  flexWrap="wrap"
                  sx={{ ...dimSx, fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 1.25 }}
                >
                  {currentWeek && (
                    <span>{`Week ${currentWeek} · ${greetingDateFormat.format(new Date())}`}</span>
                  )}
                  <LiveMatchupsChip leagues={myLeagues} />
                </Stack>
              )}
              <Typography
                variant="h4"
                component="h1"
                id="user-page-heading"
                sx={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: { xs: '36px', md: '48px' },
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: '0.01em',
                  textTransform: 'uppercase',
                }}
              >
                Welcome back, {user.username}
              </Typography>
              <GreetingSummary actionItems={actionItems} />
              <GreetingStats leagues={myLeagues} />
            </Box>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button variant="outlined" size="large" onClick={handleOpenJoinDialog} sx={heroGhostSx}>
                Join league
              </Button>
              <Button variant="contained" size="large" onClick={handleOpenCreateDialog} sx={{ ...primaryButtonSx, ...heroButtonSx }}>
                Create league
              </Button>
            </Stack>
          </Stack>

          {/* The to-do list replaces the old hero and "Next up" nudge. It owns
              its own fetch and states, so it never holds up My leagues. */}
          <Grid container spacing={3} sx={{ mb: 5 }}>
            <Grid xs={12} lg={nextDraft ? 8 : 12}>
              <ActionQueue onLoaded={setActionItems} leagues={myLeagues} />
            </Grid>
            {nextDraft && (
              <Grid xs={12} lg={4}>
                <NextDraftCard league={nextDraft} />
              </Grid>
            )}
          </Grid>


          <Typography variant="h5" component="h2" sx={{ ...sectionTitleSx, mb: 2 }}>
            My leagues
          </Typography>

          {/* On the page: ink on the danger tint over `dash-bg`, the danger
              edge and icon, and the retry as a card-surface chip. */}
          {leaguesError && !loadingLeagues && (
            <Alert
              severity="error"
              sx={{ ...alertSx('danger'), mb: 2 }}
              action={(
                <Button color="inherit" size="small" onClick={fetchMyLeagues} sx={{ ...alertActionSx('danger'), minHeight: 44 }}>
                  Try again
                </Button>
              )}
            >
              {leaguesError}
            </Alert>
          )}

          {awaitingFirstLeagues ? (
            <Grid container spacing={2}>
              {[0, 1, 2].map((i) => (
                <Grid xs={12} sm={6} md={4} key={i}>
                  <Card variant="outlined" sx={{ ...panelSx, height: '100%' }} data-testid="league-skeleton">
                    <CardContent>
                      <Skeleton variant="text" width="60%" height={32} sx={skeletonSx} />
                      <Skeleton variant="text" width="45%" sx={skeletonSx} />
                      <Skeleton variant="text" width="30%" sx={skeletonSx} />
                      <Skeleton variant="rounded" width={80} height={24} sx={{ ...skeletonSx, mt: 1 }} />
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          ) : myLeagues.length === 0 && leaguesError ? null : myLeagues.length === 0 ? (
            <Card
              data-testid="leagues-empty-state"
              variant="outlined"
              sx={{ ...panelSx, py: 6, px: 3 }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <Box
                  aria-hidden="true"
                  sx={{
                    width: 72,
                    height: 72,
                    mb: 2,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    backgroundColor: 'var(--dash-accent-soft)',
                    color: 'var(--dash-accent)',
                  }}
                >
                  <SportsFootballIcon sx={{ fontSize: 40 }} />
                </Box>
                <Typography
                  variant="h6"
                  component="h3"
                  gutterBottom
                  sx={{
                    fontFamily: DISPLAY_FONT,
                    fontSize: { xs: '26px', md: '32px' },
                    fontWeight: 700,
                    lineHeight: 1.05,
                    textTransform: 'uppercase',
                  }}
                >
                  You aren&apos;t managing any teams yet.
                </Typography>
                <Typography sx={{ ...dimSx, mb: 3, maxWidth: 380 }}>
                  Start a brand-new league with your friends, or jump into one
                  you&apos;ve already been invited to.
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <Button variant="contained" size="large" onClick={handleOpenCreateDialog} sx={{ ...primaryButtonSx, ...heroButtonSx }}>
                    Create league
                  </Button>
                  <Button variant="outlined" size="large" onClick={handleOpenJoinDialog} sx={{ ...ghostButtonSx, ...heroButtonSx }}>
                    Join league
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
                <Card variant="outlined" sx={feedCardSx}>
                  <CardContent>
                    <Typography variant="h6" component="h2" sx={feedTitleSx}>
                      Latest NFL News
                    </Typography>
                    {loadingNews ? (
                      <Stack spacing={1}>
                        {[0, 1, 2].map((i) => (
                          <Skeleton key={i} variant="text" width={`${85 - i * 10}%`} sx={skeletonSx} />
                        ))}
                      </Stack>
                    ) : newsError ? (
                      <Typography variant="body2" sx={feedStatusSx}>
                        Couldn&apos;t load the latest news right now.
                      </Typography>
                    ) : newsItems.length === 0 ? (
                      <Typography variant="body2" sx={feedStatusSx}>
                        No news to show right now.
                      </Typography>
                    ) : (
                      <List dense disablePadding sx={feedListSx}>
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
                                  sx={{ color: 'var(--dash-ink)', fontWeight: 600 }}
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
                <Card variant="outlined" sx={feedCardSx}>
                  <CardContent>
                    <Typography variant="h6" component="h2" sx={feedTitleSx}>
                      Global Activity
                    </Typography>
                    {loadingActivity ? (
                      <Stack spacing={1}>
                        {[0, 1, 2].map((i) => (
                          <Skeleton key={i} variant="text" width={`${85 - i * 10}%`} sx={skeletonSx} />
                        ))}
                      </Stack>
                    ) : activityError ? (
                      <Typography variant="body2" sx={feedStatusSx}>
                        Couldn&apos;t load recent activity right now.
                      </Typography>
                    ) : activityItems.length === 0 ? (
                      <Typography variant="body2" sx={feedStatusSx}>
                        No recent activity across your leagues yet.
                      </Typography>
                    ) : (
                      <List dense disablePadding sx={feedListSx}>
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
          <Suspense fallback={<Skeleton variant="rounded" height={220} sx={{ ...skeletonSx, mt: 5, borderRadius: 'var(--dash-radius)' }} />}>
            <PublicHighlights />
          </Suspense>

          <Suspense fallback={null}>
            {createOpened && (
              <CreateLeagueStepper
                open={openCreateDialog}
                onClose={handleCloseCreateDialog}
                onCreated={fetchMyLeagues}
              />
            )}
            {joinOpened && (
              <JoinLeagueDialog open={openJoinDialog} onClose={handleCloseJoinDialog} onJoined={fetchMyLeagues} />
            )}
          </Suspense>
        </Container>
      </Box>
    </ThemeProvider>
  );
}

export default UserPage;
