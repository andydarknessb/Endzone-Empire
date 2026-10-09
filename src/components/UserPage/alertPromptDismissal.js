/**
 * The Alert prompt's per-device dismissal record (issue #2136 ruling 2):
 * how many times this device's Manager pressed Not now, and when last. It is a
 * browser-local convenience, so it lives in localStorage and never on the
 * server. Storage access is GUARDED, the same pattern as
 * src/lib/draftAssistantPreference.js: a denied read or write degrades to
 * "never dismissed" and the caller keeps the new value in React state.
 */
export const ALERT_PROMPT_KEY = 'endzone_alert_prompt';

const NEVER = { count: 0, at: 0 };

export function readAlertPromptDismissal() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ALERT_PROMPT_KEY));
    const count = Number(parsed && parsed.count);
    const at = Number(parsed && parsed.at);
    return count > 0 && Number.isFinite(at) ? { count, at } : NEVER;
  } catch {
    return NEVER;
  }
}

export function writeAlertPromptDismissal(dismissal) {
  try {
    window.localStorage.setItem(ALERT_PROMPT_KEY, JSON.stringify(dismissal));
  } catch {
    // A denied write cannot stop the dismissal: the card hides for this
    // session and simply comes back after a reload on this browser.
  }
}
