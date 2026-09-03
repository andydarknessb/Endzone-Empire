import React from 'react';
import { MEMBERSHIP_NON_MEMBER } from './draftMembership';
import PoliteRegion from './PoliteRegion';

/**
 * Announces the loss of League chat once, politely (#534, a11y finding 3).
 *
 * The non-member surface itself is NOT a live region (its Alert carries
 * role="presentation", following the #519 ruling on this room): it is persistent
 * and, on a narrow container, remounts on every Chat -> Players -> Chat tab
 * switch, so an assertive Alert would re-assert the notice each time. This
 * announcer supplies the missing voice, scoped to the TRANSITION rather than the
 * surface.
 *
 * It lives in the chrome every tab renders (like ReadinessAnnouncer and
 * PickAnnouncer), so a tab switch never unmounts it. Its text changes only on the
 * actual membership edge - empty until membership becomes NON_MEMBER, the notice
 * after - so assistive technology speaks it once when chat is lost and not again
 * while the viewer moves between tabs. Visually hidden and polite: the visible
 * surface already shows the same fact to sighted managers, so this exists purely
 * to be announced, and politely so it never interrupts the room's other speech.
 *
 * The copy matches the surface so the spoken and seen facts agree; it states an
 * availability rule (no em-dash, house style) rather than blaming the viewer.
 *
 * The span itself is the shared PoliteRegion leaf (#791, ADR 0028); this
 * component owns the mount, the membership edge and the text alone. There is no
 * repeat-safe idiom here - the message is derived from `membership` on every
 * render rather than repeated as a discrete event, so useAnnouncement has
 * nothing to guard.
 */
function DraftChatMembershipAnnouncer({ membership = null }) {
  const message = membership === MEMBERSHIP_NON_MEMBER
    ? 'League chat is available to league members only.'
    : '';
  return <PoliteRegion text={message} />;
}

export default DraftChatMembershipAnnouncer;
