import React, {
  useState, useEffect, useMemo, useRef, useCallback, Suspense,
} from 'react';
import { useSelector } from 'react-redux';
import { Box, useMediaQuery } from '@mui/material';
import { ThemeProvider, useTheme } from '@mui/material/styles';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { useNotifications } from '../../hooks/useNotifications';
import LeagueCards from './LeagueCards/LeagueCards';
import ActionQueue from './ActionQueue';
import AlertPrompt from './AlertPrompt';
import LeagueNews from './LeagueNews';
import { featuredDraft } from './NextDraftCard';
import {
  FirstRunIntro, GreetingHeader, greetingSummary, liveMatchupCount, pickemLive,
} from './GreetingHeader';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import { usePostgameCutscenes, PostgameCutscenes } from '../../features/postgame-cutscene';
import homeTheme from './homeTheme';
import {
  Frame, FrameHead, PsButton, PsLink, PixelHeading, PlayCard, pixelSx, psRootSx,
} from '../../shared/ui/playselect';
import { useLiveRefresh } from './useLiveRefresh';
import { lazyWithReload } from '../../shared/lib/lazyWithReload';

// Lazy: PublicHighlights (the Columns frame) imports the strategy-article
// registry, which must not ride in the initial main bundle. See the note in
// PublicHighlights.jsx.
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

const NEWS_MAX = 3;
const LATE_POLL_MS = 30 * 1000;
// A draft the server could not auto-start waits on the commissioner, so it is
// checked less often.
const FAILED_POLL_MS = 2 * 60 * 1000;
const START_GRACE_MS = 5 * 1000;
// Before kickoff nothing polls: one refresh is scheduled at the earliest
// upcoming lock, never sooner than this from now, so the page catches the
// matchup going live. A tab shown again refreshes if the last load is older than
// STALE_AFTER_MS.
const MIN_KICKOFF_WAIT_MS = 30 * 1000;
const STALE_AFTER_MS = 60 * 1000;
// The server keeps a matchup `scheduled` for a while after kickoff (live only
// once a starter's game is in progress), so for this long after a lock the page
// polls like game day until a matchup goes live.
const KICKOFF_WINDOW_MS = 30 * 60 * 1000;
// Home's field reaches the Nav and the Footer: the app shell leaves the Nav's
// 30px bottom margin and the Footer's 80px top margin in page colour, and the
// root cancels both (the inner padding keeps the content where it was).
const NAV_GAP = '30px';
const FOOTER_GAP = '80px';

// Every instant on the leagues that a matchup could go live at: the lineup and
// pick'em locks the status carries, and the matchup's own kickoff when it has one.
function upcomingLocks(leagues) {
  return leagues.flatMap((league) => {
    const status = league?.status;
    if (!status || league.statusError === true) return [];
    return [status.lineup?.nextLockAt, status.pickem?.nextLockAt, status.matchup?.kickoffAt]
      .map((value) => (value ? new Date(value).getTime() : NaN))
      .filter((at) => Number.isFinite(at));
  });
}
// The sentence under a failed leagues read when the server sent none.
const LEAGUES_FAILED_BODY = 'Check your connection, then try again.';
const FIRST_RUN_STEPS = [
  ['Create the league', 'Name it, choose the format and set the size.'],
  ['Send the invite code', 'Friends join with the code you share.'],
  ['Play this week', "Fantasy leagues draft live with a pick clock. Pick'em leagues skip the draft and start picking."],
];

// The create and join flows load when a Manager first opens them: Home is in
// the initial bundle, and neither dialog is needed to paint it.
const JoinLeagueDialog = lazyWithReload(() => import('./JoinLeagueDialog'));
const CreateLeagueStepper = lazyWithReload(() => import('./CreateLeagueStepper'));

// First run's "Start here" frame (build-firstrun.js): the two ways in are play
// cards, the page's only Create and Join. Create leads and carries the one
// filled foot.
function StartHere({ onCreate, onJoin }) {
  return (
    <Frame
      labelledBy="start-heading"
      data-testid="leagues-empty-state"
      head={<FrameHead><PixelHeading id="start-heading">Start here</PixelHeading></FrameHead>}
    >
      <Box
        sx={{
          display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: '8px', p: '12px',
        }}
      >
        <PlayCard
          kind="create"
          name="Create a league"
          league="Your league, your rules"
          lockNote="You'll be the commissioner."
          cta={{ label: 'Create a league', onClick: onCreate }}
          ariaLabel="Invite friends and choose your format"
          state="next"
          lead
        />
        <PlayCard
          kind="join"
          name="Join with a code"
          league="Your friends' league"
          lockNote="Paste the invite code your commissioner sent you."
          cta={{ label: 'Join with a code', onClick: onJoin }}
          ariaLabel="Enter the invite code your commissioner sent you"
        />
        <Box
          sx={{
            gridColumn: { md: 'span 2' },
            p: { xs: '12px 4px 0', md: '12px 12px 12px 20px' },
            borderTop: { xs: '2px solid var(--ps-rule)', md: 0 },
            borderLeft: { md: '2px solid var(--ps-rule)' },
          }}
        >
          <Box component="h3" sx={{ m: '0 0 4px', ...pixelSx(16), color: 'var(--ps-dim)' }}>How it works</Box>
          <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {FIRST_RUN_STEPS.map(([title, body], i) => (
              <Box
                component="li"
                key={title}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '28px 1fr', md: '32px 1fr' },
                  gap: '12px',
                  p: '12px 0',
                  borderBottom: i === FIRST_RUN_STEPS.length - 1 ? 0 : '2px solid var(--ps-rule)',
                }}
              >
                <Box component="span" sx={pixelSx(16)}>{i + 1}</Box>
                <Box>
                  <Box sx={{ fontWeight: 600 }}>{title}</Box>
                  <Box sx={{ fontSize: '14px', color: 'var(--ps-dim)' }}>{body}</Box>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '4px 12px',
          p: { xs: '4px 14px', md: '4px 16px' },
          borderTop: '2px solid var(--ps-rule)',
          fontSize: '14px',
          color: 'var(--ps-dim)',
        }}
      >
        Not ready yet?
        <PsLink to="/draft-sim">Practice a mock draft</PsLink>
      </Box>
    </Frame>
  );
}

function UserPage() {
  const user = useSelector((store) => store.user);
  const outerTheme = useTheme();
  const theme = useMemo(() => homeTheme(outerTheme), [outerTheme]);
  // Join and Create sit at the top right of the header on a desktop and at the
  // bottom of the page on a phone. One render, placed by breakpoint, so only
  // one pair is ever in the accessibility tree.
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true });

  // The Postgame cutscenes due for this manager (ADR 0052): one read per Home
  // mount, in parallel with the reads below; a failure renders nothing.
  const { cutscenes: postgameCutscenes } = usePostgameCutscenes();

  const [myLeagues, setMyLeagues] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(true);
  // A failed leagues fetch is its own state, not the dialogs' `error`: it must
  // never fall through to the empty state (which tells a manager they have no
  // leagues) and opening Create or Join must not clear it.
  const [leaguesError, setLeaguesError] = useState(null);
  // When the leagues list last loaded, for the "updated" stamp on game day.
  const [updatedAt, setUpdatedAt] = useState(null);
  // Bumped on every silent leagues refresh so ActionQueue reloads with the leagues.
  const [refreshKey, setRefreshKey] = useState(0);
  // The latest scheduled lock that has fired, remembered because the status stops naming a lock once it passes.
  const [firedLock, setFiredLock] = useState(null);
  // When the last leagues read succeeded, for the tab-shown staleness check.
  const loadedAt = useRef(0);

  // Create League stepper: its answers and request live in CreateLeagueStepper.
  const [openCreateDialog, setOpenCreateDialog] = useState(false);
  // Each dialog mounts on its first open and then stays mounted, so closing the
  // stepper mid-way keeps its answers.
  const [createOpened, setCreateOpened] = useState(false);
  const [joinOpened, setJoinOpened] = useState(false);

  // The action items body ActionQueue read, lifted for the greeting's
  // summary line (one request, not two). Null until it loads and on error.
  const [actionItems, setActionItems] = useState(null);
  // The plays the cards show, and the clock ActionQueue built them at: the
  // greeting counts these, so it and the badge cannot drift apart.
  const [playsAt, setPlaysAt] = useState(null);
  const handlePlaysChange = useCallback((plays, now) => setPlaysAt({ plays, now }), []);

  // Join League dialog — leagues are private, so joining is always by invite
  // code. The dialog owns its answers, preview and in-flight state.
  const [openJoinDialog, setOpenJoinDialog] = useState(false);

  // Shared with the Nav bell (ADR 0004, ADR 0059's #2097 amendment): mounted
  // together (a hard load) one request serves both, and the bell's poll reloads
  // this frame too. Skeletons and the error stand in only for a list we don't
  // have; a poll that is loading or has failed keeps the good list on screen.
  const {
    notifications,
    loaded: haveNews,
    loading: loadingNews,
    error: newsFailure,
    refetch: refetchNews,
  } = useNotifications();
  // The feed is newest first, so the first of a repeated (message, league) pair is the newest.
  const seenNews = new Set();
  const newsItems = notifications
    .filter((item) => {
      const key = JSON.stringify([item.message, item.league_name]);
      return !seenNews.has(key) && seenNews.add(key);
    })
    .slice(0, NEWS_MAX);
  // First run: the leagues read succeeded and found none. Not while loading (no
  // flash of the first-run state) and not after a failed read.
  const firstRun = !loadingLeagues && !leaguesError && myLeagues.length === 0;
  const featured = featuredDraft(myLeagues);
  const nextDraft = featured?.league ?? null;
  const featuredState = featured?.state ?? null;
  const currentWeek = sharedCurrentWeek(myLeagues);
  const liveMatchups = liveMatchupCount(myLeagues);
  // Game day: the play frame and live scores only; League news and Columns wait.
  const gameDay = liveMatchups > 0 || pickemLive(myLeagues);
  // Recomputed on every render: each load, and each scheduled lock tick, re-renders.
  const nowMs = Date.now();
  const kickoffWindowOpen = [...upcomingLocks(myLeagues), firedLock]
    .some((at) => at !== null && at <= nowMs && nowMs - at <= KICKOFF_WINDOW_MS);
  // A drafting league also polls, so the slot and the clock do not go stale.
  const drafting = myLeagues.some((l) => deriveLeaguePhase(l) === LEAGUE_PHASE.DRAFTING);
  const polling = gameDay || kickoffWindowOpen || drafting;

  const fetchMyLeagues = async () => {
    try {
      setLoadingLeagues(true);
      setMyLeagues(await requestLeagues());
      setLeaguesError(null);
      loadedAt.current = Date.now();
      setUpdatedAt(new Date());
    } catch (err) {
      // Keep the last good list (if any) on screen under the error. Only a
      // sentence the server sent is shown; transport text never is.
      setLeaguesError(readHttpFailure(err).message || LEAGUES_FAILED_BODY);
    } finally {
      setLoadingLeagues(false);
    }
  };

  // The background refetch (draft night, game day): it never touches the
  // loading or error state, so a failed tick leaves the page as it was and the
  // next tick retries.
  const refreshLeagues = async () => {
    setRefreshKey((n) => n + 1);
    try {
      setMyLeagues(await requestLeagues());
      setLeaguesError(null);
      loadedAt.current = Date.now();
      setUpdatedAt(new Date());
    } catch (err) {
      // Intentionally silent.
    }
  };

  useEffect(() => {
    fetchMyLeagues();
  }, []);

  // Game day (spec #2315, ruling 5): the leagues list and the Plays reload
  // every minute while a matchup is live (or in the kickoff window after a
  // lock, before the server calls it live, or while a league is drafting) and
  // the tab is visible.
  useLiveRefresh({ active: polling, onTick: refreshLeagues });

  // Before kickoff (spec #2315): the leagues list is read once, so a page opened
  // before a matchup starts would never learn it is live. One silent refresh is
  // scheduled at the earliest lock the leagues carry that is newer than the last
  // load (so a refresh that failed is retried), at least 30 s out; each load or
  // attempt re-arms it. Once a matchup is live the 60 s poll takes over.
  useEffect(() => {
    if (gameDay || !updatedAt) return undefined;
    const since = loadedAt.current;
    const next = Math.min(Infinity, ...upcomingLocks(myLeagues).filter((at) => at > since));
    if (!Number.isFinite(next)) return undefined;
    const id = setTimeout(() => {
      // A timer clamped for a far-off lock fires early: only a lock that is due starts the window.
      if (next <= Date.now() + 1000) setFiredLock(Math.min(next, Date.now()));
      refreshLeagues();
    }, Math.min(Math.max(next - Date.now(), MIN_KICKOFF_WAIT_MS), 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [gameDay, myLeagues, updatedAt, refreshKey]);

  // One visibility handler for the page while it is not polling (useLiveRefresh
  // owns the event otherwise, so one event never refetches twice): a tab shown
  // again refreshes when the last successful load is over a minute old.
  useEffect(() => {
    if (polling) return undefined;
    const onVisible = () => {
      if (!document.hidden && Date.now() - loadedAt.current > STALE_AFTER_MS) refreshLeagues();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [polling]);

  // Draft night: the card is only as fresh as the leagues list. When a
  // scheduled draft's countdown runs out the card refetches once, just after
  // (the server has auto-started it, or it is now late); a late one refetches
  // every 30 seconds (2 minutes once auto-start failed) until it goes live. A
  // live draft has no timer of its own: the drafting poll keeps it fresh. All
  // of these are background refetches: no
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
    const poll = setInterval(() => { if (!document.hidden) refreshLeagues(); }, featuredFailed ? FAILED_POLL_MS : LATE_POLL_MS);
    return () => clearInterval(poll);
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

  const joinCreate = (
    <Box
      sx={isDesktop
        ? { display: 'flex', gap: '12px' }
        : {
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px', '& > *': { width: '100%' },
        }}
    >
      <PsButton variant="ghost" onClick={handleOpenJoinDialog}>Join a league</PsButton>
      <PsButton variant="ghost" onClick={handleOpenCreateDialog}>Create a league</PsButton>
    </Box>
  );

  return (
    // Home is on Play-select (DESIGN.md "Play-select: Home and league pages"): homeTheme
    // sets every Typography, button and input in Archivo, and the root paints
    // the home token context. Nav and Footer stay on the app tokens.
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
        className="ps-root"
        tabIndex={-1}
        aria-labelledby="user-page-heading"
        sx={{
          ...psRootSx, display: 'flex', flexDirection: 'column', flexGrow: 1, mt: `-${NAV_GAP}`, mb: `-${FOOTER_GAP}`,
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: '1240px',
            mx: 'auto',
            boxSizing: 'border-box',
            p: { xs: `calc(24px + ${NAV_GAP}) 16px 48px`, md: `calc(40px + ${NAV_GAP}) 32px 64px` },
            display: 'flex',
            flexDirection: 'column',
            gap: { xs: '28px', md: '40px' },
          }}
        >
          {firstRun ? (
            <>
              <FirstRunIntro username={user.username} />
              <StartHere onCreate={handleOpenCreateDialog} onJoin={handleOpenJoinDialog} />
              <Suspense fallback={null}>
                <PublicHighlights />
              </Suspense>
            </>
          ) : (
            <>
              <GreetingHeader
                username={user.username}
                week={currentWeek}
                summary={actionItems && playsAt ? greetingSummary(actionItems, playsAt.plays, playsAt.now) : null}
                liveCount={liveMatchups}
                actions={isDesktop ? joinCreate : null}
              />
              <ActionQueue
                onLoaded={setActionItems}
                onPlaysChange={handlePlaysChange}
                leagues={myLeagues}
                refreshKey={refreshKey}
                onDraftExpire={handleDraftExpire}
              />
              <LeagueCards
                leagues={myLeagues}
                loading={loadingLeagues}
                error={leaguesError}
                onRetry={fetchMyLeagues}
                live={gameDay}
                updatedAt={updatedAt}
              />
              {!gameDay && (
                <LeagueNews
                  items={newsItems}
                  awaiting={loadingNews && !haveNews}
                  error={Boolean(newsFailure) && !haveNews}
                  onRetry={refetchNews}
                />
              )}
              <Suspense fallback={null}>
                <PublicHighlights />
              </Suspense>
              <AlertPrompt leagues={myLeagues} />
              {!isDesktop && joinCreate}
            </>
          )}

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
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default UserPage;
