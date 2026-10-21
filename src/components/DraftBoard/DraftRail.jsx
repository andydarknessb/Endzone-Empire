import React, {
  useId, useState, useRef, useEffect,
} from 'react';
import {
  Box,
  Typography,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Popover,
  Alert,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Frame, PsButton, PixelClose, BODY_FONT, pixelSx,
} from '../../shared/ui/playselect';
// Direct file import (#1311, draft-harness-coverage guard), not the
// entities/player barrel: the barrel's index.js also re-exports
// `usePlayerCard`, whose module graph reaches `shared/lib/useEndpoint`'s
// non-literal `apiClient.get(url)` - importing ANY named export from a
// barrel evaluates the whole module, which would pull that unresolvable
// call into the Draft room's statically-analyzed import closure. PlayerNameLink
// itself imports only React and MUI, so this file alone stays clean of it.
import PlayerNameLink from '../../entities/player/ui/PlayerNameLink';
import RosterPanel from '../RosterPanel/RosterPanel';
import RosterNeedsStrip from '../RosterPanel/RosterNeedsStrip';
import { railCompositionFor, RAIL_PANELS } from './railComposition';
import { readinessSummaryFor, READINESS_LIST } from './readinessSummary';
import { DraftRoomAssistantPanel } from './DraftRoomAssistant';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';
import useFocusRescue from './useFocusRescue';
import DraftOrderPanel from '../../widgets/draft-order/ui/DraftOrderPanel';

// Rows and copy are Archivo; only the section headings are pixel type.
const BODY_SX = { fontFamily: BODY_FONT };
const DIM_SX = { ...BODY_SX, color: 'var(--ps-dim)' };
const HEADING_SX = { ...pixelSx(16), m: 0 };
const ACCORDION_SX = {
  bgcolor: 'transparent', color: 'var(--ps-ink)', borderRadius: 0, '&::before': { display: 'none' },
};
const RULE_ITEM_SX = {
  px: 1, py: 0.5, border: '2px solid var(--ps-rule)', fontVariantNumeric: 'tabular-nums', ...BODY_SX,
};

// A 16px arrow on the 2px grid (8 cells); the down arrow is the up arrow flipped.
const ARROW_ROWS = ['...##...', '..####..', '.######.', '...##...', '...##...', '...##...', '...##...', '...##...'];
const ARROW_PATH = ARROW_ROWS
  .map((row, y) => [...row].map((c, x) => (c === '#' ? `M${x * 2} ${y * 2}h2v2h-2z` : '')).join(''))
  .join('');
function MoveArrow({ down = false }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      shapeRendering="crispEdges"
      style={{ flex: 'none', transform: down ? 'scaleY(-1)' : undefined }}
    >
      <path d={ARROW_PATH} fill="currentColor" />
    </svg>
  );
}

// The rail's two vanishing controls - the Readiness exception list when the
// last manager declares ready, and the viewer's picks popover when their last
// pick lands - come and go in response to what OTHER managers do, and the
// browser drops focus to `<body>` when they take focus with them. The
// focus-rescue hook (shared with the room's own layout flip, #525) moves focus
// to each panel's heading only when focus was inside the control that went
// away; the manager most likely to hold the Readiness trigger is the one
// watching the lobby fill, so the bad case is the expected one.

/** Draft-room rail, composed from the draft's status (issue #123 acceptance
 * criteria 1-4).
 *
 * Every panel this can render is built here; which of them appear, and in what
 * order, is `railCompositionFor` and nothing else. A panel additionally
 * declines to render when it has nothing honest to show - Readiness needs the
 * viewer to hold a Team, My Roster needs a first draft:state frame, Upcoming
 * needs a settled Draft order - so composition answers "does this status want
 * this panel" and the panel answers "do I have anything to say".
 *
 * `rosterView` is null before the first draft:state frame and for anyone
 * without a team in this league, which is also what keeps the roster section
 * out of the DOM for every existing DraftBoard test - none of their draft:state
 * payloads carry roster_slots.
 *
 * Pick history is deliberately not among the panels. It is the chronological
 * view of the same committed Picks the Draft board holds (CONTEXT.md: Draft
 * board), so it is a collapsible view inside Board - see PickHistory.jsx.
 * On the clock is likewise absent: it is the persistent banner above this
 * rail's own scrolling region, and a copy in here would scroll away. */
function DraftRail({
  queue,
  // The last failed queue write (issue #216), surfaced right here rather
  // than in the room-wide error banner: a rejected reorder is a queue-panel
  // problem, and the rest of the room - board, live banner, other panels -
  // stays live and unaffected by it.
  queueError = null,
  onMoveUp,
  onMoveDown,
  onRemoveFromQueue,
  onDraft,
  // The room's one pick-availability reading (issue #792 ruling 3): whether a
  // manual Pick exists in this draft at all, whether it is only temporarily
  // unavailable right now, and the one shared explanation for that. Derived once
  // by the room from pickAvailability.js and shared with the pool table and
  // Quick View, so this rail no longer imports pickAvailability or keys on the
  // raw isMyTurn/draftPaused/draftType facts itself.
  pickState,
  teams,
  onTheClock,
  isCommissioner,
  viewerTeamId,
  draftStatus,
  onToggleAutodraft,
  onToggleReady,
  isXs,
  onOpenQuickView,
  rosterView = null,
  // The next three picks after the one on the clock (see draftOrderWindow.js).
  // Empty whenever the Draft order is not settled enough to read.
  upcoming = [],
  // The viewer's OWN remaining Pick numbers - `next` for the inline strip,
  // `all` for the popover behind it (see draftOrderWindow.js). Both empty whenever
  // the Draft order is not settled enough to read, which includes every
  // pending lobby.
  viewerPicks = { all: [], next: [] },
  // How far from the top of its scrolling ancestor the queue panel sticks.
  // Embedded in the page (mobile's single scroll region, or the pre-#122
  // desktop layout) it must clear LiveDraftBanner, which is itself sticky at
  // top: 0 there. Inside the desktop rail's own bounded scroll region
  // (issue #122) LiveDraftBanner lives in the non-scrolling header above the
  // region instead, so nothing needs clearing and the caller passes a small
  // constant instead.
  queueStickyTop = draftStatus === 'active' ? 148 : 16,
  // The queue panel's own cap, independent of queueStickyTop: embedded in
  // the page this is sized against the full viewport (there's nothing
  // narrower to bound it), but the desktop rail region (issue #122) is only
  // ~1/3 of viewport width and often shorter than the viewport too - a
  // generous viewport-relative cap there would let a long queue crowd out
  // the panels beneath it in that same narrow column, so the caller passes a
  // smaller bound for that region instead.
  queueMaxHeight = draftStatus === 'active' ? 'calc(100vh - 164px)' : '80vh',
}) {
  // "Which one of these is me" is the viewer-relative contract (#113): the
  // viewer's own Team ID, answered on the draft:join acknowledgement, against
  // each entry's Team ID. Never a comparison of account ids.
  const myTeam = viewerTeamId == null ? undefined : teams.find((team) => team.teamId === viewerTeamId);
  const readiness = readinessSummaryFor(teams);
  // Stable heading ids for this instance, so each panel's Paper/section can be
  // named via aria-labelledby instead of duplicating its visible title text.
  const queueHeadingId = useId();
  const readinessHeadingId = useId();
  const upcomingHeadingId = useId();
  const orderDisclosureId = useId();
  const readinessListId = useId();
  const myPicksHeadingId = useId();
  const allPicksHeadingId = useId();

  // The complete list of the viewer's picks. Anchored state rather than a
  // controlled `open` flag alone because MUI positions the Popover against the
  // element it was opened from.
  const [allPicksAnchor, setAllPicksAnchor] = useState(null);
  const allPicksOpen = Boolean(allPicksAnchor);

  // Where focus goes when one of the two vanishing controls takes it with it.
  // The panel's own heading in each case: it names where the manager still is,
  // which is the question losing focus leaves them with.
  const readinessHeadingRef = useRef(null);
  const upcomingHeadingRef = useRef(null);
  const hasExceptionList = readiness.listKind !== READINESS_LIST.NONE;
  const hasViewerPicks = viewerPicks.all.length > 0;
  // Each rescue returns focus to its panel's own heading, which names where the
  // manager still is - the question losing focus leaves them with. The heading
  // outlives the vanishing control, so it is resolved fresh at rescue time.
  const readinessFocus = useFocusRescue(hasExceptionList, () => readinessHeadingRef.current);
  const myPicksFocus = useFocusRescue(hasViewerPicks, () => upcomingHeadingRef.current);

  // The anchor outlives the element it points at when the picks group unmounts
  // with the popover open, so drop it rather than leave a detached node to be
  // measured against if the group ever comes back (a commissioner correcting a
  // pick, or a corrected socket frame).
  useEffect(() => {
    if (!hasViewerPicks && allPicksAnchor) setAllPicksAnchor(null);
  }, [hasViewerPicks, allPicksAnchor]);

  const queuePanel = (
    <Frame
      tier="rule"
      component="section"
      labelledBy={queueHeadingId}
      sx={{
        p: 2,
        mb: 3,
        // Keep the queue reachable as the panels around it push it down the
        // page. The offset when a draft is active clears LiveDraftBanner,
        // which is sticky above it at top: 0.
        position: 'sticky',
        top: queueStickyTop,
        zIndex: 2,
        maxHeight: queueMaxHeight,
        overflowY: 'auto',
      }}
    >
      <Box component="h2" id={queueHeadingId} sx={{ ...HEADING_SX, mb: 2 }}>
        My Queue
      </Box>
      {queueError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {queueError}
        </Alert>
      )}
      {queue.length === 0 ? (
        // Names the action a manager takes rather than where the players are.
        // "below" is only true in one of the three layouts this rail renders
        // in (issue #124 acceptance criterion 6): on mobile the pool is behind
        // the Players tab, and on desktop since #122 it is a separate
        // scrolling region beside this one.
        <Typography variant="body2" sx={DIM_SX}>
          Queue is empty. Choose Queue on a player to add them here.
        </Typography>
      ) : (
        queue.map((player, index) => {
          // The rail's shortcut mirrors the pool table's own rules exactly:
          // shown only for queue[0] when a manual Pick exists at all
          // (active, snake-type draft) - hidden entirely otherwise - and,
          // when it exists but isn't usable right now (not your turn, or
          // paused), rendered focusable aria-disabled with the same shared
          // explanation rather than disappearing (issue #120 acceptance
          // criteria 2, 5).
          const showQuickDraft = index === 0 && pickState.canManualPick;
          const quickDraftUnavailable = showQuickDraft && pickState.pickUnavailable;
          return (
            <Box
              key={player.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                flexWrap: 'wrap',
                mb: 1,
              }}
            >
              <Typography variant="body2" sx={BODY_SX}>
                {index + 1}. <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} sx={MIN_TOUCH_TARGET_SX} /> (
                {player.position})
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {showQuickDraft && (
                  <Tooltip title={quickDraftUnavailable ? pickState.explanation : ''}>
                    <span>
                      <PsButton
                        aria-disabled={quickDraftUnavailable || undefined}
                        onClick={() => {
                          if (quickDraftUnavailable) return; // suppressed activation
                          onDraft(player.id);
                        }}
                      >
                        Draft
                      </PsButton>
                    </span>
                  </Tooltip>
                )}
                <PsButton
                  variant="quiet"
                  ariaLabel={`Move ${player.name} up`}
                  disabled={index === 0}
                  onClick={() => onMoveUp(index)}
                >
                  <MoveArrow />
                </PsButton>
                <PsButton
                  variant="quiet"
                  ariaLabel={`Move ${player.name} down`}
                  disabled={index === queue.length - 1}
                  onClick={() => onMoveDown(index)}
                >
                  <MoveArrow down />
                </PsButton>
                <Box aria-hidden="true" sx={{ width: '2px', height: '24px', bgcolor: 'var(--ps-rule)', mx: 0.5 }} />
                <PsButton
                  variant="quiet"
                  ariaLabel={`Remove ${player.name} from queue`}
                  onClick={() => onRemoveFromQueue(index)}
                >
                  <PixelClose />
                </PsButton>
              </Box>
            </Box>
          );
        })
      )}
    </Frame>
  );

  // Readiness: which teams have declared themselves ready, counted against the
  // Teams in the league rather than its configured size. A team that has not
  // declared is Not ready; a team that has not JOINED has not declined to be
  // ready and cannot appear in either list (CONTEXT.md: Readiness). Renders
  // only for a viewer who holds a Team, since its own control is a
  // declaration about that Team.
  //
  // The count and the bar say the same thing twice on purpose: the bar is the
  // glanceable reading and the sentence is the exact one, and a bar alone
  // cannot distinguish 4 of 8 from 50 of 100. What is gone is the row of one
  // chip per Team, which grew with the league and said "Not ready" eleven
  // times to communicate one number. Which Teams are worth naming, and whether
  // any are, is readinessSummary.js and nothing here (issue #124 acceptance
  // criteria 1-2).
  // Shown, not announced. The announcement is the Draft room's own persistent
  // region (ReadinessAnnouncer, issue #164): this rail is mounted per tab
  // below the medium breakpoint, so a live region in here is destroyed and
  // rebuilt on every tab switch, and a live region rebuilt around its text is
  // not a change any assistive technology was observing. The sentence itself
  // comes from readinessSummary so the two cannot drift.
  const readinessCountText = readiness.countText;
  const readinessPanel = myTeam ? (
    <Frame tier="rule" component="section" labelledBy={readinessHeadingId} sx={{ p: 2, mb: 3 }}>
      {/* tabIndex -1: not in the tab order, but focusable for the rescue
          above when the exception list is removed while holding focus. */}
      <Box
        component="h2"
        id={readinessHeadingId}
        ref={readinessHeadingRef}
        tabIndex={-1}
        sx={{ ...HEADING_SX, mb: 1 }}
      >
        Readiness
      </Box>
      {/* Fill until the viewer is ready, then the selected pressed toggle: #2434's Start draft
          takes the fill in the opposite case, so at most one is ever filled. */}
      <Box sx={{ mb: 1, '& > button': { width: '100%' } }}>
        <PsButton
          variant={myTeam.draft_ready ? 'selected' : 'fill'}
          aria-pressed={!!myTeam.draft_ready}
          onClick={() => onToggleReady(!myTeam.draft_ready)}
        >
          I&apos;m ready
        </PsButton>
      </Box>
      <Typography variant="caption" sx={{ ...DIM_SX, display: 'block', mb: 0.5 }}>
        {readinessCountText}
      </Typography>
      <Box
        role="progressbar"
        aria-label="Managers ready"
        aria-valuemin={0}
        aria-valuemax={100}
        // aria-valuenow is the rounded percentage, which is the bar's width and not the
        // league's state: 38 does not say 3 of 8, and at some league sizes two different
        // counts round to the same percent. valuetext carries the reading itself.
        aria-valuenow={Math.round(readiness.percentReady)}
        aria-valuetext={readinessCountText}
        sx={{
          height: '12px', border: '2px solid var(--ps-rule)', mb: 1, boxSizing: 'border-box',
        }}
      >
        <Box sx={{ height: '100%', width: `${readiness.percentReady}%`, bgcolor: 'var(--ps-ink)' }} />
      </Box>
      {hasExceptionList && (
        <Accordion
          {...readinessFocus}
          defaultExpanded={false}
          disableGutters
          elevation={0}
          // Unmounted while collapsed: the names are the exception list, not
          // hidden content the panel keeps ready, and a collapsed list of
          // fourteen Teams is fourteen nodes of nothing in a live lobby.
          TransitionProps={{ unmountOnExit: true }}
          sx={ACCORDION_SX}
        >
          <AccordionSummary
            id={readinessListId}
            aria-controls={`${readinessListId}-content`}
            expandIcon={<ExpandMoreIcon />}
            sx={MIN_TOUCH_TARGET_SX}
          >
            <Typography variant="body2" sx={BODY_SX}>{readiness.listLabel}</Typography>
          </AccordionSummary>
          {/* No `id` here. MUI already renders the region this names, and puts
              the summary's own `aria-controls` value on it, so repeating that
              id on the details would put it in the document twice and leave
              aria-controls resolving by document order. */}
          <AccordionDetails sx={{ px: 0, pt: 0 }}>
            <Box component="ul" role="list" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {readiness.listedTeams.map((team) => (
                // Keyed by Team ID, never by name: duplicate Team names are
                // valid identity (CONTEXT.md: Team) and would collapse into
                // one row under a name key.
                <Box component="li" role="listitem" key={team.teamId}>
                  <Typography variant="body2" sx={BODY_SX}>{team.teamName}</Typography>
                </Box>
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}
    </Frame>
  ) : null;

  // Draft order is a shared widget because the same Team sequence appears in
  // the pending panel and the active Upcoming disclosure. DraftRail still
  // decides when each composition is visible; the widget owns the row layout.
  const draftOrderProps = {
    teams,
    draftStatus,
    viewerTeamId,
    isCommissioner,
    onTheClock,
    onToggleAutodraft,
  };
  const orderPanel = teams.length > 0 ? <DraftOrderPanel {...draftOrderProps} /> : null;

  const rosterPanel = rosterView ? (
    <Box sx={{ mb: 3 }}>
      <RosterNeedsStrip
        rosterSlots={rosterView.rosterSlots}
        benchCount={rosterView.benchCount}
        irCount={rosterView.irCount}
        irDraftable={false}
        picks={rosterView.picks}
        remainingPicks={rosterView.remainingPicks}
        nextPickLabel={rosterView.nextPickLabel}
        maxChips={isXs ? 2 : 3}
      />
      <Box sx={{ mt: 1 }}>
        <RosterPanel
          rosterSlots={rosterView.rosterSlots}
          benchCount={rosterView.benchCount}
          irCount={rosterView.irCount}
          irDraftable={false}
          picks={rosterView.picks}
          rounds={rosterView.rounds}
          title="My Roster"
          dense
        />
      </Box>
    </Box>
  ) : null;

  // The compact Upcoming strip: who picks after the Team on the clock, which
  // is stated persistently above and deliberately not repeated here. A Team
  // holding two picks across a snake turn appears twice - see draftOrderWindow.js.
  //
  // The full Draft order sits behind a disclosure inside this panel rather
  // than as a panel of its own. Compact is the point of the strip (spec #108
  // story 56: the next three visible, the complete list available
  // accessibly), but the complete list is also where the commissioner-all and
  // manager-own Autodraft switches live. Collapsed by default, so it costs
  // nothing until it is wanted. Its trigger is deliberately not a heading: the
  // composition's H2s are its panels, and this is a control within one.
  const upcomingPanel = teams.length > 0 ? (
    <Frame tier="rule" component="section" labelledBy={upcomingHeadingId} sx={{ p: 2, mb: 3 }}>
      <Box
        component="h2"
        id={upcomingHeadingId}
        ref={upcomingHeadingRef}
        tabIndex={-1}
        sx={{ ...HEADING_SX, mb: 1 }}
      >
        Upcoming
      </Box>
      {upcoming.length === 0 && (
        // The two reasons the strip can be empty - the draft is on its last
        // pick, or the Draft order is not settled enough to read forward from -
        // are now distinguishable: draftOrderWindowFor evaluates the
        // settled-guard once and holds both facts, so this could name the
        // cause. The copy stays neutral by choice, not for want of the answer:
        // no `reason` field is passed down, because neither cause is one a
        // manager here can act on, and neutral copy beats a heading standing
        // over a named non-problem.
        <Typography variant="body2" sx={DIM_SX}>
          No upcoming picks to show.
        </Typography>
      )}
      <Box
        component="ul"
        // Explicit list roles: the strip removes its bullets, and some screen
        // readers drop list semantics from a list styled that way.
        role="list"
        sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, listStyle: 'none', p: 0, m: 0 }}
      >
        {upcoming.map((entry) => (
          <Box
            component="li"
            role="listitem"
            key={entry.pickNumber}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.75, ...RULE_ITEM_SX,
            }}
          >
            <Typography component="span" variant="caption" sx={{ ...DIM_SX, fontVariantNumeric: 'tabular-nums' }}>
              {entry.pickLabel}
            </Typography>
            {/* A real space, not just the flex gap: without one the two spans
                run together into "1.02Harbor Hawks" when read aloud. */}
            {' '}
            <Typography component="span" variant="body2" sx={BODY_SX}>
              {entry.teamName}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* The viewer-relative reading of the same order the strip above states
          league-wide: which of those upcoming picks are mine (issue #124
          acceptance criterion 4). It grows from the Draft order disclosure
          below rather than standing as a panel of its own, because a manager's
          upcoming picks ARE positions in the Draft order and not a separate
          thing (CONTEXT.md: Draft order). Inline and never behind the
          disclosure: the next three are the whole point of the strip, and a
          wait a manager has to open something to learn is one they estimate
          wrong instead. Absent entirely for a spectator, and for a manager
          whose picks are all made - draftOrderWindow.js answers empty rather than
          guessing, and a group heading over nothing is worse than no group. */}
      {hasViewerPicks && (
        <Box
          {...myPicksFocus}
          role="group"
          aria-labelledby={myPicksHeadingId}
          sx={{
            mt: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap',
          }}
        >
          <Typography id={myPicksHeadingId} variant="caption" sx={DIM_SX}>
            My picks
          </Typography>
          <Typography variant="body2" sx={{ ...BODY_SX, fontVariantNumeric: 'tabular-nums' }}>
            {viewerPicks.next.map((pick) => pick.pickLabel).join(' · ')}
          </Typography>
          <PsButton
            variant="quiet"
            onClick={(event) => setAllPicksAnchor(event.currentTarget)}
            aria-haspopup="dialog"
            ariaExpanded={allPicksOpen}
            ariaControls={allPicksOpen ? `${allPicksHeadingId}-popover` : undefined}
          >
            All {viewerPicks.all.length} of my picks
          </PsButton>
          <Popover
            id={`${allPicksHeadingId}-popover`}
            open={allPicksOpen}
            anchorEl={allPicksAnchor}
            onClose={() => setAllPicksAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            // role and name on the Paper itself, so the thing that opens is a
            // named dialog rather than an unlabelled box. MUI's Modal beneath
            // it is what makes the popover keyboard-operable at all: Escape
            // closes it and focus returns to the trigger.
            slotProps={{
              paper: {
                role: 'dialog',
                'aria-labelledby': allPicksHeadingId,
                sx: {
                  p: 2,
                  maxWidth: 280,
                  borderRadius: 0,
                  bgcolor: 'var(--ps-panel)',
                  color: 'var(--ps-ink)',
                  border: '2px solid var(--ps-frame-2)',
                },
              },
            }}
          >
            <Box component="h3" id={allPicksHeadingId} sx={{ ...BODY_SX, fontSize: '15px', fontWeight: 700, m: 0, mb: 1 }}>
              All my picks
            </Box>
            <Box
              component="ul"
              role="list"
              sx={{
                listStyle: 'none', p: 0, m: 0, display: 'flex', flexWrap: 'wrap', gap: 1,
              }}
            >
              {viewerPicks.all.map((pick) => (
                <Box
                  component="li"
                  role="listitem"
                  key={pick.pickNumber}
                  sx={RULE_ITEM_SX}
                >
                  <Typography component="span" variant="body2" sx={BODY_SX}>{pick.pickLabel}</Typography>
                </Box>
              ))}
            </Box>
          </Popover>
        </Box>
      )}

      <Accordion
        defaultExpanded={false}
        disableGutters
        elevation={0}
        // Unmounted while collapsed, so "costs nothing until it is wanted"
        // (#123) is true of the DOM and not only of the pixels: a fourteen-Team
        // order carries fourteen rows and up to fourteen switches, and left
        // mounted they are fourteen list items and fourteen controls that
        // assistive technology and keyboard order have to account for.
        TransitionProps={{ unmountOnExit: true }}
        sx={{ ...ACCORDION_SX, mt: 1 }}
      >
        {/* The id is what names the role="region" MUI builds internally: it
            reads the FIRST child's `id` for the region's aria-labelledby.
            Without one that nested region is announced unnamed, inside a
            panel already called Upcoming, which tells a screen-reader user
            nothing about what they just opened. */}
        <AccordionSummary
          id={orderDisclosureId}
          // MUI only emits aria-controls when it is given one, so without this
          // the trigger announces its expanded state without ever saying what
          // it expands.
          aria-controls={`${orderDisclosureId}-content`}
          expandIcon={<ExpandMoreIcon />}
          sx={MIN_TOUCH_TARGET_SX}
        >
          <Typography variant="body2" sx={BODY_SX}>Full Draft order</Typography>
        </AccordionSummary>
        {/* Likewise no `id`: MUI's own region already carries the summary's
            aria-controls value (this one came in with #123 and is corrected
            here rather than left standing beside the identical new one). */}
        <AccordionDetails sx={{ px: 0 }}>
          <DraftOrderPanel
            teams={teams}
            draftStatus={draftStatus}
            viewerTeamId={viewerTeamId}
            isCommissioner={isCommissioner}
            onTheClock={onTheClock}
            onToggleAutodraft={onToggleAutodraft}
            embedded
          />
        </AccordionDetails>
      </Accordion>
    </Frame>
  ) : null;

  const panels = {
    [RAIL_PANELS.READINESS]: readinessPanel,
    [RAIL_PANELS.ORDER]: orderPanel,
    [RAIL_PANELS.QUEUE]: queuePanel,
    [RAIL_PANELS.ROSTER]: rosterPanel,
    [RAIL_PANELS.UPCOMING]: upcomingPanel,
    // The private, opt-in Draft assistant (issue #787). A self-contained
    // consumer of the room's assistant context (DraftRoomAssistant.jsx), so the
    // rail passes it no props and holds none of its state; the engine lives once
    // above the tabs in DraftBoard's chrome. It returns null while the toggle is
    // off, so this composes into `active` unconditionally yet the rail is
    // unchanged until a manager turns the voice on. Rendered without a provider
    // (DraftRail.test.jsx) it reads the off default and likewise renders nothing.
    [RAIL_PANELS.ASSISTANT]: <DraftRoomAssistantPanel />,
  };

  const composed = railCompositionFor(draftStatus)
    .map((panelKey) => {
      // A key with no builder and a panel that declined to render are both
      // `undefined` here, and the filter below cannot tell them apart - so
      // without this, composing a panel nobody wired would drop it silently
      // and every composition-order assertion would still pass. Development
      // and test only: this is a programmer error that cannot arise from
      // data, and a hard failure in a live draft room would be a worse
      // outcome than a missing panel.
      if (process.env.NODE_ENV !== 'production' && !Object.prototype.hasOwnProperty.call(panels, panelKey)) {
        throw new Error(
          `DraftRail: the composition for draft status "${draftStatus}" names the panel `
          + `"${panelKey}", which nothing builds. Add it to \`panels\` here, or remove it `
          + 'from railComposition.js.'
        );
      }
      return { panelKey, panel: panels[panelKey] };
    })
    .filter((entry) => entry.panel != null);

  // Only one composition can come out empty: complete, whose single panel is
  // My Roster, seen by someone with no Team in this league. Saying nothing
  // there would read as a failed load rather than as a finished draft.
  if (composed.length === 0) {
    return (
      <Typography variant="body2" sx={DIM_SX}>
        This draft is complete. Open the Board for the full record.
      </Typography>
    );
  }

  return (
    <>
      {composed.map(({ panelKey, panel }) => <React.Fragment key={panelKey}>{panel}</React.Fragment>)}
    </>
  );
}

export default DraftRail;
