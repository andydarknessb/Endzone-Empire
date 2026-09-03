/**
 * How long, in ms, a Draft assistant selection line waits before another of
 * its kind can fire. One owner for both venues (issue #817): the Draft Sim's
 * POOL_PLAYER_TAKEN line (CPU picks land every CPU_PICK_MS = 400ms in
 * useDraftSim.js, so without a floor the panel prints a line for nearly every
 * pick) and the Draft room's pool-selection line (a manager clicking down a
 * shortlist would otherwise draw a line per click). Comfortably above one CPU
 * pacing tick, short enough that either panel still reads live.
 *
 * Previously declared twice, in DraftSim/simAssistantFacts.js and
 * DraftBoard/DraftRoomAssistant.jsx, with no parity between them.
 */
export const SELECTION_COOLDOWN_MS = 4000;
