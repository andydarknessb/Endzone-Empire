import { createChiptune, MAX_MASTER_GAIN, midiToFreq } from './index';
import { makeContext } from './fakeAudioContext';

const startsOf = (nodes) => nodes.map((n) => n.start.mock.calls[0][0]);
const near = (a, b) => expect(a).toBeCloseTo(b, 5);

describe('no-op path', () => {
  test('every call is inert when no context is injected', async () => {
    const chip = createChiptune({});
    expect(() => {
      chip.pulse(0.5).play({ note: 60, ms: 100 }).stop({ fadeMs: 10 });
      chip.triangle().play({ note: 48, ms: 100 });
      chip.noise().play({ note: 48, ms: 100 });
      chip.sequence([{ ch: 'pulse1', note: 60, ms: 500 }], { bpm: 120, loop: true }).stop({ fadeMs: 50 });
      chip.stopAll({ fadeMs: 100 });
      chip.setMasterGain(0.1);
    }).not.toThrow();
    await expect(chip.resume()).resolves.toBeUndefined();
  });

  test('createChiptune() with no arguments is the no-op too', () => {
    expect(() => createChiptune().stopAll()).not.toThrow();
  });
});

describe('master gain', () => {
  test('one gain feeds the destination, at a peak near -12 dBFS', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx });
    const master = ctx.gains[0];
    expect(master.connect).toHaveBeenCalledWith(ctx.destination);
    expect(master.gain.value).toBeLessThanOrEqual(0.25);
    expect(MAX_MASTER_GAIN).toBe(0.25);
  });

  test('setMasterGain clamps to 0..0.25', () => {
    const ctx = makeContext();
    const chip = createChiptune({ context: ctx });
    const master = ctx.gains[0];
    chip.setMasterGain(1);
    expect(master.gain.value).toBe(0.25);
    chip.setMasterGain(0.1);
    expect(master.gain.value).toBe(0.1);
    chip.setMasterGain(-3);
    expect(master.gain.value).toBe(0);
    chip.setMasterGain(Number.NaN);
    expect(master.gain.value).toBe(0);
  });
});

describe('resume', () => {
  test('resumes a suspended context', async () => {
    const ctx = makeContext({ state: 'suspended' });
    await createChiptune({ context: ctx }).resume();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
  });

  test('leaves a running context alone', async () => {
    const ctx = makeContext();
    await createChiptune({ context: ctx }).resume();
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});

describe('pulse channels', () => {
  test('12.5, 25 and 50% duty are built once each with createPeriodicWave', () => {
    const ctx = makeContext();
    const chip = createChiptune({ context: ctx });
    [0.125, 0.25, 0.5, 0.25, 0.5].forEach((duty) => chip.pulse(duty).play({ note: 60, ms: 100 }));
    expect(ctx.createPeriodicWave).toHaveBeenCalledTimes(3);
    expect(ctx.oscillators).toHaveLength(5);
    ctx.oscillators.forEach((osc) => expect(osc.setPeriodicWave).toHaveBeenCalledTimes(1));
  });

  test('percent values (12.5, 25, 50) select the same duties', () => {
    const ctx = makeContext();
    const chip = createChiptune({ context: ctx });
    chip.pulse(12.5).play({ note: 60, ms: 100 });
    chip.pulse(0.125).play({ note: 60, ms: 100 });
    expect(ctx.createPeriodicWave).toHaveBeenCalledTimes(1);
  });

  test('the wave carries the first harmonic of a pulse of that duty', () => {
    const ctx = makeContext();
    const chip = createChiptune({ context: ctx });
    chip.pulse(0.25).play({ note: 60, ms: 100 });
    const [real, imag] = ctx.createPeriodicWave.mock.calls[0];
    const d = 0.25;
    near(real[1], Math.sin(2 * Math.PI * d) / Math.PI);
    near(imag[1], (1 - Math.cos(2 * Math.PI * d)) / Math.PI);
    expect(real[0]).toBe(0);
  });

  test('a pulse note sets its frequency from the MIDI number', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).pulse(0.5).play({ note: 69, ms: 100 });
    expect(ctx.oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(440, expect.any(Number));
    expect(midiToFreq(60)).toBeCloseTo(261.6256, 3);
  });

  test('freqEnd ramps the pitch exponentially over the note', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).pulse(0.5).play({ freq: 1000, freqEnd: 200, ms: 200 });
    const osc = ctx.oscillators[0];
    const start = osc.start.mock.calls[0][0];
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(1000, start);
    const [hz, at] = osc.frequency.exponentialRampToValueAtTime.mock.calls[0];
    expect(hz).toBe(200);
    near(at, start + 0.2);
  });

  test('an ADSR envelope in milliseconds shapes the voice gain', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).pulse(0.5).play({
      note: 60, ms: 100, volume: 1, env: { attack: 10, decay: 20, sustain: 0.5, release: 40 },
    });
    const env = ctx.gains[1]; // gains[0] is the master
    const t0 = ctx.oscillators[0].start.mock.calls[0][0];
    expect(env.gain.setValueAtTime).toHaveBeenCalledWith(0, t0);
    const ramps = env.gain.linearRampToValueAtTime.mock.calls;
    near(ramps[0][0], 1);
    near(ramps[0][1], t0 + 0.01);
    near(ramps[1][0], 0.5);
    near(ramps[1][1], t0 + 0.03);
    near(ramps[2][0], 0);
    near(ramps[2][1], t0 + 0.14);
    near(ctx.oscillators[0].stop.mock.calls[0][0], t0 + 0.14);
  });

  test('ms: Infinity holds the sustain until stopped', () => {
    const ctx = makeContext();
    const voice = createChiptune({ context: ctx }).triangle().play({ note: 48, ms: Infinity });
    const osc = ctx.oscillators[0];
    expect(osc.type).toBe('triangle');
    expect(osc.stop).not.toHaveBeenCalled();
    voice.stop({ fadeMs: 100 });
    near(osc.stop.mock.calls[0][0], ctx.currentTime + 0.1);
  });
});

describe('noise channel', () => {
  test('renders a 32767-step LFSR into one looped AudioBuffer', () => {
    const ctx = makeContext();
    const chip = createChiptune({ context: ctx });
    chip.noise().play({ note: 48, ms: 100 });
    chip.noise().play({ note: 52, ms: 100 });
    expect(ctx.createBuffer).toHaveBeenCalledTimes(1);
    expect(ctx.createBuffer.mock.calls[0][1]).toBe(32767);
    const data = ctx.createBuffer.mock.results[0].value.getChannelData(0);
    expect(new Set(data)).toEqual(new Set([-1, 1]));
    expect(ctx.bufferSources).toHaveLength(2);
    ctx.bufferSources.forEach((src) => {
      expect(src.loop).toBe(true);
      expect(src.buffer.length).toBe(32767);
    });
  });

  test('a lowpass option puts a filter in the chain', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).noise().play({ note: 48, ms: 100, lowpass: 800 });
    expect(ctx.filters).toHaveLength(1);
    expect(ctx.filters[0].type).toBe('lowpass');
    expect(ctx.filters[0].frequency.value).toBe(800);
  });
});

describe('sequencer', () => {
  const song = [
    { ch: 'pulse1', note: 60, ms: 500 },
    { ch: 'pulse1', note: 64, ms: 500 },
    { ch: 'pulse1', note: 67, ms: 500 },
  ];

  test('schedules a 3-note song at 120 BPM 500 ms apart on the context clock', () => {
    jest.useFakeTimers();
    const ctx = makeContext();
    createChiptune({ context: ctx }).sequence(song, { bpm: 120 });
    const starts = startsOf(ctx.oscillators);
    expect(starts).toHaveLength(3);
    expect(starts[0]).toBeGreaterThanOrEqual(ctx.currentTime);
    near(starts[1] - starts[0], 0.5);
    near(starts[2] - starts[0], 1.0);
    expect(jest.getTimerCount()).toBe(0); // no setTimeout / setInterval
    jest.useRealTimers();
  });

  test('bpm scales the durations', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).sequence(song, { bpm: 240 });
    const starts = startsOf(ctx.oscillators);
    near(starts[1] - starts[0], 0.25);
    near(starts[2] - starts[0], 0.5);
  });

  test('a null note is a rest: it makes no sound but keeps time', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).sequence([
      { ch: 'pulse1', note: 60, ms: 500 },
      { ch: 'pulse1', note: null, ms: 500 },
      { ch: 'pulse1', note: 67, ms: 500 },
    ], { bpm: 120 });
    const starts = startsOf(ctx.oscillators);
    expect(starts).toHaveLength(2);
    near(starts[1] - starts[0], 1.0);
  });

  test('channels run in parallel, each on its own oscillator or noise source', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).sequence([
      { ch: 'pulse1', note: 60, ms: 500 },
      { ch: 'pulse2', note: 64, ms: 500 },
      { ch: 'triangle', note: 36, ms: 500 },
      { ch: 'noise', note: 48, ms: 500 },
    ], { bpm: 120 });
    expect(ctx.oscillators).toHaveLength(3);
    expect(ctx.bufferSources).toHaveLength(1);
    const starts = [...startsOf(ctx.oscillators), ...startsOf(ctx.bufferSources)];
    starts.forEach((s) => near(s, starts[0]));
    expect(ctx.oscillators.map((o) => o.type)).toContain('triangle');
  });

  test('a looping song is scheduled two passes ahead and each pass end schedules the next', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).sequence(song, { bpm: 120, loop: true });
    const first = startsOf(ctx.oscillators);
    expect(first).toHaveLength(6);
    near(first[3] - first[0], 1.5); // pass 2 begins one loop length after pass 1
    near(first[5] - first[0], 2.5);

    // The sentinel of pass 1 ends exactly when pass 2 begins.
    expect(ctx.constantSources).toHaveLength(2);
    const [sentinel] = ctx.constantSources;
    near(sentinel.stop.mock.calls[0][0] - first[0], 1.5);
    sentinel.onended();
    const after = startsOf(ctx.oscillators);
    expect(after).toHaveLength(9);
    near(after[6] - first[0], 3.0);
    near(after[8] - first[0], 4.0);
  });

  describe('the loop sentinel is connected, through a gain held at 0', () => {
    const connectedGains = (source) => source.connect.mock.calls.map(([node]) => node);

    test('each ConstantSource sentinel feeds a silent gain that feeds the sequence gain', () => {
      const ctx = makeContext();
      const chip = createChiptune({ context: ctx });
      const gainsBefore = ctx.gains.length;
      chip.sequence(song, { bpm: 120, loop: true });
      const seqGain = ctx.gains[gainsBefore];
      expect(ctx.constantSources).toHaveLength(2);
      ctx.constantSources.forEach((sentinel) => {
        const targets = connectedGains(sentinel);
        expect(targets).toHaveLength(1);
        expect(targets[0].kind).toBe('gain');
        expect(targets[0].gain.value).toBe(0);
        expect(targets[0].connect).toHaveBeenCalledWith(seqGain);
      });
    });

    test('the Oscillator fallback is connected only through a silent gain', () => {
      const ctx = makeContext();
      delete ctx.createConstantSource;
      createChiptune({ context: ctx }).sequence(song, { bpm: 120, loop: true });
      // Sentinels are the oscillators that are neither a pulse nor a triangle voice.
      const sentinels = ctx.oscillators.filter(
        (o) => o.type === 'sine' && o.setPeriodicWave.mock.calls.length === 0,
      );
      expect(sentinels).toHaveLength(2);
      sentinels.forEach((sentinel) => {
        const targets = connectedGains(sentinel);
        expect(targets).toHaveLength(1);
        expect(targets[0].gain.value).toBe(0);
        expect(targets[0].connect).toHaveBeenCalled();
      });
    });

    test('a sentinel disconnects when it ends and when the loop is stopped', () => {
      const ctx = makeContext();
      const handle = createChiptune({ context: ctx }).sequence(song, { bpm: 120, loop: true });
      const [first, second] = ctx.constantSources;
      const [firstGain] = connectedGains(first);
      const [secondGain] = connectedGains(second);
      first.onended();
      expect(first.disconnect).toHaveBeenCalled();
      expect(firstGain.disconnect).toHaveBeenCalled();
      handle.stop({ fadeMs: 10 });
      expect(second.disconnect).toHaveBeenCalled();
      expect(secondGain.disconnect).toHaveBeenCalled();
    });
  });

  test('a song that is not looped schedules one pass only', () => {
    const ctx = makeContext();
    createChiptune({ context: ctx }).sequence(song, { bpm: 120, loop: false });
    expect(ctx.oscillators).toHaveLength(3);
  });

  test('stop({ fadeMs }) ramps the sequence gain to zero, then stops every source', () => {
    const ctx = makeContext();
    const chip = createChiptune({ context: ctx });
    const gainsBefore = ctx.gains.length;
    const handle = chip.sequence(song, { bpm: 120, loop: true });
    const seqGain = ctx.gains[gainsBefore];
    ctx.currentTime = 11.3;
    handle.stop({ fadeMs: 200 });

    const [target, at] = seqGain.gain.linearRampToValueAtTime.mock.calls.at(-1);
    expect(target).toBe(0);
    near(at, 11.5);
    expect(seqGain.gain.cancelScheduledValues).toHaveBeenCalled();
    const sources = [...ctx.oscillators, ...ctx.constantSources];
    expect(sources.length).toBeGreaterThan(0);
    sources.forEach((src) => near(src.stop.mock.calls.at(-1)[0], 11.5));

    // A stopped loop schedules nothing further.
    const count = ctx.oscillators.length;
    ctx.constantSources[0].onended?.();
    expect(ctx.oscillators).toHaveLength(count);
  });

  test('chiptune.stopAll fades and stops running sequences and one-shot voices', () => {
    const ctx = makeContext();
    const chip = createChiptune({ context: ctx });
    chip.sequence(song, { bpm: 120 });
    chip.pulse(0.5).play({ note: 60, ms: Infinity });
    ctx.currentTime = 12;
    chip.stopAll({ fadeMs: 100 });
    ctx.oscillators.forEach((osc) => near(osc.stop.mock.calls.at(-1)[0], 12.1));
  });

  test('an empty song is inert', () => {
    const ctx = makeContext();
    const handle = createChiptune({ context: ctx }).sequence([], { loop: true });
    expect(() => handle.stop({ fadeMs: 10 })).not.toThrow();
    expect(ctx.constantSources).toHaveLength(0);
  });
});
