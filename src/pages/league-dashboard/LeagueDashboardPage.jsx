import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Badge as MuiBadge,
  Box,
  Button,
  Container,
  Drawer,
  Fab,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import CloseIcon from '@mui/icons-material/Close';
import { useLeague } from '../../hooks/useLeague';
import { Badge, Card, Skeleton } from '../../shared/ui';
import CopyInvite from '../../features/copy-invite';
import MyTeamSummary from '../../widgets/my-team-summary';
import MatchupPreview from '../../widgets/matchup-preview';
import StandingsTable from '../../widgets/standings-table';
import DraftGrades from '../../widgets/draft-grades';
import CommissionerStrip from '../../widgets/commissioner-strip';
import AroundTheLeague from '../../widgets/around-the-league';
import RecentActivity from '../../widgets/recent-activity';
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
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

// The page h1, shared by the league name and the failed-read heading so both
// states put the same type in the same place.
const H1_SX = {
  m: 0,
  fontFamily: 'var(--dash-font-display)',
  fontSize: { xs: '28px', sm: '34px' },
  fontWeight: 700,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color: 'var(--dash-ink)',
};

// Several widgets on this page render null (a member's commissioner strip, a
// league with no recap, an empty trophy case), and a wrapper that outlives its
// content still takes a turn in the shell's 22px stack: four blank bands at
// phone width came from exactly that. `:empty` matches a wrapper whose child
// rendered nothing, so the gap it would have bought collapses with it.
const EMPTY_HIDDEN_SX = { '&:empty': { display: 'none' } };

/**
 * League Dashboard page slice (ADR 0020), on the `/league/:leagueId` route since
 * the cutover ticket (#645). The header (name + phase/team/draft chips and, for
 * a commissioner, the copy-invite control) sits above the widget slices; the
 * legacy monolith it replaces is deleted.
 *
 * v2 composition (ADR 0034, #1110): the commissioner strip sits directly under
 * the header at every width (`slot-commissioner-strip`) and replaces the old
 * three-branch commissioner rail card; the retired administration-panel
 * widget is deleted in this same PR. A fantasy league fills the hero (my-team
 * + matchup, `align-items: stretch` so the two cards share the row height), a
 * full-width Around the League strip, and the main grid (standings + a rail
 * holding Draft Grades only) followed by a second grid row of the same tracks
 * (Quick Actions in the wide track, Recent activity in the rail track), and
 * shows the weekly recap and the pre-draft countdown. A pick'em-only league
 * has no fantasy team, matchups or draft, so none of those slices mount
 * (each would fire a fantasy
 * read that returns an empty or zeroed table): its body is the pick'em
 * standings, and Quick Actions renders full width on its own (the widget trims
 * itself to the pick'em surfaces; Recent activity does not mount at all, since
 * the activity log is a fantasy surface). The trophy case and league chat are
 * common to both. The recap and the pre-draft countdown are fantasy-only
 * (gated on isPickemOnly, matching the legacy page); the trophy case is NOT,
 * because trophy.service awards a pickem_champion type with no type filter on
 * the league read and TrophyCase renders it, so a completed pick'em season has
 * a populated case (the legacy page mounted it unconditionally too).
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
  const { league, teams, viewerTeamId, loading, refetch, updateTeams } = useLeague(leagueId);

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

  // A failed league read is a dead end for the whole route, so it gets the same
  // h1 the loaded page has, one alerted sentence and a way out, rather than a
  // bare line of error text with nothing to do next. The sentence is fixed and
  // the server's string is deliberately not on screen: useResource collapses
  // the server's `error` field and the transport's own `err.message` into one
  // value (useResource.js:62), so keeping "the server's message" would also put
  // an axios internal ("Network Error") in front of a manager. `refetch`
  // invalidates the shared league key, so every mount on this league reloads
  // from the one request it starts.
  if (!league) {
    return (
      <DashboardShell>
        <Box sx={{ display: 'grid', gap: 1.75, justifyItems: 'start' }}>
          <Typography component="h1" sx={H1_SX}>
            League unavailable
          </Typography>
          <Typography role="alert" sx={{ fontSize: '14px', color: 'var(--dash-ink)' }}>
            We could not load this league right now.
          </Typography>
          <Button
            type="button"
            variant="outlined"
            onClick={() => refetch()}
            sx={{
              ...MIN_TOUCH_TARGET_SX,
              textTransform: 'none',
              color: 'var(--dash-ink)',
              borderColor: 'var(--dash-line-strong)',
              borderRadius: 'var(--dash-radius-sm)',
              fontFamily: 'var(--dash-font-body)',
              fontWeight: 600,
              fontSize: '13px',
              '&:hover': {
                borderColor: 'var(--dash-accent-line)',
                backgroundColor: 'transparent',
              },
            }}
          >
            Try again
          </Button>
        </Box>
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
        <Typography component="h1" sx={H1_SX}>
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

      {/* COMMISSIONER STRIP, directly under the header at every width (ADR
          0034 / #1108, #1110). Replaces the retired three-branch
          administration rail card: one mount, one place, no width-crossing
          remount and no disclosure to leave out of sync. Renders nothing for a
          member (CommissionerStrip's own gate); the wrapper collapses. */}
      <Box component="section" data-testid="slot-commissioner-strip" sx={EMPTY_HIDDEN_SX}>
        <CommissionerStrip leagueId={leagueId} />
      </Box>

      {/* Weekly recap: matchup-derived, so fantasy-only, gated on the same
          isPickemOnly the legacy page used. Self-hides on a 404 (no recap
          generated yet); a pick'em league never requests it. */}
      {!pickemOnly && (
        <Box component="section" data-testid="slot-recap" sx={EMPTY_HIDDEN_SX}>
          <RecapCard leagueId={leagueId} />
        </Box>
      )}

      {pickemOnly ? (
        /* PICK'EM-ONLY body. A pick'em league has no fantasy team, matchups or
           draft, so the hero and main-grid slices never mount: each of them
           (my-team, matchup, standings table, draft grades) fires a fantasy
           read that would come back an empty or zeroed table. The pool
           standings stand in their place, in a titled Card: this is the primary
           content of a pick'em league, and as a bare section it was a nameless
           region with no heading between the h1 and the quick-actions h2. */
        <Card data-testid="dashboard-pickem-standings" title="Pick'em Standings">
          <PickemStandings leagueId={leagueId} season={league.current_season} />
        </Card>
      ) : (
        <>
          {/* Pre-draft countdown to the scheduled draft, composed as-is from the
              legacy page: fantasy-only, only before the draft, and only once a
              draft_date is set. Carries the timezone, leagueId and leagueName so
              it can render the viewer-local schedule and the add-to-calendar
              control. The Card is what names it: on a pre-draft league this is
              the first block under the h1, and unwrapped it was an unlabelled
              section whose only text was a ticker. */}
          {preDraft && league.draft_date && (
            <Card data-testid="slot-draft-countdown" title="Draft Day">
              <Box sx={{ px: 2.25, py: 2.25 }}>
                <Countdown
                  variant="full"
                  date={league.draft_date}
                  timeZone={league.draft_timezone}
                  leagueId={league.id}
                  leagueName={league.name}
                />
              </Box>
            </Card>
          )}

          {/* HERO: my-team beside matchup preview. Nameless <section> layout
              containers, deliberately NOT labelled landmarks: an empty labelled
              region is announced with nothing in it (noise). The real landmarks
              are the titled Cards the widgets render, each a labelled region via
              shared/ui Card. Collapses to one column at tablet width.

              A viewer with no Team of their own (a commissioner who never
              joined) gets neither the left slot nor the track it sat in:
              MyTeamSummary already returns null for them, and leaving the
              5fr track in place bought 5/12 of the hero as bare `dash-bg`
              beside a lone matchup card. viewerTeamId is the per-viewer field
              that answers it (#112), not a scan of teams[].

              `alignItems: 'stretch'` (#1110) makes My Team and the matchup
              card share the row height, matching the canvas. Each slot Box is
              ALSO its own single-item grid (`display: 'grid'`, no template of
              its own): a stretched CSS Grid item's used height is definite,
              but that does not cascade to a plain block descendant with
              `height: auto`, which is exactly my-team-summary's and
              matchup-preview's own root Card - so each slot re-stretches its
              one child through a second grid, rather than leaving a card that
              stretches its wrapper but not itself. my-team-summary's own Card
              additionally sets `height: '100%'` to consume this (see its own
              docblock); matchup-preview's does not need to, since an
              unset/auto height IS the height a grid item stretches by
              default - this slot Box is the only change either widget needed. */}
          <Box
            component="section"
            data-testid="dashboard-hero"
            sx={{
              display: 'grid',
              gap: '22px',
              alignItems: 'stretch',
              gridTemplateColumns: {
                xs: '1fr',
                md: viewerTeamId == null ? '1fr' : '5fr 7fr',
              },
            }}
          >
            {viewerTeamId != null && (
              <Box data-testid="slot-my-team" sx={{ display: 'grid', ...EMPTY_HIDDEN_SX }}>
                <MyTeamSummary leagueId={leagueId} />
              </Box>
            )}
            <Box data-testid="slot-matchup-preview" sx={{ display: 'grid' }}>
              <MatchupPreview leagueId={leagueId} />
            </Box>
          </Box>

          {/* AROUND THE LEAGUE: full-width strip of the week's matchup tiles,
              between the hero and the main grid (#1103, #1110). Fantasy only,
              which this placement already guarantees (it sits inside the
              `!pickemOnly` branch); the widget also self-hides for a
              pick'em-only league and on an empty current week, so the wrapper
              collapses either way.

              `minWidth: 0` and `contain: 'paint'` (measured in Chromium at
              320px, #1110: `minWidth: 0` is the same #916/#917/#919/#921 rule
              `slot-standings` below already carries, for the same reason -
              without it this box itself floors at its content's min-content
              width instead of the column's). Below `md` the widget's own
              scroller (`around-the-league-body`) holds six tiles at a fixed
              `flex: 0 0 200px` and scrolls internally (`overflowX: 'auto'`),
              which already clips what a REAL viewer sees and can reach - but
              a scrolled-past tile's own `getBoundingClientRect()` still
              reports its full, un-clipped layout position, and measured in
              Chromium that position alone was enough to widen
              `document.documentElement.scrollWidth` to 609px at a 320px
              viewport, even though `document.body`'s OWN scrollWidth measured
              a clean 320px and nothing was visually broken - a `<html>`
              vs `<body>` scrollWidth disagreement specific to a `display:
              flex` scroll container's ink overflow, which plain `overflow:
              hidden`/`clip` on this box did NOT close (tried and measured;
              still 609). `contain: 'paint'` does (measured 320): per the CSS
              Containment spec it guarantees nothing paints outside this box's
              border box, which is exactly the guarantee `document.
              documentElement.scrollWidth`'s own computation needs here. The
              same property also makes this box the containing block for any
              absolutely or fixed positioned descendant (there is none inside
              AroundTheLeague today - checked - but a future tooltip, popover
              or menu inside it would position against THIS box rather than
              the page, which is worth knowing before adding one). */}
          <Box
            component="section"
            data-testid="slot-around-the-league"
            sx={{ minWidth: 0, contain: 'paint', ...EMPTY_HIDDEN_SX }}
          >
            <AroundTheLeague leagueId={leagueId} />
          </Box>

          {/* MAIN: standings beside a rail holding Draft Grades only (same
              nameless-container reasoning as the hero). Collapses to one
              column at tablet width.

              The zero minimum is on the standings track only. A bare `1fr` or
              `8fr` track still floors at its item's min-content width, which is
              how a wide table dragged the whole document past the viewport. The
              rail track keeps its automatic minimum: Draft Grades is a table
              in its own horizontal scroller, so shrinking the track scrolls it
              rather than clipping anything (the #916/#917/#919/#921 rule). */}
          <Box
            component="section"
            data-testid="dashboard-main"
            sx={{
              display: 'grid',
              gap: '22px',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 8fr) 4fr' },
              alignItems: 'start',
            }}
          >
            {/* The zero minimum is paired with a clip on this same box (the
                #916/#917/#919/#921 rule): the only thing inside wide enough to
                reach it is the standings table, which lives in its own
                horizontal scroller, so the clip is a backstop and never the
                mechanism. `clip` rather than `hidden` or `auto` because those
                make this box a scroll container, which would capture the
                table's sticky header away from the viewport. */}
            <Box data-testid="slot-standings" sx={{ minWidth: 0, overflowX: 'clip' }}>
              <StandingsTable leagueId={leagueId} />
            </Box>
            {/* The rail is short and the standings are long, so above md the
                rail rides down with the scroll instead of leaving a column of
                bare page beside row 8. `top: 22px` and not an app-bar offset:
                Nav.jsx:95 is position="static", so nothing is pinned above it.
                Draft Grades only now (#1110): the commissioner panel that used
                to compose below it here moved to the strip under the header. */}
            <Box
              data-testid="dashboard-rail"
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr)',
                gap: '22px',
                position: { md: 'sticky' },
                top: { md: '22px' },
              }}
            >
              <Box data-testid="slot-draft-grades">
                <DraftGrades leagueId={leagueId} />
              </Box>
            </Box>
          </Box>

          {/* SECOND ROW (#1110): the same two tracks as the main grid, Quick
              Actions in the wide track and Recent activity in the rail track.
              Recent activity is fantasy-only (the activity log is a fantasy
              surface); this placement already guarantees that, being inside
              the `!pickemOnly` branch, so no further gate is needed here. */}
          <Box
            component="section"
            data-testid="dashboard-second-row"
            sx={{
              display: 'grid',
              gap: '22px',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 8fr) 4fr' },
            }}
          >
            <Box data-testid="dashboard-quick-actions" sx={EMPTY_HIDDEN_SX}>
              <QuickActions leagueId={leagueId} />
            </Box>
            <Box data-testid="slot-recent-activity">
              <RecentActivity leagueId={leagueId} />
            </Box>
          </Box>
        </>
      )}

      {/* QUICK ACTIONS, pick'em-only: full width, on its own (a fantasy league
          composes it in the second grid row above instead, alongside Recent
          activity; the two are mutually exclusive with pickemOnly). The
          widget trims itself to the pick'em surfaces. */}
      {pickemOnly && (
        <Box
          component="section"
          data-testid="dashboard-quick-actions"
          sx={EMPTY_HIDDEN_SX}
        >
          <QuickActions leagueId={leagueId} />
        </Box>
      )}

      {/* Trophy case: common to both league kinds, as the legacy page mounted
          it (outside its !pickemOnly guard). A pick'em-only league earns a
          pickem_champion trophy on a completed season (trophy.service.js), and
          the league trophy read applies no type filter, so its case is
          populated; gating it on fantasy would drop that. It self-hides on an
          empty list, so a league with no trophies renders nothing regardless. */}
      <Box component="section" data-testid="slot-trophy-case" sx={EMPTY_HIDDEN_SX}>
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
 * ChatPanel. The panel stays mounted inside the drawer even while it is closed
 * (docked above sm, keepMounted below it), so it owns the unread count and
 * reports it up through onUnreadChange; the button's accessible name carries
 * that count so a screen-reader user hears it without opening the drawer. Every
 * league member has chat, fantasy or pick'em alike.
 */
function LeagueChatDrawer({ leagueId }) {
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const theme = useTheme();
  // Below sm the drawer paper is the whole viewport, so it has to behave like
  // one: `temporary` is the only variant that renders a Modal, and the Modal is
  // what supplies the backdrop, the focus trap, Escape and focus restore that a
  // full-screen panel needs. Above sm it stays the docked panel beside the
  // page. `noSsr` because there is no server render to match.
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const variant = compact ? 'temporary' : 'persistent';
  // The dialog semantics ride with the modality, never ahead of it: announcing
  // aria-modal on the docked panel would claim a trap that is not there and
  // tell a screen reader the rest of the page is inert while it is not.
  const modal = variant === 'temporary';

  return (
    <>
      <Fab
        onClick={() => setChatOpen(true)}
        aria-expanded={chatOpen}
        aria-controls="league-chat-drawer"
        // Repainted off the island rather than the app palette: `color="primary"`
        // put an app-blue button on a green dashboard. `dash-on-accent` on
        // `dash-accent` is a registered pairing (tokens.contrast.test.js), and
        // hover is a brightness step so no second fill token is composed.
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          backgroundColor: 'var(--dash-accent)',
          color: 'var(--dash-on-accent)',
          boxShadow: 'var(--shadow-2)',
          transition: 'filter var(--transition-fast) ease',
          '&:hover': {
            backgroundColor: 'var(--dash-accent)',
            filter: 'brightness(1.08)',
          },
        }}
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
        variant={variant}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        // ChatPanel owns the socket and the unread count this launcher shows, so
        // the paper stays mounted across open/close: without keepMounted the
        // temporary variant would tear the panel down on every close and the
        // badge would restart from zero.
        ModalProps={{ keepMounted: true }}
        // MUI's Modal brings the backdrop, trap, Escape and focus restore but no
        // role, so the paper declares what it is.
        PaperProps={{
          id: 'league-chat-drawer',
          ...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'League chat' } : {}),
        }}
        sx={{
          // The docked variant emits a real in-flow div beside the page, which
          // in the shell's column stack was a permanent empty row (and its own
          // 22px gap) on every dashboard. `contents` keeps the fixed paper and
          // drops the box that generated the row.
          '&.MuiDrawer-docked': { display: 'contents' },
          '& .MuiDrawer-paper': {
            width: { xs: '100vw', sm: 380 },
            boxSizing: 'border-box',
          },
        }}
      >
        <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}>
            <IconButton
              onClick={() => setChatOpen(false)}
              aria-label="Close chat"
              sx={MIN_TOUCH_TARGET_SX}
            >
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
      {/* A column flex container, NOT a grid. The grid this replaced had one
          implicit `auto` track, so the widest min-content anywhere inside set
          the document's width and a 560px table inside a 328px viewport pushed
          every card sideways. In a column flex container the automatic minimum
          applies to the block axis, so every child resolves to a zero inline
          minimum with no per-child `minWidth: 0` and no `minmax` to maintain.
          The extra bottom padding at xs is the fixed chat Fab's clearance
          (56px tall at bottom: 24), which was landing on the last card. */}
      <Container
        maxWidth="lg"
        data-testid="dashboard-shell"
        sx={{
          py: { xs: 2.5, sm: 3.5 },
          pb: { xs: '96px', sm: '40px' },
          display: 'flex',
          flexDirection: 'column',
          gap: '22px',
        }}
      >
        {children}
      </Container>
    </Box>
  );
}
