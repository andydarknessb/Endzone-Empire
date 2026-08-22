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
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import RosterPanel from '../RosterPanel/RosterPanel';
import RosterNeedsStrip from '../RosterPanel/RosterNeedsStrip';
import { touchTargetSx } from '../../lib/a11y';

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
  userId,
  draftStatus,
  onToggleAutodraft,
  onToggleReady,
  picks,
  isXs,
  onOpenQuickView,
  rosterView = null,
}) {
  const myTeam = teams.find((team) => team.owner_id === userId);
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
              <PlayerNameLink name={pick.name} playerId={pick.player_id} onOpen={onOpenQuickView} /> (
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
            {pick.by && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                by {pick.by.auto ? 'AUTO' : pick.by.username}
              </Typography>
            )}
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
          top: draftStatus === 'active' ? 148 : 16,
          zIndex: 2,
          maxHeight: draftStatus === 'active' ? 'calc(100vh - 164px)' : '80vh',
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
            const showQuickDraft = index === 0 && isMyTurn && !draftPaused;
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
                  ...(showQuickDraft ? { bgcolor: 'var(--accent-soft)', borderRadius: 1, p: 0.5 } : {}),
                }}
              >
                <Typography variant="body2">
                  {index + 1}. <PlayerNameLink name={player.name} playerId={player.id} onOpen={onOpenQuickView} /> (
                  {player.position})
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {showQuickDraft && (
                    <Button
                      variant="contained"
                      color="primary"
                      size="small"
                      onClick={() => onDraft(player.id)}
                      sx={{ minHeight: 44 }}
                    >
                      Draft
                    </Button>
                  )}
                  <IconButton
                    size="small"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => onMoveUp(index)}
                    sx={touchTargetSx}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="Move down"
                    disabled={index === queue.length - 1}
                    onClick={() => onMoveDown(index)}
                    sx={touchTargetSx}
                  >
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label="Remove from queue"
                    onClick={() => onRemoveFromQueue(index)}
                    sx={touchTargetSx}
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
            sx={{ minHeight: 44 }}
            control={<Switch checked={!!myTeam.draft_ready} onChange={(event) => onToggleReady(event.target.checked)} inputProps={{ 'aria-label': 'I am ready for the draft' }} />}
            label="I'm ready"
          />
          <Typography role="status" aria-live="polite" variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
            {readyCount} of {teams.length} managers ready
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {teams.map((team) => <Chip key={team.id} size="small" color={team.draft_ready ? 'success' : 'default'} label={`${team.name}: ${team.draft_ready ? 'Ready' : 'Not ready'}`} />)}
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
              const canToggle = (isCommissioner || team.owner_id === userId) && draftStatus !== 'complete';
              const onClock = onTheClock && onTheClock.id === team.id;
              return (
                <Box
                  key={team.id}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 44 }}
                >
                  <Typography variant="body2" sx={{ minWidth: 22, color: 'text.secondary' }}>
                    {team.draft_position != null ? `${team.draft_position}.` : '-'}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: onClock ? 'bold' : 'normal', flexGrow: 1 }}>
                    {team.name}
                    {onClock && ' ⏱'}
                  </Typography>
                  {team.autodraft && <Chip size="small" color="warning" label="AUTO" />}
                  {canToggle && (
                    <FormControlLabel
                      sx={{ m: 0, minHeight: 44 }}
                      labelPlacement="start"
                      control={
                        <Switch
                          size="small"
                          checked={!!team.autodraft}
                          onChange={(e) => onToggleAutodraft(team.id, e.target.checked)}
                          inputProps={{ 'aria-label': `Autodraft for ${team.name}` }}
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
        <Accordion component="section" aria-labelledby={pickHistoryHeadingId} defaultExpanded={false}>
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
