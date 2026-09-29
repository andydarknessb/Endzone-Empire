/**
 * The Postgame cutscene's per-device sound preference (ADR 0052). Like the
 * Draft room's chime (`draftSoundPreference`), it is a browser-local choice, not
 * an account setting: it lives in localStorage and never on the server.
 *
 * The polarity is the reverse of the Draft room's: the sound is ON unless the
 * exact stored string is "0", so a fresh device and any other value are on.
 *
 * Storage access is GUARDED: it throws in a private window or when a browser
 * denies site data, and the cutscene must degrade to the default rather than
 * break Home.
 */
export const POSTGAME_SOUND_KEY = 'endzone_postgame_sound';

export function readPostgameSoundOn() {
  try {
    return window.localStorage.getItem(POSTGAME_SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writePostgameSoundOn(on) {
  try {
    window.localStorage.setItem(POSTGAME_SOUND_KEY, on ? '1' : '0');
  } catch {
    // A denied write cannot stop the toggle: the caller keeps the new value in
    // React state for this session, it just will not survive a reload here.
  }
}
