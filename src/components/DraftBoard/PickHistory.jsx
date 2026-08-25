import React, { useId, useMemo } from 'react';
import { Paper, Box, Typography, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';
import { teamNameLabel } from '../../lib/teamIdentity';

/**
 * The chronological view of a draft's committed Picks (issue #123 acceptance
 * criterion 5).
 *
 * This used to be a rail panel sitting under My Roster in every draft status,
 * where a completed draft's whole history competed with the live decisions
 * above it. It belongs to the Board instead: the Draft board is the
 * team-by-round matrix of committed picks, and Pick history is the
 * chronological view of THOSE SAME picks, not another draft board
 * (CONTEXT.md: Draft board). Both are handed the one `picks` array the socket
 * maintains, so the two views cannot disagree about what was drafted.
 *
 * Collapsible, so it is a view within Board rather than a second panel
 * pushing the matrix off screen.
 */
function PickHistory({
  picks,
  onOpenQuickView,
  // Which roster slot each of the VIEWER's own picks filled, keyed by pick
  // number (see rosterViewFor in DraftBoard.jsx). Other Teams' picks are
  // absent from it, which is why a lookup miss renders nothing rather than
  // an empty tag: this viewer's roster is the only one it describes.
  slotTags = null,
  defaultExpanded = false,
}) {
  const headingId = useId();

  // useDraftSocket's reducer keeps picks newest-first, which is what the live
  // rail wanted. Chronological is the other direction, and a copy is sorted
  // rather than the caller's array, which the Board's matrix is reading at
  // the same time.
  const chronological = useMemo(
    () => [...picks].sort((a, b) => a.pick_number - b.pick_number),
    [picks]
  );

  const body = (
    <Box sx={{ maxHeight: '600px', overflowY: 'auto' }}>
      {chronological.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          No picks yet
        </Typography>
      ) : (
        chronological.map((pick) => (
          <Paper
            key={`${pick.pick_number}-${pick.player_id}`}
            data-testid="pick-history-entry"
            data-pick-number={pick.pick_number}
            sx={{ p: 1.5, mb: 1, bgcolor: 'action.hover' }}
          >
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
            {/* Every Pick is attributed by Team (#113). teamNameLabel is
                defensive here rather than load-bearing: the contract lets any
                LEFT-joined Team identity read back null, but a Pick's cannot
                today, because draft_picks.team_id is NOT NULL and cascades,
                so removing a team removes its picks outright. If that ever
                changes this renders a former manager instead of a blank
                line. */}
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
    // No component="section"/aria-labelledby on the Accordion root itself:
    // MUI's Accordion already builds its own role="region" internally,
    // labelled from the FIRST child's `id` (this wrapping Box, not
    // AccordionSummary) - adding a second one here would nest two identically
    // named "Pick history" regions.
    <Accordion defaultExpanded={defaultExpanded} sx={{ mt: 2 }}>
      {/* The WAI-ARIA accordion pattern: a heading wraps the trigger button
          rather than sitting inside it, so "Pick history" reads as a real H2
          landmark title even while collapsed. */}
      <Box component="h2" id={headingId} sx={{ m: 0 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6" component="span">Pick history</Typography>
        </AccordionSummary>
      </Box>
      <AccordionDetails>{body}</AccordionDetails>
    </Accordion>
  );
}

export default PickHistory;
