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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import RosterPanel from '../RosterPanel/RosterPanel';
import RosterNeedsStrip from '../RosterPanel/RosterNeedsStrip';
import { pickActionExists, pickTemporarilyUnavailable, PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { teamNameLabel } from '../../lib/teamIdentity';

/** Draft-room rail: my queue (with a quick-draft button on my turn), draft
 * order (with autodraft toggles), my roster, and pick history.
 *
 * `rosterView` is null before the first draft:state frame and for anyone
 * without a team in this league, which is also what keeps the roster section
 * out of the DOM for every existing DraftBoard test - none of their draft:state
 * payloads carry roster_slots. */
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
  picks,
  isXs,
  onOpenQuickView,
  rosterView = null,
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
  // Draft Order/My Roster/Pick History beneath it in that same narrow
  // column, so the caller passes a smaller bound for that region instead.
  queueMaxHeight = draftStatus === 'active' ? 'calc(100vh - 164px)' : '80vh',
}) {
  // "Which one of these is me" is the viewer-relative contract (#113): the
  // viewer's own Team ID, answered on the draft:join acknowledgement, against
  // each entry's Team ID. Never a comparison of account ids.
  const myTeam = viewerTeamId == null ? undefined : teams.find((team) => team.teamId === viewerTeamId);
  const readyCount = teams.filter((team) => team.draft_ready).length;
  const slotTags = rosterView ? rosterView.slotTags : null;

  // Stable heading ids for this instance, so each panel's Paper/section can be
  // named via aria-labelledby instead of duplicating its visible title text.
  const queueHeadingId = useId();
  const orderHeadingId = useId();
  const pickHistoryHeadingId = useId();
  const pickHistoryBody = (
    <Box sx={{ maxHeight: '600px', overflowY: 'auto' }}>
      {picks.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No picks yet
        </Typography>
      ) : (
        picks.map((pick) => (
          <Paper key={`${pick.pick_number}-${pick.player_id}`} sx={{ p: 1.5, mb: 1, bgcolor: 'action.hover' }}>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              #{pick.pick_number}
            </Typography>
            <Typography variant="body2">
              <PlayerNameLink name={pick.name} playerId={pick.player_id} onOpen={onOpenQuickView} sx={MIN_TOUCH_TARGET_SX} /> (
              {pick.position})
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {pick.nfl_team}
            </Typography>
            {slotTags && slotTags.has(pick.pick_number) && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                → {slotTags.get(pick.pick_number).slotLabel}
              </Typography>
            )}
            {/* Every Pick is attributed by Team (#113). Before the contract
                landed a Pick could not name its Team at all - its own `name`
                is the PLAYER's - so only picks that arrived live carried an
                attribution, and it was the picking manager's username.

                teamNameLabel is defensive here rather than load-bearing: the
                contract lets any LEFT-joined Team identity read back null,
                but a Pick's cannot today, because draft_picks.team_id is NOT
                NULL and cascades, so removing a team removes its picks
                outright. If that ever changes this renders a former manager
                instead of a blank line. */}
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              by {teamNameLabel(pick.teamName)}
              {pick.auto ? ' · AUTO' : ''}
            </Typography>
          </Paper>
        ))
      )}
    </Box>
  );

  return (
    <>
      <Paper
        component="section"
        aria-labelledby={queueHeadingId}
        sx={{
          p: 2,
          mb: 3,
          // Keep the queue reachable as Draft Order / Pick History push it
          // down the page. The offset when a draft is active clears
          // LiveDraftBanner, which is sticky above it at top: 0.
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

      {draftStatus === 'pending' && myTeam && (
        <Paper component="section" aria-label="Draft readiness" sx={{ p: 2, mb: 3 }}>
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
      )}

      {teams.length > 0 && (
        <Paper component="section" aria-labelledby={orderHeadingId} sx={{ p: 2, mb: 3 }}>
          <Typography id={orderHeadingId} variant="h6" component="h2" sx={{ mb: 0.5 }}>
            Draft Order
          </Typography>
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
        </Paper>
      )}

      {rosterView && (
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
      )}

      {isXs ? (
        // No component="section"/aria-labelledby on the Accordion root itself:
        // MUI's Accordion already builds its own role="region" internally,
        // labelled from summary.props.id (Accordion.js reads the FIRST
        // child's `id`, which is this wrapping Box, not AccordionSummary
        // itself) - adding a second one here would nest two identically-named
        // "Pick History" regions.
        <Accordion defaultExpanded={false}>
          {/* The WAI-ARIA accordion pattern: a heading wraps the trigger button
              rather than sitting inside it, so "Pick History" reads as a real
              H2 landmark title even while collapsed. */}
          <Box component="h2" id={pickHistoryHeadingId} sx={{ m: 0 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="h6" component="span">Pick History</Typography>
            </AccordionSummary>
          </Box>
          <AccordionDetails>{pickHistoryBody}</AccordionDetails>
        </Accordion>
      ) : (
        <Paper component="section" aria-labelledby={pickHistoryHeadingId} sx={{ p: 2 }}>
          <Typography id={pickHistoryHeadingId} variant="h6" component="h2" sx={{ mb: 2 }}>
            Pick History
          </Typography>
          {pickHistoryBody}
        </Paper>
      )}
    </>
  );
}

export default DraftRail;
