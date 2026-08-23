import React, { useId } from 'react';
import {
  Paper,
  Box,
  Typography,
  Button,
  IconButton,
  Chip,
  FormControlLabel,
  Switch,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import RosterPanel from '../RosterPanel/RosterPanel';
import RosterNeedsStrip from '../RosterPanel/RosterNeedsStrip';
import { pickActionExists, pickTemporarilyUnavailable, PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';
import { railCompositionFor, RAIL_PANELS } from './railComposition';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

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
  onMoveUp,
  onMoveDown,
  onRemoveFromQueue,
  onDraft,
  isMyTurn,
  draftPaused,
  teams,
  onTheClock,
  isCommissioner,
  viewerTeamId,
  draftStatus,
  draftType,
  onToggleAutodraft,
  onToggleReady,
  isXs,
  onOpenQuickView,
  rosterView = null,
  // The next three picks after the one on the clock (see upcomingTeams.js).
  // Empty whenever the Draft order is not settled enough to read.
  upcoming = [],
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
  const readyCount = teams.filter((team) => team.draft_ready).length;

  // Stable heading ids for this instance, so each panel's Paper/section can be
  // named via aria-labelledby instead of duplicating its visible title text.
  const queueHeadingId = useId();
  const orderHeadingId = useId();
  const readinessHeadingId = useId();
  const upcomingHeadingId = useId();
  const orderDisclosureId = useId();

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
      {queue.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Queue is empty. Add players from the list below.
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
          const showQuickDraft = index === 0 && pickActionExists({ draftStatus, draftType });
          const quickDraftUnavailable = showQuickDraft && pickTemporarilyUnavailable({ isMyTurn, draftPaused });
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
                  <Tooltip title={quickDraftUnavailable ? PICK_UNAVAILABLE_EXPLANATION : ''}>
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
  // league's size. A team that has not declared is Not ready (CONTEXT.md:
  // Readiness). Renders only for a viewer who holds a Team, since its own
  // control is a declaration about that Team.
  const readinessPanel = myTeam ? (
    <Paper component="section" aria-labelledby={readinessHeadingId} sx={{ p: 2, mb: 3 }}>
      <Typography id={readinessHeadingId} variant="h6" component="h2" sx={{ mb: 1 }}>
        Readiness
      </Typography>
      <FormControlLabel
        sx={MIN_TOUCH_TARGET_SX}
        control={<Switch checked={!!myTeam.draft_ready} onChange={(event) => onToggleReady(event.target.checked)} inputProps={{ 'aria-label': 'I am ready for the draft' }} />}
        label="I'm ready"
      />
      <Typography role="status" aria-live="polite" variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
        {readyCount} of {teams.length} managers ready
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {teams.map((team) => <Chip key={team.teamId} size="small" color={team.draft_ready ? 'success' : 'default'} label={`${team.teamName}: ${team.draft_ready ? 'Ready' : 'Not ready'}`} />)}
      </Box>
    </Paper>
  ) : null;

  // Draft order: which team holds which slot (CONTEXT.md: Draft order). The
  // list itself is shared by the two places a status can meet it - its own
  // panel while the draft is pending, and the disclosure inside Upcoming once
  // it is live - so the Auto-draft switches, their help caption and the rule
  // about who may touch them are written once.
  const orderListBody = (
    <>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
        Turn on <strong>Auto-draft</strong> to let the system pick automatically for a team (best available by
        ADP) when it's on the clock. It also switches on by itself after a team misses two picks.
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {teams.map((team) => {
          const isViewer = viewerTeamId != null && team.teamId === viewerTeamId;
          const canToggle = (isCommissioner || isViewer) && draftStatus !== 'complete';
          const onClock = onTheClock && onTheClock.teamId === team.teamId;
          return (
            <Box
              key={team.teamId}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 44 }}
            >
              <Typography variant="body2" sx={{ minWidth: 22, color: 'text.secondary' }}>
                {team.draft_position != null ? `${team.draft_position}.` : '-'}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: onClock ? 'bold' : 'normal', flexGrow: 1 }}>
                {team.teamName}
                {onClock && ' ⏱'}
              </Typography>
              {team.autodraft && <Chip size="small" color="warning" label="AUTO" />}
              {canToggle && (
                <FormControlLabel
                  sx={{ m: 0, ...MIN_TOUCH_TARGET_SX }}
                  labelPlacement="start"
                  control={
                    <Switch
                      size="small"
                      checked={!!team.autodraft}
                      onChange={(e) => onToggleAutodraft(team.teamId, e.target.checked)}
                      inputProps={{ 'aria-label': `Autodraft for ${team.teamName}` }}
                    />
                  }
                  label={
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Auto-draft
                    </Typography>
                  }
                />
              )}
            </Box>
          );
        })}
      </Box>
    </>
  );

  const orderPanel = teams.length > 0 ? (
    <Paper component="section" aria-labelledby={orderHeadingId} sx={{ p: 2, mb: 3 }}>
      <Typography id={orderHeadingId} variant="h6" component="h2" sx={{ mb: 0.5 }}>
        Draft order
      </Typography>
      {orderListBody}
    </Paper>
  ) : null;

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
  // holding two picks across a snake turn appears twice - see upcomingTeams.js.
  //
  // The full Draft order sits behind a disclosure inside this panel rather
  // than as a panel of its own. Compact is the point of the strip (spec #108
  // story 56: the next three visible, the complete list available
  // accessibly), but the complete list is also where the per-team Auto-draft
  // switches live, and those are how a manager who stepped away turns
  // autodraft back off - the panel's own caption says it switches on by
  // itself after two missed picks. Collapsed by default, so it costs nothing
  // until it is wanted. Its trigger is deliberately not a heading: the
  // composition's H2s are its panels, and this is a control within one.
  const upcomingPanel = teams.length > 0 ? (
    <Paper component="section" aria-labelledby={upcomingHeadingId} sx={{ p: 2, mb: 3 }}>
      <Typography id={upcomingHeadingId} variant="h6" component="h2" sx={{ mb: 1 }}>
        Upcoming
      </Typography>
      {upcoming.length === 0 && (
        // Deliberately does not say why. There are two reasons the strip can
        // be empty - the draft is on its last pick, or the Draft order is not
        // settled enough to read forward from - and the rail cannot tell them
        // apart from here. Neutral copy beats a heading standing over nothing,
        // and beats guessing at a cause.
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

      <Accordion defaultExpanded={false} disableGutters elevation={0} sx={{ mt: 1, bgcolor: 'transparent', '&::before': { display: 'none' } }}>
        {/* The id is what names the role="region" MUI builds internally: it
            reads the FIRST child's `id` for the region's aria-labelledby.
            Without one that nested region is announced unnamed, inside a
            panel already called Upcoming, which tells a screen-reader user
            nothing about what they just opened. */}
        <AccordionSummary id={orderDisclosureId} expandIcon={<ExpandMoreIcon />} sx={MIN_TOUCH_TARGET_SX}>
          <Typography variant="body2">Full Draft order</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ px: 0 }}>{orderListBody}</AccordionDetails>
      </Accordion>
    </Paper>
  ) : null;

  const panels = {
    [RAIL_PANELS.READINESS]: readinessPanel,
    [RAIL_PANELS.ORDER]: orderPanel,
    [RAIL_PANELS.QUEUE]: queuePanel,
    [RAIL_PANELS.ROSTER]: rosterPanel,
    [RAIL_PANELS.UPCOMING]: upcomingPanel,
  };

  const composed = railCompositionFor(draftStatus)
    .map((panelKey) => ({ panelKey, panel: panels[panelKey] }))
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
