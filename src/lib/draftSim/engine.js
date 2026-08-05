/**
 * The Draft Simulator's state machine: a pure, immutable snake-draft engine.
 *
 * SYNC OBLIGATION (repo convention — see src/lib/positionCapsFeasibility.js):
 *   - Turn order lives in src/lib/draftTurns.js, the client's single mirror of
 *     the server's order math. `teamIndexForPick` and `picksRemainingFor` below
 *     are thin snake-only delegates, kept because callers and tests use them.
 *   - The clock semantics mirror `nextPickClockSeconds` in
 *     server/services/draft.service.js: a deadline is a stored fact only for a
 *     turn that can actually time out. CPU pacing is a UI animation, never a
 *     stored deadline, so a mock draft left open in a background tab doesn't
 *     "expire" a hundred CPU picks.
 *
 * Everything here is a pure function over a plain-JSON state object, so the
 * whole draft round-trips through localStorage (persistence.js) and every rule
 * is unit-testable without React.
 */
import { mulberry32 } from './rng';
import { templateFor, roundsForTemplate, slotEligible } from './templates';
import {
  teamIndexForPick as turnTeamIndexForPick,
  remainingPickNumbersFor,
} from '../draftTurns';

export const STATE_VERSION = 1;

export const MIN_TEAMS = 4;
export const MAX_TEAMS = 14;
export const CLOCK_OPTIONS = [0, 30, 60, 90];

/**
 * Snake-draft order: which team index picks at pick number n (0-based).
 * The sim has no linear or override mode, so this pins the rotation and defers
 * the math to src/lib/draftTurns.js.
 */
export function teamIndexForPick(pickNumber, teamCount) {
  return turnTeamIndexForPick(pickNumber, teamCount, { rotation: 'snake' });
}

function clampInt(value, min, max, fallback) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Normalize a raw config object into the shape state stores. */
export function normalizeConfig(config = {}) {
  const totalTeams = clampInt(config.totalTeams, MIN_TEAMS, MAX_TEAMS, 10);
  const template = templateFor(config.leagueType);
  const clockSeconds = CLOCK_OPTIONS.includes(Number(config.clockSeconds))
    ? Number(config.clockSeconds)
    : 60;
  const userSlot = config.userSlot === 'random'
    ? 'random'
    : clampInt(config.userSlot, 1, totalTeams, 1);
  return { totalTeams, userSlot, leagueType: template.id, clockSeconds };
}

/**
 * Pure: the deadline (epoch ms) for the pick at `state.currentPick`, or null.
 * Only a live user turn under a running clock gets one.
 */
export function deadlineFor(state, now) {
  if (state.status !== 'active') return null;
  if (!(state.config.clockSeconds > 0)) return null;
  const team = teamOnClock(state);
  if (!team || !team.isUser) return null;
  return now + state.config.clockSeconds * 1000;
}

/**
 * Build a fresh sim. `players` is the serialized draft pool from
 * GET /api/public/draft-pool (already position-appropriate for the template).
 */
export function createSimDraft(config, players, { now = Date.now(), seed = 1 } = {}) {
  const normalized = normalizeConfig(config);
  const template = templateFor(normalized.leagueType);
  const rounds = roundsForTemplate(template);
  const rng = mulberry32(seed);

  const userSlot = normalized.userSlot === 'random'
    ? 1 + Math.floor(rng() * normalized.totalTeams)
    : normalized.userSlot;

  const teams = Array.from({ length: normalized.totalTeams }, (_, i) => {
    const slot = i + 1;
    const isUser = slot === userSlot;
    return { id: slot, slot, name: isUser ? 'You' : `Team ${slot}`, isUser };
  });

  const state = {
    version: STATE_VERSION,
    config: { ...normalized, userSlot },
    seed,
    rounds,
    totalPicks: rounds * normalized.totalTeams,
    teams,
    players,
    picks: [],
    currentPick: 1,
    deadline: null,
    status: 'active',
    startedAt: now,
    updatedAt: now,
  };
  return { ...state, deadline: deadlineFor(state, now) };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/** The team whose turn it is, or null once the draft is complete. */
export function teamOnClock(state) {
  if (!state || state.status !== 'active') return null;
  const index = teamIndexForPick(state.currentPick - 1, state.teams.length);
  return state.teams[index] || null;
}

export function isUserTurn(state) {
  const team = teamOnClock(state);
  return !!(team && team.isUser);
}

export function userTeam(state) {
  return state.teams.find((t) => t.isUser) || null;
}

/** 1-based round of the pick currently on the clock (or the last one). */
export function currentRound(state) {
  const pick = Math.min(state.currentPick, state.totalPicks);
  return Math.ceil(pick / state.teams.length);
}

/** Round a given 1-based pick number falls in. */
export function roundOfPick(state, pickNumber) {
  return Math.ceil(pickNumber / state.teams.length);
}

/** Set of already-drafted player ids. */
export function draftedIds(state) {
  return new Set(state.picks.map((p) => p.playerId));
}

export function availablePlayers(state) {
  const taken = draftedIds(state);
  return state.players.filter((p) => !taken.has(p.playerId));
}

/** Player rows drafted by one team, in pick order. */
export function rosterFor(state, teamId) {
  const byId = new Map(state.players.map((p) => [p.playerId, p]));
  return state.picks
    .filter((pick) => pick.teamId === teamId)
    .map((pick) => ({ ...byId.get(pick.playerId), pickNumber: pick.pickNumber, auto: pick.auto }))
    .filter((p) => p.playerId != null);
}

/** True when this player can legally be taken right now. */
export function canPick(state, playerId) {
  if (!state || state.status !== 'active') return false;
  if (!state.players.some((p) => p.playerId === playerId)) return false;
  return !draftedIds(state).has(playerId);
}

/**
 * Apply one pick. Immutable: returns a NEW state, or the SAME state object
 * (identity) when the pick is not legal — an already-drafted player, an id
 * outside the pool, or a completed draft. Callers can treat an unchanged
 * reference as "rejected" without needing a try/catch in a reducer.
 */
export function applyPick(state, { playerId, auto = false, now = Date.now() } = {}) {
  if (!canPick(state, playerId)) return state;

  const pick = {
    pickNumber: state.currentPick,
    teamId: teamOnClock(state).id,
    playerId,
    auto: !!auto,
  };
  const nextPick = state.currentPick + 1;
  const complete = nextPick > state.totalPicks;

  const next = {
    ...state,
    picks: [...state.picks, pick],
    currentPick: complete ? state.totalPicks + 1 : nextPick,
    status: complete ? 'complete' : 'active',
    updatedAt: now,
    deadline: null,
  };
  return { ...next, deadline: deadlineFor(next, now) };
}

/** Re-arm the clock relative to `now` (used when resuming a persisted sim). */
export function rearmDeadline(state, now = Date.now()) {
  const deadline = deadlineFor(state, now);
  if (deadline === state.deadline) return state;
  return { ...state, deadline };
}

/** Seconds left on the current pick, or null when nothing is timed. */
export function secondsLeft(state, now = Date.now()) {
  if (!state || !state.deadline) return null;
  return Math.max(0, Math.floor((state.deadline - now) / 1000));
}

/**
 * A team's remaining unfilled DEDICATED starting slots (single-position slots),
 * as a Map slotKey -> count. Drives both the CPU's must-fill guard and the
 * report's position-balance minimums.
 */
export function unfilledDedicatedSlots(state, teamId) {
  const template = templateFor(state.config.leagueType);
  const roster = rosterFor(state, teamId);
  const remaining = new Map();
  const used = new Set();
  for (const slot of template.slots) {
    if ((slot.eligiblePositions || []).length !== 1) continue;
    let filled = 0;
    for (const player of roster) {
      if (used.has(player.playerId)) continue;
      if (filled >= slot.count) break;
      if (slotEligible(slot.key, player.position, template.slots)) {
        used.add(player.playerId);
        filled += 1;
      }
    }
    if (filled < slot.count) remaining.set(slot.key, slot.count - filled);
  }
  return remaining;
}

/** Picks a team still has coming, including the one on the clock. */
export function picksRemainingFor(state, teamId) {
  return remainingPickNumbersFor({
    teamId,
    teamIds: state.teams.map((team) => team.id),
    // The one place the sim's 1-based currentPick becomes a 0-based cursor.
    fromPick0: state.currentPick - 1,
    totalPicks: state.totalPicks,
    rotation: 'snake',
  }).length;
}

/**
 * Adapt sim state to the props DraftBoardMatrix already speaks (the server's
 * snake_case pick shape). Picks come back newest-first, matching the live draft
 * room, so the matrix's landing flash fires on the right cell.
 */
export function toBoardShape(state) {
  const byId = new Map(state.players.map((p) => [p.playerId, p]));
  const picks = state.picks
    .map((pick) => {
      const player = byId.get(pick.playerId) || {};
      return {
        pick_number: pick.pickNumber,
        team_id: pick.teamId,
        player_id: pick.playerId,
        name: player.name || 'Unknown player',
        position: player.position || null,
        nfl_team: player.nflTeam || null,
      };
    })
    .reverse();

  const onClock = teamOnClock(state);
  return {
    teams: state.teams.map((team) => ({ id: team.id, name: team.name, draft_position: team.slot })),
    picks,
    onTheClock: onClock ? { id: onClock.id, name: onClock.name } : null,
    rosterLimit: state.rounds,
  };
}
