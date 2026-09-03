import React, {
  useId, useState, useRef, useEffect,
} from 'react';
import {
  Paper,
  Box,
  Typography,
  Button,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  LinearProgress,
  Popover,
  Alert,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import RosterPanel from '../RosterPanel/RosterPanel';
import RosterNeedsStrip from '../RosterPanel/RosterNeedsStrip';
import { railCompositionFor, RAIL_PANELS } from './railComposition';
import { readinessSummaryFor, READINESS_LIST } from './readinessSummary';
import { DraftRoomAssistantPanel } from './DraftRoomAssistant';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import useFocusRescue from './useFocusRescue';
import DraftOrderPanel from '../../widgets/draft-order/ui/DraftOrderPanel';

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
  // `all` for the popover behind it (see viewerPicks.js). Both empty whenever
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
    <Paper
      component="section"
      aria-labelledby={queueHeadingId}
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
      <Typography id={queueHeadingId} variant="h6" component="h2" sx={{ mb: 2 }}>
        My Queue
      </Typography>
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
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
                ...(showQuickDraft && !quickDraftUnavailable
                  ? { bgcolor: 'var(--accent-soft)', borderRadius: 1, p: 0.5 }
                  : {}),
              }}
            >
              <Typography variant="body2">
                {index + 1}. <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} sx={MIN_TOUCH_TARGET_SX} /> (
                {player.position})
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {showQuickDraft && (
                  <Tooltip title={quickDraftUnavailable ? pickState.explanation : ''}>
                    <span>
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        aria-disabled={quickDraftUnavailable || undefined}
                        onClick={() => {
                          if (quickDraftUnavailable) return; // suppressed activation
                          onDraft(player.id);
                        }}
                        sx={MIN_TOUCH_TARGET_SX}
                      >
                        Draft
                      </Button>
                    </span>
                  </Tooltip>
                )}
                <IconButton
                  size="small"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => onMoveUp(index)}
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Move down"
                  disabled={index === queue.length - 1}
                  onClick={() => onMoveDown(index)}
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Remove from queue"
                  onClick={() => onRemoveFromQueue(index)}
                  sx={MIN_TOUCH_TARGET_SX}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            </Box>
          );
        })
      )}
    </Paper>
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
    <Paper component="section" aria-labelledby={readinessHeadingId} sx={{ p: 2, mb: 3 }}>
      {/* tabIndex -1: not in the tab order, but focusable for the rescue
          above when the exception list is removed while holding focus. */}
      <Typography
        id={readinessHeadingId}
        variant="h6"
        component="h2"
        ref={readinessHeadingRef}
        tabIndex={-1}
        sx={{ mb: 1 }}
      >
        Readiness
      </Typography>
      <Button
        variant="contained"
        fullWidth
        aria-pressed={!!myTeam.draft_ready}
        onClick={() => onToggleReady(!myTeam.draft_ready)}
        sx={{ ...MIN_TOUCH_TARGET_SX, mb: 1 }}
      >
        I&apos;m ready
      </Button>
      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 0.5 }}>
        {readinessCountText}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={readiness.percentReady}
        aria-label="Managers ready"
        // aria-valuenow is the rounded percentage MUI derives from `value`,
        // which is the bar's width and not the league's state: 38 does not say
        // 3 of 8, and at some league sizes two different counts round to the
        // same percent. valuetext carries the reading itself.
        aria-valuetext={readinessCountText}
        sx={{ height: 8, borderRadius: 'var(--radius-sm)', mb: 1 }}
      />
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
          sx={{ bgcolor: 'transparent', '&::before': { display: 'none' } }}
        >
          <AccordionSummary
            id={readinessListId}
            aria-controls={`${readinessListId}-content`}
            expandIcon={<ExpandMoreIcon />}
            sx={MIN_TOUCH_TARGET_SX}
          >
            <Typography variant="body2">{readiness.listLabel}</Typography>
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
                  <Typography variant="body2">{team.teamName}</Typography>
                </Box>
              ))}
            </Box>
          </AccordionDetails>
        </Accordion>
      )}
    </Paper>
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
    <Paper component="section" aria-labelledby={upcomingHeadingId} sx={{ p: 2, mb: 3 }}>
      <Typography
        id={upcomingHeadingId}
        variant="h6"
        component="h2"
        ref={upcomingHeadingRef}
        tabIndex={-1}
        sx={{ mb: 1 }}
      >
        Upcoming
      </Typography>
      {upcoming.length === 0 && (
        // The two reasons the strip can be empty - the draft is on its last
        // pick, or the Draft order is not settled enough to read forward from -
        // are now distinguishable: draftOrderWindowFor evaluates the
        // settled-guard once and holds both facts, so this could name the
        // cause. The copy stays neutral by choice, not for want of the answer:
        // no `reason` field is passed down, because neither cause is one a
        // manager here can act on, and neutral copy beats a heading standing
        // over a named non-problem.
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
              display: 'flex', alignItems: 'center', gap: 0.75,
              px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.hover',
            }}
          >
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
              {entry.pickLabel}
            </Typography>
            {/* A real space, not just the flex gap: without one the two spans
                run together into "1.02Harbor Hawks" when read aloud. */}
            {' '}
            <Typography component="span" variant="body2">
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
          whose picks are all made - viewerPicks.js answers empty rather than
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
          <Typography id={myPicksHeadingId} variant="caption" sx={{ color: 'text.secondary' }}>
            My picks
          </Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {viewerPicks.next.map((pick) => pick.pickLabel).join(' · ')}
          </Typography>
          <Button
            size="small"
            onClick={(event) => setAllPicksAnchor(event.currentTarget)}
            aria-haspopup="dialog"
            aria-expanded={allPicksOpen}
            aria-controls={allPicksOpen ? `${allPicksHeadingId}-popover` : undefined}
            sx={MIN_TOUCH_TARGET_SX}
          >
            All {viewerPicks.all.length} of my picks
          </Button>
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
                sx: { p: 2, maxWidth: 280 },
              },
            }}
          >
            <Typography id={allPicksHeadingId} variant="subtitle2" component="h3" sx={{ mb: 1 }}>
              All my picks
            </Typography>
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
                  sx={{
                    px: 1, py: 0.5, borderRadius: 'var(--radius-sm)', bgcolor: 'action.hover',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <Typography component="span" variant="body2">{pick.pickLabel}</Typography>
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
        sx={{ mt: 1, bgcolor: 'transparent', '&::before': { display: 'none' } }}
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
          <Typography variant="body2">Full Draft order</Typography>
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
    </Paper>
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
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
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
