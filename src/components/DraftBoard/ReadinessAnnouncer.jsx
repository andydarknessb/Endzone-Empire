import React from 'react';
import { Box } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { readinessSummaryFor } from './readinessSummary';

/**
 * The Draft room's readiness announcement (issue #164), separate from the
 * rail that shows the count.
 *
 * Assistive technology announces CHANGES to a live region it is already
 * observing. A region inserted into the DOM already containing its text is
 * generally not announced at all, and the exact behaviour differs between
 * VoiceOver, NVDA and JAWS - which is precisely why the region must not be
 * mounted and unmounted underneath the reader. Below the medium breakpoint
 * the Draft room mounts one region per tab (issue #122 / PR #158), so while
 * the count lived inside DraftRail every tab switch destroyed the region and
 * built a new one: the next real readiness change could land on a region
 * nothing had been observing, and the mount itself could re-announce a count
 * that had not moved. Desktop was not immune either - the Board tab of a
 * draft that is not complete renders no rail at all.
 *
 * The fix is structural and does not depend on which screen reader is in use:
 * one region, mounted by the Draft room itself outside every tab branch, with
 * only its text changing. That is why this is a component of its own rather
 * than a `<Box>` inline in DraftBoard - the thing being asserted about it is
 * that it is one persistent node, and a named component is what keeps a later
 * refactor from folding it back into a branch.
 *
 * Visually hidden, following CountdownAnnouncer (#117): the rail still shows
 * the sentence to sighted managers, without a live region of its own, and
 * this exists purely to be announced.
 *
 * Mounted for the pending lobby rather than literally forever. Readiness is a
 * fact of the pending draft and has no meaning once picking starts
 * (CONTEXT.md: Readiness; railComposition.js composes it into `pending`
 * alone), and the panel it mirrors renders only for a viewer who holds a
 * Team, since readiness is a declaration about a Team. A region kept mounted
 * through an active draft could never speak, and would sit beside
 * LiveDraftBanner's own status region saying nothing. What matters for this
 * issue is that nothing about the mount depends on the selected tab: the
 * remaining mount/unmount edges are draft-status and Team-membership changes,
 * which are page-level facts a manager changes once, not something they cross
 * every time they look at the board.
 */
function ReadinessAnnouncer({ teams = [], viewerTeamId = null, draftStatus = null }) {
  const holdsTeam = viewerTeamId != null && teams.some((team) => team.teamId === viewerTeamId);
  if (draftStatus !== 'pending' || !holdsTeam) return null;

  // Derived from the ready count and the team count and nothing else, so a
  // socket frame that carries neither renders the identical string and React
  // leaves the text node untouched - no announcement per snapshot tick.
  const { countText } = readinessSummaryFor(teams);

  return (
    <Box component="span" role="status" aria-live="polite" sx={visuallyHidden}>
      {countText}
    </Box>
  );
}

export default ReadinessAnnouncer;
