import { sfx, setSfx, createChiptuneSfx } from './sfx';
import * as songs from './songs';
import { makeContext } from '../../../shared/lib/chiptune/fakeAudioContext';

const ONE_SHOTS = ['slide', 'crunch', 'fanfare', 'whistle', 'lossChord', 'thunder', 'tieSting', 'blip'];
const LOOPS = ['crowd', 'march', 'rain', 'dirge'];

const sourcesOf = (ctx) => [...ctx.oscillators, ...ctx.bufferSources];
const stopCalls = (ctx) => [...sourcesOf(ctx), ...ctx.constantSources]
  .reduce((n, s) => n + s.stop.mock.calls.length, 0);

function unlocked(ctxOptions) {
  const ctx = makeContext(ctxOptions);
  const impl = createChiptuneSfx({ createContext: () => ctx });
  return { ctx, impl };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => setSfx(null));

describe('every name resolves', () => {
  test.each(ONE_SHOTS)('play(%s) makes sound', async (name) => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play(name);
    expect(sourcesOf(ctx).length).toBeGreaterThan(0);
  });

  test.each(LOOPS)('startLoop(%s) makes a sound that keeps going', async (name) => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.startLoop(name);
    expect(sourcesOf(ctx).length).toBeGreaterThan(0);
  });

  test('the title card theme is the march', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.startLoop('title');
    expect(sourcesOf(ctx).length).toBeGreaterThan(0);
  });

  test('an unknown name is silent and does not throw', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    expect(() => { impl.play('nope'); impl.startLoop('nope'); }).not.toThrow();
    expect(sourcesOf(ctx)).toHaveLength(0);
  });
});

describe('the sounds', () => {
  test('slide sweeps 1000 to 200 Hz over 0.2 s on a pulse', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('slide');
    const [osc] = ctx.oscillators;
    const start = osc.start.mock.calls[0][0];
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(1000, start);
    const [hz, at] = osc.frequency.exponentialRampToValueAtTime.mock.calls[0];
    expect(hz).toBe(200);
    expect(at - start).toBeCloseTo(0.2, 5);
    expect(osc.setPeriodicWave).toHaveBeenCalled();
  });

  test('whistle is one 1200 Hz pulse', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('whistle');
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0].frequency.setValueAtTime.mock.calls[0][0]).toBe(1200);
  });

  test('blip lasts 50 ms', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('blip');
    const [osc] = ctx.oscillators;
    const held = osc.stop.mock.calls[0][0] - osc.start.mock.calls[0][0];
    expect(held).toBeGreaterThanOrEqual(0.05);
    expect(held).toBeLessThan(0.1);
  });

  test('fanfare is four chords: pulses in harmony over a triangle bass', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('fanfare');
    expect(ctx.oscillators.some((o) => o.type === 'triangle')).toBe(true);
    const pulses = ctx.oscillators.filter((o) => o.setPeriodicWave.mock.calls.length > 0);
    const starts = [...new Set(pulses.map((o) => o.start.mock.calls[0][0].toFixed(3)))];
    expect(starts).toHaveLength(4); // one chord change per start time
  });

  test('crunch and thunder are noise bursts; crowd and rain are looped noise', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('crunch');
    impl.play('thunder');
    impl.startLoop('crowd');
    impl.startLoop('rain');
    expect(ctx.bufferSources).toHaveLength(4);
    expect(ctx.oscillators).toHaveLength(0);
    expect(ctx.filters.length).toBeGreaterThan(0); // the crowd is low-passed
  });

  test('lossChord ends in a pitch drop', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('lossChord');
    expect(ctx.oscillators.length).toBeGreaterThanOrEqual(3);
    expect(ctx.oscillators.some((o) => o.frequency.exponentialRampToValueAtTime.mock.calls.length > 0)).toBe(true);
  });

  test('tieSting is a two-note pulse and one noise hit', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('tieSting');
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.bufferSources).toHaveLength(1);
  });

  test('march loops at 130 BPM over 8 bars', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.startLoop('march');
    const [sentinel] = ctx.constantSources;
    const passLength = sentinel.stop.mock.calls[0][0] - sentinel.start.mock.calls[0][0];
    expect(passLength).toBeCloseTo((8 * 4 * 0.5 * 120) / 130, 3);
  });

  test('dirge loops at 75 BPM with a triangle lead', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.startLoop('dirge');
    const [sentinel] = ctx.constantSources;
    const passLength = sentinel.stop.mock.calls[0][0] - sentinel.start.mock.calls[0][0];
    expect(passLength).toBeCloseTo((4 * 4 * 0.5 * 120) / 75, 3);
    expect(ctx.oscillators.some((o) => o.type === 'triangle')).toBe(true);
  });

  test('a one-shot does not loop', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.play('fanfare');
    expect(ctx.constantSources).toHaveLength(0);
  });
});

describe('unlock', () => {
  test('creates the context on first use, and only then', async () => {
    const createContext = jest.fn(() => makeContext());
    const impl = createChiptuneSfx({ createContext });
    impl.play('blip');
    impl.startLoop('march');
    expect(createContext).not.toHaveBeenCalled();
    await impl.unlock();
    await impl.unlock();
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  test('resumes a suspended context', async () => {
    const { ctx, impl } = unlocked({ state: 'suspended' });
    await impl.unlock();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
  });

  test('is harmless where there is no Web Audio', async () => {
    const impl = createChiptuneSfx({ createContext: () => null });
    await expect(impl.unlock()).resolves.toBeUndefined();
    expect(() => { impl.play('blip'); impl.startLoop('march'); impl.stopAll({ fadeMs: 100 }); }).not.toThrow();
  });

  test('a context that throws is treated as no Web Audio', async () => {
    const impl = createChiptuneSfx({ createContext: () => { throw new Error('blocked'); } });
    await expect(impl.unlock()).resolves.toBeUndefined();
  });
});

describe('mute', () => {
  test('setMuted(true) silences the master gain without stopping loops', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.startLoop('march');
    const before = stopCalls(ctx);
    impl.setMuted(true);
    expect(ctx.gains[0].gain.value).toBe(0);
    expect(stopCalls(ctx)).toBe(before);
    impl.setMuted(false);
    expect(ctx.gains[0].gain.value).toBe(0.25);
  });

  test('a mute set before unlock applies once the context exists', async () => {
    const { ctx, impl } = unlocked();
    impl.setMuted(true);
    await impl.unlock();
    expect(ctx.gains[0].gain.value).toBe(0);
  });

  test('reads the per-device key on creation', async () => {
    window.localStorage.setItem('endzone_postgame_sound', '0');
    const { ctx, impl } = unlocked();
    await impl.unlock();
    expect(ctx.gains[0].gain.value).toBe(0);
  });

  test('writes the per-device key, and only when it changes', () => {
    const { impl } = unlocked();
    impl.setMuted(false);
    expect(window.localStorage.getItem('endzone_postgame_sound')).toBeNull();
    impl.setMuted(true);
    expect(window.localStorage.getItem('endzone_postgame_sound')).toBe('0');
    impl.setMuted(false);
    expect(window.localStorage.getItem('endzone_postgame_sound')).toBe('1');
  });
});

describe('stopAll', () => {
  test('fades and stops the loops and one-shots', async () => {
    const { ctx, impl } = unlocked();
    await impl.unlock();
    impl.startLoop('march');
    impl.play('slide');
    ctx.currentTime = 20;
    impl.stopAll({ fadeMs: 100 });
    sourcesOf(ctx).forEach((s) => expect(s.stop.mock.calls.at(-1)[0]).toBeCloseTo(20.1, 5));
  });
});

describe('the sfx facade', () => {
  test('carries unlock, and every call is safe with nothing installed', async () => {
    expect(typeof sfx.unlock).toBe('function');
    await expect(Promise.resolve(sfx.unlock())).resolves.toBeUndefined();
    expect(() => {
      sfx.play('blip'); sfx.startLoop('title'); sfx.setMuted(true); sfx.stopAll({ fadeMs: 100 });
    }).not.toThrow();
  });

  test('setSfx swaps the implementation, and a partial one keeps the no-ops', () => {
    const unlock = jest.fn();
    setSfx({ unlock });
    sfx.unlock();
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(() => sfx.play('blip')).not.toThrow();
  });
});

describe('songs.js is data only', () => {
  test.each(['march', 'dirge', 'fanfare'])('%s is an array of plain rows', (name) => {
    const rows = songs[name];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => {
      expect(['pulse1', 'pulse2', 'triangle', 'noise']).toContain(row.ch);
      expect(row.note === null || Number.isInteger(row.note)).toBe(true);
      expect(row.ms).toBeGreaterThan(0);
      Object.values(row).forEach((v) => expect(typeof v).not.toBe('function'));
    });
  });

  test('exports nothing but the three songs', () => {
    expect(Object.keys(songs).sort()).toEqual(['dirge', 'fanfare', 'march']);
  });

  test('march is 8 bars and dirge is 4, on every channel that carries them', () => {
    const total = (rows, ch) => rows.filter((r) => r.ch === ch).reduce((s, r) => s + r.ms, 0);
    ['pulse1', 'triangle', 'noise'].forEach((ch) => expect(total(songs.march, ch)).toBe(8 * 2000));
    ['triangle', 'pulse2'].forEach((ch) => expect(total(songs.dirge, ch)).toBe(4 * 2000));
  });
});
