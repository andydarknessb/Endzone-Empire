/**
 * A small NES-style chiptune library over an INJECTED Web Audio context: two
 * pulse channels (12.5 / 25 / 50% duty), a triangle, an LFSR noise channel and
 * an ADSR envelope per voice, a sequencer that plays note tables, and a master
 * gain that never exceeds 0.25 (about -12 dBFS). No audio files, no samples.
 *
 * The context is never created here: the caller hands one in (or none). With
 * `context` undefined every call is a no-op that returns an inert handle, so
 * jsdom tests and browsers without Web Audio run the same code.
 *
 *   const chip = createChiptune({ context });
 *   chip.pulse(0.25).play({ note: 72, ms: 200 });        // one voice
 *   const song = chip.sequence(rows, { bpm: 130, loop: true });
 *   song.stop({ fadeMs: 100 });
 *   chip.stopAll({ fadeMs: 100 });
 *
 * Song rows are `{ ch, note, ms }`: `ch` is 'pulse1' | 'pulse2' | 'triangle' |
 * 'noise', `note` a MIDI number or null for a rest, and `ms` the row's length
 * at the 120 BPM reference tempo (500 ms per beat); `bpm` rescales it. Rows of
 * one channel play back to back, channels play in parallel. An optional `vol`
 * (0..1) and `env` per row shape one voice.
 *
 * Everything is scheduled on the context clock, never with setTimeout. A
 * looping song is scheduled two passes ahead and re-armed by the `ended` event
 * of a silent sentinel source, so a throttled background tab cannot stall it.
 */
import {
  LFSR_STEPS, midiToFreq, pulseCoefficients, renderLfsrBuffer,
} from './waves';

export { midiToFreq } from './waves';

/** The loudest the master gain may be: 0.25 is about -12 dBFS. */
export const MAX_MASTER_GAIN = 0.25;

const REFERENCE_BPM = 120;
const START_LEAD_S = 0.02;
const DUTIES = [0.125, 0.25, 0.5];

const DEFAULT_ENV = {
  pulse: {
    attack: 2, decay: 40, sustain: 0.7, release: 30,
  },
  triangle: {
    attack: 2, decay: 0, sustain: 1, release: 30,
  },
  noise: {
    attack: 1, decay: 80, sustain: 0.3, release: 30,
  },
};

// Sequencer channel names -> voice kind and default pulse duty.
const CHANNELS = {
  pulse1: { kind: 'pulse', duty: 0.5 },
  pulse2: { kind: 'pulse', duty: 0.25 },
  triangle: { kind: 'triangle' },
  noise: { kind: 'noise' },
};

const INERT_HANDLE = Object.freeze({ stop() {} });
const INERT_CHANNEL = Object.freeze({ play: () => INERT_HANDLE });

function normalizeDuty(duty) {
  const fraction = duty > 1 ? duty / 100 : duty;
  return DUTIES.reduce(
    (best, d) => (Math.abs(d - fraction) < Math.abs(best - fraction) ? d : best),
    0.5,
  );
}

function clampGain(g) {
  if (!Number.isFinite(g) || g < 0) return 0;
  return Math.min(g, MAX_MASTER_GAIN);
}

function safeStop(source, when) {
  try {
    source.stop(when);
  } catch {
    // A source that already ended cannot be stopped again; it is silent anyway.
  }
}

function safeDisconnect(node) {
  try {
    node.disconnect();
  } catch {
    // Already disconnected.
  }
}

export function createChiptune({ context } = {}) {
  if (!context) {
    return {
      pulse: () => INERT_CHANNEL,
      triangle: () => INERT_CHANNEL,
      noise: () => INERT_CHANNEL,
      sequence: () => INERT_HANDLE,
      stopAll() {},
      setMasterGain() {},
      resume: () => Promise.resolve(),
    };
  }

  const master = context.createGain();
  master.gain.value = MAX_MASTER_GAIN;
  master.connect(context.destination);

  const waves = new Map();
  let noiseBuffer = null;
  const active = new Set(); // handles with a stop(): one-shot voices and sequences

  function pulseWave(duty) {
    if (!waves.has(duty)) {
      const { real, imag } = pulseCoefficients(duty);
      waves.set(duty, context.createPeriodicWave(real, imag));
    }
    return waves.get(duty);
  }

  function noiseSource() {
    if (!noiseBuffer) noiseBuffer = renderLfsrBuffer(context);
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    return source;
  }

  /**
   * One voice: source -> [lowpass] -> envelope gain -> dest. `at` is absolute
   * context time; `ms` may be Infinity (held until stopped). Returns
   * `{ source, stop({ fadeMs }) }`; `onEnd` runs when the source has ended.
   */
  function startVoice(kind, opts, dest, onEnd) {
    const {
      note, freq, freqEnd, ms, at, env: envOverride, volume = 1, lowpass, duty,
    } = opts;
    const t0 = at;
    const env = { ...DEFAULT_ENV[kind], ...envOverride };
    const dur = ms / 1000;
    const release = env.release / 1000;

    let source;
    if (kind === 'noise') {
      source = noiseSource();
      const rate = 2 ** (((Number.isFinite(note) ? note : 60) - 60) / 12);
      source.playbackRate.setValueAtTime(rate, t0);
    } else {
      source = context.createOscillator();
      if (kind === 'pulse') source.setPeriodicWave(pulseWave(normalizeDuty(duty ?? 0.5)));
      else source.type = 'triangle';
      const hz = freq ?? midiToFreq(note);
      source.frequency.setValueAtTime(hz, t0);
      if (Number.isFinite(freqEnd) && Number.isFinite(dur)) {
        source.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
      }
    }

    const envGain = context.createGain();
    const { gain } = envGain;
    const attack = Math.min(env.attack / 1000, dur);
    const decay = Math.min(env.decay / 1000, Math.max(dur - attack, 0));
    const sustain = volume * env.sustain;
    gain.setValueAtTime(0, t0);
    gain.linearRampToValueAtTime(volume, t0 + attack);
    gain.linearRampToValueAtTime(sustain, t0 + attack + decay);
    if (Number.isFinite(dur)) {
      if (dur > attack + decay) gain.setValueAtTime(sustain, t0 + dur);
      gain.linearRampToValueAtTime(0, t0 + dur + release);
    }

    let tail = source;
    if (lowpass && kind === 'noise') {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpass;
      source.connect(filter);
      tail = filter;
    }
    tail.connect(envGain);
    envGain.connect(dest);

    source.onended = () => {
      safeDisconnect(source);
      if (tail !== source) safeDisconnect(tail);
      safeDisconnect(envGain);
      if (onEnd) onEnd();
    };
    source.start(t0);
    if (Number.isFinite(dur)) safeStop(source, t0 + dur + release);

    let stopped = false;
    return {
      source,
      stop({ fadeMs = 0 } = {}) {
        if (stopped) return;
        stopped = true;
        const now = context.currentTime;
        const end = now + fadeMs / 1000;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(gain.value, now);
        gain.linearRampToValueAtTime(0, end);
        safeStop(source, end);
      },
    };
  }

  function channel(kind, duty) {
    return {
      play(opts = {}) {
        const at = context.currentTime + START_LEAD_S + (opts.delayMs || 0) / 1000;
        const handle = { stop() {} };
        const voice = startVoice(kind, {
          ...opts, duty, at, ms: opts.ms ?? 100,
        }, master, () => active.delete(handle));
        handle.stop = voice.stop;
        active.add(handle);
        return handle;
      },
    };
  }

  function sequence(song, { bpm = REFERENCE_BPM, loop = false } = {}) {
    const tempo = bpm > 0 ? bpm : REFERENCE_BPM;
    const scale = REFERENCE_BPM / tempo;

    const tracks = new Map();
    (Array.isArray(song) ? song : []).forEach((row) => {
      if (!CHANNELS[row.ch]) return;
      if (!tracks.has(row.ch)) tracks.set(row.ch, []);
      tracks.get(row.ch).push(row);
    });
    let loopLength = 0;
    tracks.forEach((rows) => {
      const total = rows.reduce((sum, row) => sum + (row.ms * scale) / 1000, 0);
      loopLength = Math.max(loopLength, total);
    });
    if (!(loopLength > 0)) return INERT_HANDLE;

    const seqGain = context.createGain();
    seqGain.gain.value = 1;
    seqGain.connect(master);

    const voices = new Set();
    const sentinels = new Set();
    const handle = { stop() {} };
    let stopped = false;

    const retire = () => {
      if (voices.size > 0 || (loop && !stopped)) return;
      safeDisconnect(seqGain);
      active.delete(handle);
    };

    const schedulePass = (passStart) => {
      tracks.forEach((rows, ch) => {
        const { kind, duty } = CHANNELS[ch];
        let cursor = passStart;
        rows.forEach((row) => {
          const length = (row.ms * scale) / 1000;
          if (row.note !== null && row.note !== undefined) {
            const voice = startVoice(kind, {
              note: row.note,
              ms: length * 1000,
              at: cursor,
              env: row.env,
              volume: row.vol,
              lowpass: row.lowpass,
              duty: row.duty ?? duty,
            }, seqGain, () => {
              voices.delete(voice);
              retire();
            });
            voices.add(voice);
          }
          cursor += length;
        });
      });
    };

    const t0 = context.currentTime + START_LEAD_S;
    let nextPass = 0;
    const armPass = () => {
      const passStart = t0 + nextPass * loopLength;
      nextPass += 1;
      schedulePass(passStart);
      if (!loop) return;
      // Silent sentinel: its `ended` fires when this pass ends, i.e. when the
      // next one begins, and that is the cue to schedule the pass after it.
      const sentinel = (context.createConstantSource || context.createOscillator).call(context);
      if (sentinel.offset) sentinel.offset.value = 0;
      sentinel.onended = () => {
        sentinels.delete(sentinel);
        if (!stopped) armPass();
      };
      sentinel.start(passStart);
      safeStop(sentinel, passStart + loopLength);
      sentinels.add(sentinel);
    };
    armPass();
    if (loop) armPass();

    handle.stop = ({ fadeMs = 0 } = {}) => {
      if (stopped) return;
      stopped = true;
      const now = context.currentTime;
      const end = now + fadeMs / 1000;
      seqGain.gain.cancelScheduledValues(now);
      seqGain.gain.setValueAtTime(seqGain.gain.value, now);
      seqGain.gain.linearRampToValueAtTime(0, end);
      voices.forEach((voice) => safeStop(voice.source, end));
      sentinels.forEach((sentinel) => {
        sentinel.onended = null;
        safeStop(sentinel, end);
      });
      sentinels.clear();
      if (voices.size === 0) retire();
    };
    active.add(handle);
    return handle;
  }

  return {
    pulse: (duty = 0.5) => channel('pulse', normalizeDuty(duty)),
    triangle: () => channel('triangle'),
    noise: () => channel('noise'),
    sequence,
    stopAll({ fadeMs = 0 } = {}) {
      [...active].forEach((handle) => handle.stop({ fadeMs }));
    },
    setMasterGain(g) {
      master.gain.value = clampGain(g);
    },
    resume() {
      if (context.state === 'suspended' && typeof context.resume === 'function') {
        return Promise.resolve(context.resume()).then(() => undefined);
      }
      return Promise.resolve();
    },
  };
}

export { LFSR_STEPS };
