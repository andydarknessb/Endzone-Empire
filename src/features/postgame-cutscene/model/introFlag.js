/**
 * The one-time "NEW · TURN OFF IN SETTINGS" footer flag (per device). Unset
 * means the manager has not yet met the title card on this device; the title
 * card sets it the first time it shows. Guarded storage, as the sound key is:
 * a denied read reads as unset and a denied write is dropped.
 */
export const POSTGAME_INTRO_KEY = 'endzone_postgame_intro';

export function readPostgameIntroSeen() {
  try {
    return window.localStorage.getItem(POSTGAME_INTRO_KEY) !== null;
  } catch {
    return false;
  }
}

export function writePostgameIntroSeen() {
  try {
    window.localStorage.setItem(POSTGAME_INTRO_KEY, '1');
  } catch {
    // Dropped: the hint shows again next time, which is harmless.
  }
}
