import React from 'react';
import { readinessSummaryFor } from './readinessSummary';
import { railCompositionFor, RAIL_PANELS } from './railComposition';
import PoliteRegion from './PoliteRegion';

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
 * refactor from folding it back into a branch. The span itself is the shared
 * PoliteRegion leaf (#791, ADR 0028); this component owns the mount condition
 * and the text, never the leaf.
 *
 * Visually hidden, following CountdownAnnouncer (#117): the rail still shows
 * the sentence to sighted managers, without a live region of its own, and
 * this exists purely to be announced. There is no repeat-safe idiom here -
 * unlike PickAnnouncer, StallAnnouncer and FeedAnnouncer, this text is DERIVED
 * from `teams` on every render rather than repeated as a discrete event, so
 * useAnnouncement has nothing to guard and this renders PoliteRegion directly.
 *
 * Mounted for as long as the room has readiness to announce, rather than
 * literally forever. The two conditions are the panel's own: WHICH statuses
 * have a Readiness panel at all is `railCompositionFor` and nothing else
 * (issue #123 - that module declares itself the single statement of the
 * rule, so this asks it rather than restating "pending" and drifting from
 * it), and the panel additionally renders only for a viewer who holds a
 * Team, since readiness is a declaration about a Team. A region kept mounted
 * through an active draft could never speak, and would sit beside
 * LiveDraftBanner's own status region saying nothing.
 *
 * What matters for this issue is that neither condition reads anything
 * tab-derived, so no tab switch can unmount this. The mount edges it does
 * have - draft status and Team membership - are page-level facts a manager
 * crosses once, not something they cross every time they look at the board.
 *
 * That is NOT a claim that nothing else can remount this. Issue #216 is one
 * that does: DraftBoard early-returns a page skeleton for the whole room
 * while loading, and useDraftQueue's persistQueue calls fetchQueue from its
 * catch, which sets loading true - so a failed queue write unmounts and
 * rebuilds this region, which is #164's own failure mode reached through a
 * different door. It blanks the entire draft room, so it is filed and fixed
 * there rather than worked around here.
 */
function ReadinessAnnouncer({ teams = [], viewerTeamId = null, draftStatus = null }) {
  const roomHasReadiness = railCompositionFor(draftStatus).includes(RAIL_PANELS.READINESS);
  const holdsTeam = viewerTeamId != null && teams.some((team) => team.teamId === viewerTeamId);
  if (!roomHasReadiness || !holdsTeam) return null;

  // Derived from the ready count and the team count and nothing else, so a
  // socket frame that carries neither renders the identical string and React
  // leaves the text node untouched - no announcement per snapshot tick.
  const { countText } = readinessSummaryFor(teams);

  return <PoliteRegion text={countText} />;
}

export default ReadinessAnnouncer;
