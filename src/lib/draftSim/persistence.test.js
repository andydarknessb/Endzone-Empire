import { saveSim, loadSim, clearSim, describeSavedSim, SIM_STORAGE_KEY } from './persistence';
import { createSimDraft, applyPick } from './engine';
import { tinyPool } from './simFixtures';

const NOW = 1_800_000_000_000;

function sim(overrides = {}) {
  return createSimDraft(
    { totalTeams: 4, userSlot: 1, leagueType: 'standard', clockSeconds: 60, ...overrides },
    tinyPool(),
    { now: NOW, seed: 4242 }
  );
}

afterEach(() => {
  window.localStorage.clear();
  jest.restoreAllMocks();
});

describe('saveSim / loadSim round trip', () => {
  it('restores an in-progress draft byte for byte (bar the re-armed clock)', () => {
    const state = applyPick(sim({ userSlot: 2 }), { playerId: 1, now: NOW });
    expect(saveSim(state)).toBe(true);

    const restored = loadSim({ now: NOW });
    expect(restored).toEqual(state);
    expect(restored.seed).toBe(4242);
    expect(restored.picks).toHaveLength(1);
  });

  it('writes under the versioned key', () => {
    saveSim(sim());
    expect(window.localStorage.getItem(SIM_STORAGE_KEY)).toContain('"version":1');
  });

  it('returns null when nothing is saved', () => {
    expect(loadSim({ now: NOW })).toBeNull();
  });

  it('clears the saved draft', () => {
    saveSim(sim());
    clearSim();
    expect(loadSim({ now: NOW })).toBeNull();
  });
});

describe('resuming a stale draft', () => {
  it('re-arms an expired user clock from now instead of auto-picking on load', () => {
    const state = sim({ userSlot: 1, clockSeconds: 60 });
    saveSim(state);

    const muchLater = NOW + 86_400_000;
    const restored = loadSim({ now: muchLater });
    expect(restored.deadline).toBe(muchLater + 60_000);
  });

  it('leaves an untimed draft unarmed on resume', () => {
    saveSim(sim({ clockSeconds: 0 }));
    expect(loadSim({ now: NOW + 999_999 }).deadline).toBeNull();
  });

  it('does not arm a clock when a CPU is on the clock', () => {
    saveSim(sim({ userSlot: 3, clockSeconds: 60 }));
    expect(loadSim({ now: NOW + 5000 }).deadline).toBeNull();
  });
});

describe('refusing to restore bad data', () => {
  it('drops a state saved under a different engine version', () => {
    window.localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify({ ...sim(), version: 99 }));
    expect(loadSim({ now: NOW })).toBeNull();
  });

  it('drops malformed JSON', () => {
    window.localStorage.setItem(SIM_STORAGE_KEY, '{not json');
    expect(loadSim({ now: NOW })).toBeNull();
  });

  it('drops a structurally incomplete blob', () => {
    window.localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify({ version: 1, config: {} }));
    expect(loadSim({ now: NOW })).toBeNull();
  });

  it('drops a finished draft — there is nothing to resume', () => {
    const done = { ...sim(), status: 'complete' };
    window.localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(done));
    expect(loadSim({ now: NOW })).toBeNull();
  });

  it('drops a non-object payload', () => {
    window.localStorage.setItem(SIM_STORAGE_KEY, '"just a string"');
    expect(loadSim({ now: NOW })).toBeNull();
  });
});

describe('storage failures never throw', () => {
  it('survives a quota error on write', () => {
    jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(saveSim(sim())).toBe(false);
  });

  it('survives a blocked read', () => {
    jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(loadSim({ now: NOW })).toBeNull();
  });

  it('survives a blocked remove', () => {
    jest.spyOn(window.localStorage.__proto__, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearSim()).not.toThrow();
  });

  it('does nothing when there is no state to save', () => {
    expect(saveSim(null)).toBe(false);
  });
});

describe('describeSavedSim', () => {
  it('summarizes a saved draft for the resume banner', () => {
    let state = sim({ totalTeams: 4, leagueType: 'superflex' });
    state = applyPick(state, { playerId: 1, now: NOW });
    state = applyPick(state, { playerId: 2, now: NOW });
    state = applyPick(state, { playerId: 3, now: NOW });
    state = applyPick(state, { playerId: 4, now: NOW });
    state = applyPick(state, { playerId: 5, now: NOW });

    expect(describeSavedSim(state)).toEqual({
      totalTeams: 4,
      leagueType: 'superflex',
      round: 2,
      rounds: 16,
      pickNumber: 6,
      updatedAt: NOW,
    });
  });

  it('returns null without a state', () => {
    expect(describeSavedSim(null)).toBeNull();
  });
});
