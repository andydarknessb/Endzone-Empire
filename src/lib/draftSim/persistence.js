/**
 * localStorage persistence for an in-progress mock draft.
 *
 * The Draft Simulator is deliberately server-free (nothing about a mock draft
 * belongs in a shared database), so "don't lose my draft when I refresh" is
 * this file's whole job. Everything is version-checked and try/catch-wrapped:
 * a Safari private-mode quota error, a disabled-storage browser, or a stale
 * v1 blob after a schema change must all degrade to "no saved draft", never to
 * a thrown error on page load.
 */
import { STATE_VERSION, rearmDeadline } from './engine';

export const SIM_STORAGE_KEY = 'endzone:draftSim:v1';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null; // storage access itself can throw under strict privacy modes
  }
}

/** Persist a sim. Returns true when it actually landed. */
export function saveSim(state) {
  const store = storage();
  if (!store || !state) return false;
  try {
    store.setItem(SIM_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false; // quota / private mode — the draft keeps running in memory
  }
}

/**
 * Load the saved sim, or null when there isn't a usable one. A version
 * mismatch, malformed JSON, a finished draft, or a structurally wrong blob all
 * return null rather than half-restoring a broken draft.
 *
 * A restored draft whose clock expired while the tab was closed gets its
 * deadline RE-ARMED from `now`: you shouldn't come back to a mock draft and
 * find it already auto-picked for you.
 */
export function loadSim({ now = Date.now() } = {}) {
  const store = storage();
  if (!store) return null;
  let raw;
  try {
    raw = store.getItem(SIM_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.version !== STATE_VERSION) return null;
  if (!parsed.config || !Array.isArray(parsed.teams) || !Array.isArray(parsed.players)
    || !Array.isArray(parsed.picks)) {
    return null;
  }
  if (parsed.status !== 'active') return null;

  try {
    return rearmDeadline(parsed, now);
  } catch {
    return null;
  }
}

/** Forget the saved sim (restart / finish). Never throws. */
export function clearSim() {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(SIM_STORAGE_KEY);
  } catch {
    /* nothing to do — a sim we cannot clear is a sim we also cannot read back */
  }
}

/** A one-line summary of a saved draft, for the "resume?" banner. */
export function describeSavedSim(state) {
  if (!state) return null;
  const totalTeams = state.teams.length;
  const round = Math.ceil(Math.min(state.currentPick, state.totalPicks) / totalTeams);
  return {
    totalTeams,
    leagueType: state.config.leagueType,
    round,
    rounds: state.rounds,
    pickNumber: Math.min(state.currentPick, state.totalPicks),
    updatedAt: state.updatedAt,
  };
}
