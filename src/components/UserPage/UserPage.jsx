import React, {
  useState, useEffect, useMemo, useRef, Suspense,
} from 'react';
import { useSelector } from 'react-redux';
import {
  Typography, Button, Alert, Container, Box, Card, CardContent,
  Skeleton, Stack, List, ListItem, ListItemText, Link,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import { ThemeProvider, useTheme } from '@mui/material/styles';
import { Link as RouterLink } from 'react-router-dom';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { useNotifications } from '../../hooks/useNotifications';
import LeagueStatusGrid from './LeagueStatusGrid';
import ActionQueue from './ActionQueue';
import AlertPrompt from './AlertPrompt';
import NextDraftCard, { featuredDraft } from './NextDraftCard';
import {
  GreetingStats, GreetingSummary, LiveMatchupsChip, liveMatchupCount,
} from './GreetingHeader';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import { usePostgameCutscenes, PostgameCutscenes } from '../../features/postgame-cutscene';
import homeTheme from './homeTheme';
import {
  DISPLAY_FONT, alertActionSx, alertSx, dimSx, ghostButtonSx, homeRootSx, panelSx, panelTitleSx,
  primaryButtonSx, skeletonSx, textLinkSx,
} from '../common/homeIslandSx';
import { lazyWithReload } from '../../shared/lib/lazyWithReload';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import { formatInstant } from '../../shared/lib/instantFormat';

// Lazy: PublicHighlights (the Darkness Report card) imports the
// strategy-article registry, which must not ride in the initial main bundle.
// See the note in PublicHighlights.jsx.
const PublicHighlights = lazyWithReload(() => import('./PublicHighlights'));

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

const requestLeagues = async () => (await apiClient.get('/api/league', { params: { include: 'status' } })).data;

const greetingDateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

// The Activity card below the fold on the island: a panel, a display-face
// title, ink rows with dim secondary lines, all on a card.
const feedCardSx = { ...panelSx, height: '100%' };
const feedTitleSx = { ...panelTitleSx, mb: 1.5 };
const feedListSx = {
  '& .MuiListItemText-primary': { color: 'var(--dash-ink)' },
  '& .MuiListItemText-secondary': dimSx,
};
const feedStatusSx = { ...dimSx, fontSize: '14px' };
const ACTIVITY_MAX = 3;
const heroButtonSx = { minHeight: 48, px: 2.5, fontSize: '15px' };
const LATE_POLL_MS = 30 * 1000;
// A draft the server could not auto-start waits on the commissioner, so it is
// checked less often.
const FAILED_POLL_MS = 2 * 60 * 1000;
const START_GRACE_MS = 5 * 1000;
// The first-run mock-draft line: dim, and inline-flex so the 44px floor applies.
const mockDraftLinkSx = {
  ...dimSx, ...MIN_TOUCH_TARGET_SX, display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start',
};
const FIRST_RUN_STEPS = [
  ['Create the league', "Name it, pick fantasy or pick'em, and set the size."],
  ['Send the invite code', 'Friends join with the code you share.'],
  ['Draft tonight', 'Live draft with a pick clock, or let autopick handle it.'],
];
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
const JoinLeagueDialog = lazyWithReload(() => import('./JoinLeagueDialog'));
const CreateLeagueStepper = lazyWithReload(() => import('./CreateLeagueStepper'));

function UserPage() {
  const user = useSelector((store) => store.user);
  const outerTheme = useTheme();
  const theme = useMemo(() => homeTheme(outerTheme), [outerTheme]);

  // The Postgame cutscenes due for this manager (ADR 0052): one read per Home
  // mount, in parallel with the reads below; a failure renders nothing.
  const { cutscenes: postgameCutscenes } = usePostgameCutscenes();

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

  // Shared with the Nav bell (ADR 0004, ADR 0059's #2097 amendment): mounted
  // together (a hard load) one request serves both, and the bell's poll reloads
  // this card too. Like the leagues list above, skeletons and the error stand
  // in only for a list we don't have; a poll that is loading or has failed
  // keeps the good list on screen.
  const {
    notifications,
    loaded: haveActivity,
    loading: loadingActivity,
    error: activityFailure,
    refetch: refetchActivity,
  } = useNotifications();
  // The feed is newest first, so the first of a repeated (message, league) pair is the newest.
  const seenActivity = new Set();
  const activityItems = notifications
    .filter((item) => {
      const key = JSON.stringify([item.message, item.league_name]);
      return !seenActivity.has(key) && seenActivity.add(key);
    })
    .slice(0, ACTIVITY_MAX);
  const awaitingActivity = loadingActivity && !haveActivity;
  const activityError = Boolean(activityFailure) && !haveActivity;
  // Skeletons only stand in for a list we don't have yet. A refetch (Try
  // again, or the refresh after a create or join) keeps the good list up.
  const awaitingFirstLeagues = loadingLeagues && myLeagues.length === 0;
  // First run: the leagues read succeeded and found none. Not while loading (no
  // flash of the first-run state) and not after a failed read.
  const firstRun = !loadingLeagues && !leaguesError && myLeagues.length === 0;
  const featured = featuredDraft(myLeagues);
  const nextDraft = featured?.league ?? null;
  const featuredState = featured?.state ?? null;
  // While the draft card is live for a league, its to-do row goes quiet: the
  // card keeps the one filled Join draft button.
  const quietDraftLeagueId = nextDraft && featuredState === 'live' ? nextDraft.id : null;
  // On draft night the card leads the to-do list on a phone; at lg they sit
  // side by side as ever.
  const draftFirst = Boolean(nextDraft) && (featuredState === 'live' || featuredState === 'late');
  const currentWeek = sharedCurrentWeek(myLeagues);
  const liveMatchups = liveMatchupCount(myLeagues);

  const fetchMyLeagues = async () => {
    try {
      setLoadingLeagues(true);
      setMyLeagues(await requestLeagues());
      setLeaguesError(null);
    } catch (err) {
      // Keep the last good list (if any) on screen under the alert.
      setLeaguesError(readHttpFailure(err).message || err.message);
    } finally {
      setLoadingLeagues(false);
    }
  };

  // The draft-night refetch and poll: a background load never touches the
  // loading or error state, so a failed tick leaves the page as it was and the
  // next tick retries.
  const refreshLeagues = async () => {
    try {
      setMyLeagues(await requestLeagues());
      setLeaguesError(null);
    } catch (err) {
      // Intentionally silent.
    }
  };

  useEffect(() => {
    fetchMyLeagues();
  }, []);

  // Draft night: the card is only as fresh as the leagues list. When a
  // scheduled draft's countdown runs out the card refetches once, just after
  // (the server has auto-started it, or it is now late); a late one refetches
  // every 30 seconds (2 minutes once auto-start failed) until it goes live. A
  // live draft needs no timer. All of these are background refetches: no
  // skeletons, no error alert, and a hidden tab skips its ticks and catches up
  // when it is shown again.
  const featuredId = nextDraft?.id;
  const featuredFailed = nextDraft?.draft_autostart_failed === true;
  const expireTimer = useRef(null);
  useEffect(() => () => clearTimeout(expireTimer.current), []);
  const handleDraftExpire = () => {
    clearTimeout(expireTimer.current);
    expireTimer.current = setTimeout(refreshLeagues, START_GRACE_MS);
  };
  useEffect(() => {
    if (featuredState !== 'late') return undefined;
    const refreshIfVisible = () => { if (!document.hidden) refreshLeagues(); };
    const poll = setInterval(refreshIfVisible, featuredFailed ? FAILED_POLL_MS : LATE_POLL_MS);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [featuredState, featuredId, featuredFailed]);

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
      <PostgameCutscenes cutscenes={postgameCutscenes} />
      {/* flexGrow cooperates with the flex column shell App.jsx sets up
          around <Nav />/<Routes />/<Footer /> so short pages still pin the
          footer to the bottom of the viewport, while tall pages scroll
          normally. A region named by its h1 (the shell's <main> is the page's
          one main landmark); the shell's skip link (App.jsx SKIP_LINK_TARGETS) focuses it by id, hence
          tabIndex -1. */}
      <Box
        component="section"
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
                {firstRun ? 'Welcome' : 'Welcome back'}, {user.username}
              </Typography>
              {!firstRun && <GreetingSummary actionItems={actionItems} />}
              <GreetingStats leagues={myLeagues} />
            </Box>
            {/* Hidden on a first run: the empty state below carries the only
                Create (filled) and Join (ghost) pair. Otherwise always a ghost
                beside Join. */}
            {!firstRun && (
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                <Button variant="outlined" size="large" onClick={handleOpenJoinDialog} sx={heroGhostSx}>
                  Join league
                </Button>
                <Button variant="outlined" size="large" onClick={handleOpenCreateDialog} sx={heroGhostSx}>
                  Create league
                </Button>
              </Stack>
            )}
          </Stack>

          {/* The to-do list replaces the old hero and "Next up" nudge. It owns
              its own fetch and states, so it never holds up My leagues. */}
          {/* No to-do list on a first run ("all caught up" would be untrue of a
              manager with nothing yet to catch up on), and no empty grid row. */}
          {!firstRun && (
            <Grid container spacing={3} sx={{ mb: 5 }}>
              {/* On draft night the card comes first in the DOM, so a phone's
                  focus order follows the page; `order` puts the list back on
                  the left at lg. */}
              {draftFirst && (
                <Grid xs={12} lg={4} sx={{ order: { xs: 0, lg: 2 } }}>
                  <NextDraftCard league={nextDraft} onExpire={handleDraftExpire} />
                </Grid>
              )}
              <Grid xs={12} lg={nextDraft ? 8 : 12} sx={draftFirst ? { order: 1 } : undefined}>
                <ActionQueue onLoaded={setActionItems} leagues={myLeagues} quietDraftLeagueId={quietDraftLeagueId} />
              </Grid>
              {nextDraft && !draftFirst && (
                <Grid xs={12} lg={4}>
                  <NextDraftCard league={nextDraft} onExpire={handleDraftExpire} />
                </Grid>
              )}
            </Grid>
          )}


          <Typography variant="h5" component="h2" sx={{ ...panelTitleSx, mb: 2 }}>
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
              sx={{ ...panelSx, py: { xs: 3, md: 5 }, px: { xs: 2.5, md: 4 } }}
            >
              <Grid container spacing={{ xs: 3, md: 5 }}>
                <Grid xs={12} md={6}>
                  <Stack alignItems="flex-start">
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
                      Start a league tonight
                    </Typography>
                    <Typography sx={{ ...dimSx, mb: 3, maxWidth: 420 }}>
                      Free to play. Pick fantasy, NFL pick&apos;em, or both, send
                      your friends the invite code, and draft as soon as they&apos;re in.
                    </Typography>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 1.5 }}>
                      <Button variant="contained" size="large" onClick={handleOpenCreateDialog} sx={{ ...primaryButtonSx, ...heroButtonSx }}>
                        Create league
                      </Button>
                      <Button variant="outlined" size="large" onClick={handleOpenJoinDialog} sx={{ ...ghostButtonSx, ...heroButtonSx }}>
                        I have an invite code
                      </Button>
                    </Stack>
                    <Link component={RouterLink} to="/draft-sim" underline="always" sx={mockDraftLinkSx}>
                      Not ready yet? Practice a mock draft
                    </Link>
                  </Stack>
                </Grid>
                <Grid xs={12} md={6}>
                  <Stack component="ol" spacing={2} sx={{ m: 0, p: 0, listStyle: 'none', counterReset: 'step' }}>
                    {FIRST_RUN_STEPS.map(([title, body]) => (
                      <Box
                        component="li"
                        key={title}
                        sx={{
                          counterIncrement: 'step',
                          display: 'flex',
                          gap: 2,
                          '&::before': {
                            content: 'counter(step)',
                            flex: 'none',
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            fontWeight: 700,
                            backgroundColor: 'var(--dash-accent-soft)',
                            color: 'var(--dash-accent)',
                          },
                        }}
                      >
                        <Box>
                          <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
                          <Typography variant="body2" sx={{ ...dimSx, fontSize: '14px' }}>{body}</Typography>
                        </Box>
                      </Box>
                    ))}
                  </Stack>
                </Grid>
              </Grid>
            </Card>
          ) : (
            <LeagueStatusGrid leagues={myLeagues} />
          )}

          {/* Its own full-width row under My leagues, so the header's Create and
              Join stay the page's only competing actions above the fold. Renders
              nothing when the prompt has nothing to ask. */}
          <Box sx={{ '&:not(:empty)': { mt: 3 } }}>
            <AlertPrompt leagues={myLeagues} />
          </Box>

          {/* Below the fold: recent activity (not on a first run) beside the
              Darkness Report, which renders nothing when there is none. */}
          <Box
            sx={{
              mt: 5,
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            {!firstRun && (
              <Card variant="outlined" sx={feedCardSx}>
                <CardContent>
                  <Typography variant="h6" component="h2" sx={feedTitleSx}>
                    In your leagues
                  </Typography>
                  {awaitingActivity ? (
                    <Stack spacing={1}>
                      {[0, 1, 2].map((i) => (
                        <Skeleton key={i} variant="text" width={`${85 - i * 10}%`} sx={skeletonSx} />
                      ))}
                    </Stack>
                  ) : activityError ? (
                    <Stack alignItems="flex-start">
                      <Typography variant="body2" sx={feedStatusSx}>
                        We couldn&apos;t load recent activity.
                      </Typography>
                      <Button onClick={refetchActivity} sx={{ ...textLinkSx, minHeight: 44 }}>
                        Try again
                      </Button>
                    </Stack>
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
                            secondary={[item.league_name, formatInstant(item.created_at, 'day')].filter(Boolean).join(' · ')}
                          />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </CardContent>
              </Card>
            )}
            <Suspense fallback={null}>
              <PublicHighlights />
            </Suspense>
          </Box>

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
