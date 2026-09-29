/**
 * The per-session guard: the Matchup ids whose cutscene has started this
 * browser session, in sessionStorage. A refresh (or a return to Home) inside
 * the same session filters them out of the list, so a cutscene the manager
 * already dismissed never replays before the server's seen record catches up.
 * Guarded storage: a denied read is an empty set, a denied write is dropped.
 */
export const POSTGAME_STARTED_KEY = 'endzone_postgame_started';

export function readStartedIds() {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(POSTGAME_STARTED_KEY));
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

export function recordStartedIds(ids) {
  try {
    const merged = [...new Set([...readStartedIds(), ...ids.map(Number)])];
    window.sessionStorage.setItem(POSTGAME_STARTED_KEY, JSON.stringify(merged));
  } catch {
    // Dropped: the server's seen POST is the durable record.
  }
}

/** The list without the Matchups already started this session. */
export function withoutStarted(cutscenes) {
  const started = new Set(readStartedIds());
  return cutscenes.filter((c) => !started.has(Number(c.matchupId)));
}
