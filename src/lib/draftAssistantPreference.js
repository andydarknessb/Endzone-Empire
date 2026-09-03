/**
 * The Draft assistant's optional per-device toggle (issue #784 ruling 11,
 * issue #786): whether the Polk High Legend voice speaks at all, in the Draft
 * Sim (#786) and the Draft room (#787) alike. This module is the ONE shared
 * home both venues import so a manager's choice cannot drift between them on
 * one device - copied from src/components/DraftBoard/draftSoundPreference.js
 * (#445 AC6) including its storage guards, per the parent ticket's
 * copy-the-pattern ruling. draftSoundPreference.js itself is untouched.
 *
 * PER DEVICE, by design: this is a browser-local convenience, not an account
 * setting, so it lives in localStorage and never on the server (no column, no
 * endpoint, no migration per ruling 11).
 *
 * OFF unless explicitly enabled: only the exact stored string "1" reads as on,
 * so a fresh device (nothing stored) and any other value are both off.
 *
 * Storage access is GUARDED. Reading or writing localStorage throws in a
 * private window, when a browser is configured to deny site data, or during
 * some embedded contexts; the preference must degrade to "off" rather than
 * break either venue.
 */
export const DRAFT_ASSISTANT_KEY = 'endzone_draft_assistant';

export function readDraftAssistantOn() {
  try {
    return window.localStorage.getItem(DRAFT_ASSISTANT_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDraftAssistantOn(on) {
  try {
    window.localStorage.setItem(DRAFT_ASSISTANT_KEY, on ? '1' : '0');
  } catch {
    // A denied write cannot stop the toggle: the caller keeps the new value in
    // React state for this session, it just will not survive a reload here.
  }
}
