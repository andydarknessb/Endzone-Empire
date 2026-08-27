/**
 * The Draft room's optional on-the-clock sound preference (#445 AC6).
 *
 * PER DEVICE, by design: this is a browser-local convenience, not an account
 * setting, so it lives in localStorage and never on the server (no column, no
 * endpoint) - a manager who wants the chime on their laptop but not their phone
 * is expressing a per-device choice, and the account carries nothing about it.
 *
 * OFF unless explicitly enabled: only the exact stored string "1" reads as on,
 * so a fresh device (nothing stored) and any other value are both off.
 *
 * Storage access is GUARDED. Reading or writing localStorage throws in a private
 * window, when a browser is configured to deny site data, or during some
 * embedded contexts; the preference must degrade to "off" rather than break the
 * Draft room (AC6 says the preference persists, not that the room fails when it
 * cannot). The previous inline calls in DraftBoard were unguarded; this module
 * is the one hardened home so the read and the write cannot drift.
 */
export const DRAFT_SOUND_KEY = 'endzone_draft_sound';

export function readDraftSoundOn() {
  try {
    return window.localStorage.getItem(DRAFT_SOUND_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeDraftSoundOn(on) {
  try {
    window.localStorage.setItem(DRAFT_SOUND_KEY, on ? '1' : '0');
  } catch {
    // A denied write cannot stop the toggle: the caller keeps the new value in
    // React state for this session, it just will not survive a reload here.
  }
}
