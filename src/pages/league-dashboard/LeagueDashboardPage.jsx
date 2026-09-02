import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Badge as MuiBadge,
  Box,
  Container,
  Drawer,
  Fab,
  IconButton,
  Typography,
} from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import { useLeague } from '../../hooks/useLeague';
import { Badge, Skeleton } from '../../shared/ui';
import CopyInvite from '../../features/copy-invite';
import MyTeamSummary from '../../widgets/my-team-summary';
import MatchupPreview from '../../widgets/matchup-preview';
import StandingsTable from '../../widgets/standings-table';
import DraftGrades from '../../widgets/draft-grades';
import CommissionerPanel from '../../widgets/commissioner-panel';
import QuickActions from '../../widgets/quick-actions';
import ChatPanel from '../../components/ChatPanel/ChatPanel';
import RecapCard from '../../components/RecapCard/RecapCard';
import TrophyCase from '../../components/TrophyCase/TrophyCase';
import PickemStandings from '../../components/LeaguePickem/PickemStandings';
import Countdown from '../../components/Countdown/Countdown';
import {
  applyTeamProfileUpdate,
  subscribeToTeamProfileUpdates,
} from '../../lib/teamProfileEvents';
import {
  deriveLeaguePhase,
  isSeasonLive,
  LEAGUE_PHASE,
  LEAGUE_PHASE_META,
} from '../../lib/leaguePhase';
import { isPickemOnly } from '../../lib/leagueType';

/**
 * League Dashboard page slice (ADR 0020), on the `/league/:leagueId` route since
 * the cutover ticket (#645). The header (name + phase/team/draft chips and, for
 * a commissioner, the copy-invite control) sits above the widget slices; the
 * legacy monolith it replaces is deleted.
 *
 * Fantasy vs pick'em-only composition. A fantasy league fills the hero
 * (my-team + matchup) and main grid (standings + a rail of draft-grades and the
 * commissioner panel), and shows the weekly recap and the pre-draft countdown.
 * A pick'em-only league has no fantasy team, matchups or draft, so none of
 * those slices mount (each would fire a fantasy read that returns an empty or
 * zeroed table): its body is the pick'em standings, and the quick-actions
 * widget trims itself to the pick'em surfaces. Quick actions, the trophy case
 * and league chat are common to both. The recap and the pre-draft countdown are
 * fantasy-only (gated on isPickemOnly, matching the legacy page); the trophy
 * case is NOT, because trophy.service awards a pickem_champion type with no type
 * filter on the league read and TrophyCase renders it, so a completed pick'em
 * season has a populated case (the legacy page mounted it unconditionally too).
 *
 * The page reads the league through the shared cache (useLeague / ADR 0004), so
 * a subpage reached from here reuses the same payload. Everything phase-shaped
 * in the header derives from the client League-phase helper
 * (src/lib/leaguePhase.js), never from a stored status field: that keeps a
 * single source of phase truth across the widget slices.
 *
 * Team identity is live: a team-profile update (a rename or new avatar
 * published by another manager's session) is written through into the cached
 * league's teams[], so the standings rows, draft-grades rows and my-team card
 * re-render without a second league GET. teamName is the canonical display
 * field the widgets read (teamIdentity.js), not the raw `name` column the route
 * leaks beside it, so the write-through targets teamName; the avatar rides the
 * snake_case columns the league-detail route serializes.
 *
 * The page paints the dashboard island's own token context (`dash-bg` /
 * `dash-ink`, the display/body faces): every ink-on-surface pairing it puts on
 * screen (h1 and neutral chips over `dash-bg`, the live chip's accent-on-tint
 * over `dash-bg`) is a registered pairing in tokens.contrast.test.js. Painting
 * a different backdrop under the tinted live chip would compose an unmeasured
 * pairing, so the island background is deliberate, not decorative.
 */
export default function LeagueDashboardPage() {
  const { leagueId } = useParams();
  const { league, teams, loading, error, updateTeams } = useLeague(leagueId);

  // Live team identity: patch a rename or new avatar into the shared league
  // membership so every consumer reading teams[] reflects it with no request.
  // Deleting this subscription pins a renamed or re-avatared Team to its stale
  // name/picture until the 60s league-cache TTL lapses and a navigation
  // refetches. Matched on teamId. BOTH name columns are patched: the widget
  // slices read the canonical `teamName`, but CommissionerTools composes as-is
  // off the same teams[] and renders the raw `name` column (menu items, the
  // removable-teams list, the remove dialog), so patching only teamName would
  // leave a rename stale in the commissioner panel where the legacy page kept
  // it live. The avatar rides the snake_case columns the widgets read.
  useEffect(
    () =>
      subscribeToTeamProfileUpdates((update) => {
        if (Number(update.leagueId) !== Number(leagueId)) return;
        updateTeams((prev) =>
          prev.map((team) => {
            const withRawName = applyTeamProfileUpdate(team, update, {
              id: 'teamId',
              avatarUrl: 'avatar_url',
              avatarStaticUrl: 'avatar_static_url',
            });
            return applyTeamProfileUpdate(withRawName, update, {
              id: 'teamId',
              name: 'teamName',
              avatarUrl: 'avatar_url',
              avatarStaticUrl: 'avatar_static_url',
            });
          })
        );
      }),
    [leagueId, updateTeams]
  );

  // First load blanks the page; once the league is on screen a background
  // reload keeps it mounted (the shared cache serves the row it already has).
  if (!league && loading) {
    return (
      <DashboardShell>
        {/* This region owns the league read (Skeleton.jsx: the shapes stay
            aria-hidden, the owning region announces the loading state), so it
            carries aria-busy while that read is in flight. A literal "true" is
            correct here, not a computed value that toggles to "false": this
            whole branch is gated on `!league && loading` and unmounts the
            moment the league resolves, so there is no in-DOM transition to
            "false" for a screen reader to ever observe. */}
        <Box
          data-testid="dashboard-loading"
          aria-busy="true"
          sx={{ display: 'grid', gap: '16px' }}
        >
          <Skeleton variant="text" width={260} height={44} />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Skeleton variant="rounded" width={150} height={26} />
            <Skeleton variant="rounded" width={90} height={26} />
            <Skeleton variant="rounded" width={120} height={26} />
          </Box>
        </Box>
      </DashboardShell>
    );
  }

  if (!league) {
    return (
      <DashboardShell>
        <Typography role="alert" sx={{ color: 'var(--dash-ink)' }}>
          {error || 'League not available'}
        </Typography>
      </DashboardShell>
    );
  }

  const phase = deriveLeaguePhase(league);
  const phaseLabel = LEAGUE_PHASE_META[phase]?.label ?? '';
  const pickemOnly = isPickemOnly(league);
  const preDraft = phase === LEAGUE_PHASE.PRE_DRAFT;
  const seasonLive = isSeasonLive(league);
  const week = league.current_week;
  // "Week N · <phase label>" while the season is being played (the live/accent
  // chip); the bare phase label otherwise (pre-draft, drafting, complete).
  const phaseChipLabel =
    seasonLive && week != null ? `Week ${week} · ${phaseLabel}` : phaseLabel;
  // The draft is done for a fantasy league in every phase past drafting. Read
  // from the helper's phase, not the raw draft_status column, so the page keeps
  // no second source of phase truth. A pick'em-only league has no draft.
  const draftComplete =
    !pickemOnly && phase !== LEAGUE_PHASE.PRE_DRAFT && phase !== LEAGUE_PHASE.DRAFTING;

  return (
    <DashboardShell>
      {/* A plain layout row, not a <header>: a top-level <header> maps to the
          `banner` landmark, and the app shell's global app bar (Nav) already
          owns that role, so this must not add a second banner at cutover. The
          h1 below carries the heading structure. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 1.75,
          flexWrap: 'wrap',
        }}
      >
        <Typography
          component="h1"
          sx={{
            m: 0,
            fontFamily: 'var(--dash-font-display)',
            fontSize: { xs: '28px', sm: '34px' },
            fontWeight: 700,
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
            color: 'var(--dash-ink)',
          }}
        >
          {league.name}
        </Typography>

        <Box component="span" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {phaseChipLabel && (
            <Badge variant={seasonLive ? 'live' : 'neutral'}>{phaseChipLabel}</Badge>
          )}
          <Badge variant="neutral">{`${teams.length} Teams`}</Badge>
          {draftComplete && <Badge variant="neutral">Draft Complete</Badge>}
        </Box>

        {/* Commissioner-only, gated purely on the invite code the server sends
            only to commissioners. It lives in the page header, not the global
            app bar. */}
        {league.invite_code && (
          <Box sx={{ ml: { sm: 'auto' } }}>
            <CopyInvite code={league.invite_code} />
          </Box>
        )}
      </Box>

      {/* Weekly recap: matchup-derived, so fantasy-only, gated on the same
          isPickemOnly the legacy page used. Self-hides on a 404 (no recap
          generated yet); a pick'em league never requests it. */}
      {!pickemOnly && (
        <Box component="section" data-testid="slot-recap">
          <RecapCard leagueId={leagueId} />
        </Box>
      )}

      {pickemOnly ? (
        /* PICK'EM-ONLY body. A pick'em league has no fantasy team, matchups or
           draft, so the hero and main-grid slices never mount: each of them
           (my-team, matchup, standings table, draft grades) fires a fantasy
           read that would come back an empty or zeroed table. The pool
           standings stand in their place. */
        <Box component="section" data-testid="dashboard-pickem-standings">
          <PickemStandings leagueId={leagueId} season={league.current_season} />
        </Box>
      ) : (
        <>
          {/* Pre-draft countdown to the scheduled draft, composed as-is from the
              legacy page: fantasy-only, only before the draft, and only once a
              draft_date is set. Carries the timezone, leagueId and leagueName so
              it can render the viewer-local schedule and the add-to-calendar
              control. */}
          {preDraft && league.draft_date && (
            <Box component="section" data-testid="slot-draft-countdown">
              <Countdown
                variant="full"
                date={league.draft_date}
                timeZone={league.draft_timezone}
                leagueId={league.id}
                leagueName={league.name}
              />
            </Box>
          )}

          {/* HERO: my-team beside matchup preview. Nameless <section> layout
              containers, deliberately NOT labelled landmarks: an empty labelled
              region is announced with nothing in it (noise). The real landmarks
              are the titled Cards the widgets render, each a labelled region via
              shared/ui Card. Collapses to one column at tablet width. */}
          <Box
            component="section"
            data-testid="dashboard-hero"
            sx={{
              display: 'grid',
              gap: '22px',
              gridTemplateColumns: { xs: '1fr', md: '5fr 7fr' },
            }}
          >
            <Box data-testid="slot-my-team">
              <MyTeamSummary leagueId={leagueId} />
            </Box>
            <Box data-testid="slot-matchup-preview">
              <MatchupPreview leagueId={leagueId} />
            </Box>
          </Box>

          {/* MAIN: standings beside a rail (same nameless-container reasoning as
              the hero). Collapses to one column at tablet width. */}
          <Box
            component="section"
            data-testid="dashboard-main"
            sx={{
              display: 'grid',
              gap: '22px',
              gridTemplateColumns: { xs: '1fr', md: '8fr 4fr' },
              alignItems: 'start',
            }}
          >
            <Box data-testid="slot-standings">
              <StandingsTable leagueId={leagueId} />
            </Box>
            <Box
              data-testid="dashboard-rail"
              sx={{ display: 'grid', gap: '22px' }}
            >
              {/* Rail top: draft grades. The commissioner panel composes below
                  it in this same rail. */}
              <Box data-testid="slot-draft-grades">
                <DraftGrades leagueId={leagueId} />
              </Box>
              {/* Rail: commissioner panel (#644). Renders nothing for a member;
                  a commissioner sees the advance-week control and the legacy
                  league administration behind a disclosure. */}
              <Box data-testid="slot-commissioner-panel">
                <CommissionerPanel leagueId={leagueId} />
              </Box>
            </Box>
          </Box>
        </>
      )}

      {/* QUICK ACTIONS: the full-width grouped action cards below the body. The
          widget trims itself to the pick'em surfaces in a pick'em league. */}
      <Box
        component="section"
        data-testid="dashboard-quick-actions"
      >
        <QuickActions leagueId={leagueId} />
      </Box>

      {/* Commissioner panel for a pick'em league (a fantasy league mounts it in
          the main-grid rail above instead, so this branch and that one are
          mutually exclusive). Renders nothing for a member; the advance-week
          control is absent in a pick'em league by the widget's own design. */}
      {pickemOnly && (
        <Box component="section" data-testid="slot-commissioner-panel">
          <CommissionerPanel leagueId={leagueId} />
        </Box>
      )}

      {/* Trophy case: common to both league kinds, as the legacy page mounted
          it (outside its !pickemOnly guard). A pick'em-only league earns a
          pickem_champion trophy on a completed season (trophy.service.js), and
          the league trophy read applies no type filter, so its case is
          populated; gating it on fantasy would drop that. It self-hides on an
          empty list, so a league with no trophies renders nothing regardless. */}
      <Box component="section" data-testid="slot-trophy-case">
        <TrophyCase leagueId={leagueId} />
      </Box>

      {/* League chat: every member, in a drawer opened by a floating button that
          carries the unread badge. */}
      <LeagueChatDrawer leagueId={leagueId} />
    </DashboardShell>
  );
}

/**
 * The floating chat launcher and its drawer, composed as-is from the legacy
 * ChatPanel. The panel stays mounted inside the persistent drawer even while it
 * is closed, so it owns the unread count and reports it up through
 * onUnreadChange; the button's accessible name carries that count so a
 * screen-reader user hears it without opening the drawer. Every league member
 * has chat, fantasy or pick'em alike.
 */
function LeagueChatDrawer({ leagueId }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);

  return (
    <>
      <Fab
        color="primary"
        onClick={() => setChatOpen(true)}
        sx={{ position: 'fixed', bottom: 24, right: 24 }}
        aria-label={
          chatUnread > 0
            ? `Open league chat, ${chatUnread} unread message${chatUnread === 1 ? '' : 's'}`
            : 'Open league chat'
        }
      >
        <MuiBadge badgeContent={chatUnread} color="error" max={99} overlap="circular">
          <ChatBubbleOutlineIcon />
        </MuiBadge>
      </Fab>
      <Drawer
        anchor="right"
        variant="persistent"
        open={chatOpen}
        sx={{
          '& .MuiDrawer-paper': {
            width: { xs: '100vw', sm: 380 },
            boxSizing: 'border-box',
          },
        }}
      >
        <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton onClick={() => setChatOpen(false)} aria-label="Close chat">
              <CloseIcon />
            </IconButton>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', px: 1 }}>
            <ChatPanel leagueId={leagueId} open={chatOpen} onUnreadChange={setChatUnread} />
          </Box>
        </Box>
      </Drawer>
    </>
  );
}

/**
 * The dashboard island's page frame: the `dash-*` token context (background,
 * ink, body face) plus the stacking gap between the header and the two grid
 * regions. Every state (loading, error, loaded) renders inside it so the island
 * background is constant.
 */
function DashboardShell({ children }) {
  return (
    <Box
      sx={{
        backgroundColor: 'var(--dash-bg)',
        color: 'var(--dash-ink)',
        fontFamily: 'var(--dash-font-body)',
        minHeight: '100%',
      }}
    >
      <Container
        maxWidth="lg"
        sx={{
          py: { xs: 2.5, sm: 3.5 },
          display: 'grid',
          gap: '22px',
        }}
      >
        {children}
      </Container>
    </Box>
  );
}
