import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import publicApiClient from '../../api/publicApiClient';
import {
  createSimDraft, applyPick, teamOnClock, isUserTurn, secondsLeft as secondsLeftOf,
} from '../../lib/draftSim/engine';
import { cpuPick, autoPickForUser, rngForState } from '../../lib/draftSim/cpuBrain';
import { analyzeDraft } from '../../lib/draftSim/analysis';
import { templateFor, draftablePositions } from '../../lib/draftSim/templates';
import { newSeed } from '../../lib/draftSim/rng';
import {
  loadSim, saveSim, clearSim, describeSavedSim,
} from '../../lib/draftSim/persistence';

/** How long a CPU "thinks" before its pick lands. Pure UI pacing — see engine.js. */
export const CPU_PICK_MS = 400;
/** Upper bound on localStorage writes during a run of CPU picks. */
export const SAVE_THROTTLE_MS = 1000;

const initialState = { sim: null, now: Date.now() };

/**
 * Every state transition of a mock draft. Deliberately a reducer over the pure
 * engine: each case is one `applyPick` (or a synchronous run of them), so the
 * hook never holds a stale copy of the board and the whole thing stays
 * replayable from the persisted state + seed.
 */
export function reducer(state, action) {
  switch (action.type) {
    case 'start':
      return { ...state, sim: action.sim, now: action.now };

    case 'userPick': {
      if (!state.sim || !isUserTurn(state.sim)) return state;
      const next = applyPick(state.sim, { playerId: action.playerId, now: action.now });
      return next === state.sim ? state : { ...state, sim: next, now: action.now };
    }

    case 'cpuPick': {
      const sim = state.sim;
      if (!sim || sim.status !== 'active' || isUserTurn(sim)) return state;
      const team = teamOnClock(sim);
      const playerId = cpuPick(sim, team.id, rngForState(sim));
      if (playerId == null) return state;
      return { ...state, sim: applyPick(sim, { playerId, now: action.now }), now: action.now };
    }

    // "Sim to my pick": apply every intervening CPU pick in ONE dispatch, so
    // React renders the jump once instead of animating twenty board updates.
    case 'simToUser': {
      let sim = state.sim;
      if (!sim) return state;
      let guard = 0;
      while (sim.status === 'active' && !isUserTurn(sim) && guard < 1000) {
        guard += 1;
        const team = teamOnClock(sim);
        const playerId = cpuPick(sim, team.id, rngForState(sim));
        if (playerId == null) break;
        sim = applyPick(sim, { playerId, now: action.now });
      }
      return sim === state.sim ? state : { ...state, sim, now: action.now };
    }

    // The user's clock ran out: the CPU brain picks for them, flagged `auto`.
    case 'autoPick': {
      const sim = state.sim;
      if (!sim || sim.status !== 'active' || !isUserTurn(sim)) return state;
      const team = teamOnClock(sim);
      const playerId = autoPickForUser(sim, team.id, rngForState(sim));
      if (playerId == null) return state;
      return { ...state, sim: applyPick(sim, { playerId, auto: true, now: action.now }), now: action.now };
    }

    case 'tick':
      return state.now === action.now ? state : { ...state, now: action.now };

    case 'reset':
      return { ...initialState, now: action.now };

    default:
      return state;
  }
}

/**
 * Owns a client-side mock draft end to end: the player-pool fetch, the sim
 * state machine, CPU pacing, the pick clock, resume-from-localStorage, and the
 * finished report.
 *
 * Auth-free by construction — the only network call is the unauthenticated
 * /api/public/draft-pool via publicApiClient, which is why the same hook serves
 * both the public page and the logged-in one.
 */
export default function useDraftSim() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [poolState, setPoolState] = useState({ loading: false, error: false });
  const [savedSummary, setSavedSummary] = useState(null);
  const savedSimRef = useRef(null);

  // Offer to resume an in-progress draft found in storage (once, on mount).
  useEffect(() => {
    const restored = loadSim({ now: Date.now() });
    if (restored) {
      savedSimRef.current = restored;
      setSavedSummary(describeSavedSim(restored));
    }
  }, []);

  const sim = state.sim;
  const phase = !sim ? 'config' : sim.status === 'complete' ? 'report' : 'room';
  const myTurn = !!sim && isUserTurn(sim);
  const remaining = sim ? secondsLeftOf(sim, state.now) : null;

  // One always-on 1s tick (the useDraftSocket idiom): the reducer keeps the
  // wall clock, every countdown derives from it.
  useEffect(() => {
    const interval = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 1000);
    return () => clearInterval(interval);
  }, []);

  // CPU pacing. One timer per CPU turn, cleared on every state change so a
  // "sim to my pick" jump can't leave a stray pick queued behind it.
  useEffect(() => {
    if (!sim || sim.status !== 'active' || isUserTurn(sim)) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'cpuPick', now: Date.now() }), CPU_PICK_MS);
    return () => clearTimeout(timer);
  }, [sim]);

  // Clock expiry -> autopick for the user.
  useEffect(() => {
    if (!sim || sim.status !== 'active' || !sim.deadline) return;
    if (state.now < sim.deadline) return;
    dispatch({ type: 'autoPick', now: Date.now() });
  }, [sim, state.now]);

  // Throttled persistence: leading-edge write, then a trailing one so the last
  // pick of a burst is never the one that gets dropped.
  const lastSaveRef = useRef(0);
  useEffect(() => {
    if (!sim) return undefined;
    if (sim.status !== 'active') {
      clearSim();
      return undefined;
    }
    const elapsed = Date.now() - lastSaveRef.current;
    if (elapsed >= SAVE_THROTTLE_MS) {
      lastSaveRef.current = Date.now();
      saveSim(sim);
      return undefined;
    }
    const timer = setTimeout(() => {
      lastSaveRef.current = Date.now();
      saveSim(sim);
    }, SAVE_THROTTLE_MS - elapsed);
    return () => clearTimeout(timer);
  }, [sim]);

  const start = useCallback(async (config) => {
    const template = templateFor(config.leagueType);
    setPoolState({ loading: true, error: false });
    try {
      const response = await publicApiClient.get('/api/public/draft-pool', {
        params: template.needsIdp ? { idp: 1 } : {},
      });
      const allowed = draftablePositions(template);
      const players = (response.data.players || []).filter((p) => allowed.has(p.position));
      if (players.length === 0) throw new Error('empty draft pool');
      setPoolState({ loading: false, error: false });
      savedSimRef.current = null;
      setSavedSummary(null);
      clearSim();
      dispatch({
        type: 'start',
        now: Date.now(),
        sim: createSimDraft(config, players, { now: Date.now(), seed: newSeed() }),
      });
    } catch {
      setPoolState({ loading: false, error: true });
    }
  }, []);

  const resume = useCallback(() => {
    if (!savedSimRef.current) return;
    dispatch({ type: 'start', sim: savedSimRef.current, now: Date.now() });
    setSavedSummary(null);
  }, []);

  const discardSaved = useCallback(() => {
    savedSimRef.current = null;
    setSavedSummary(null);
    clearSim();
  }, []);

  const draftPlayer = useCallback((playerId) => {
    dispatch({ type: 'userPick', playerId, now: Date.now() });
  }, []);

  const simToMyPick = useCallback(() => {
    dispatch({ type: 'simToUser', now: Date.now() });
  }, []);

  const restart = useCallback(() => {
    clearSim();
    savedSimRef.current = null;
    setSavedSummary(null);
    dispatch({ type: 'reset', now: Date.now() });
  }, []);

  const report = useMemo(
    () => (sim && sim.status === 'complete' ? analyzeDraft(sim) : null),
    [sim]
  );

  return {
    sim,
    phase,
    myTurn,
    secondsLeft: remaining,
    onTheClock: sim ? teamOnClock(sim) : null,
    report,
    poolLoading: poolState.loading,
    poolError: poolState.error,
    savedSummary,
    start,
    resume,
    discardSaved,
    draftPlayer,
    simToMyPick,
    restart,
  };
}
