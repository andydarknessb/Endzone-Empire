/**
 * The sound interface the Postgame scenes call, and its chiptune implementation
 * (spec #1747). Scenes import `sfx` and call it unconditionally; where there is
 * no Web Audio (jsdom, an old browser) or the page has not been unlocked, every
 * call is a silent no-op.
 *
 *   unlock()              create or resume the AudioContext; call it from a user
 *                         gesture (PRESS START), browsers keep the context
 *                         suspended until one
 *   play(name)            one-shot effect
 *   startLoop(name)       looping cue
 *   stopAll({ fadeMs })   stop everything, fading over `fadeMs`
 *   setMuted(bool)        the per-device mute (`soundPreference`): silences the
 *                         master gain and leaves the loops running
 *
 * Every sound is DATA in `SOUNDS` below (layers of single voices) or a note
 * table in `songs.js`; the `shared/lib` chiptune kit turns either into audio. No audio
 * files, no samples. The `AudioContext` is created here, once, on `unlock`.
 */
import { createChiptune, MAX_MASTER_GAIN } from '../../../shared/lib';
import { readPostgameSoundOn, writePostgameSoundOn } from './soundPreference';
import { march, dirge, fanfare } from './songs';

const NOISE_ENV_HISS = {
  attack: 600, decay: 0, sustain: 1, release: 200,
};

/**
 * One-shot and held sounds as layers: `ch` is 'pulse1' | 'pulse2' | 'triangle' |
 * 'noise'; a layer is a MIDI `note` or a `freq` in Hz (with an optional
 * `freqEnd` sweep), `ms` long (Infinity = held until stopped), `delayMs` after
 * the sound starts, at `vol`. `lowpass` filters a noise layer.
 */
const SOUNDS = {
  slide: { layers: [{ ch: 'pulse1', freq: 1000, freqEnd: 200, ms: 200 }] },
  crunch: {
    layers: [{
      ch: 'noise', note: 52, ms: 160, env: { attack: 1, decay: 110, sustain: 0.1, release: 40 },
    }],
  },
  whistle: {
    layers: [{
      ch: 'pulse1', freq: 1200, ms: 450, env: { attack: 20, decay: 0, sustain: 1, release: 60 },
    }],
  },
  lossChord: {
    layers: [
      { ch: 'pulse1', note: 58, ms: 450 },
      { ch: 'pulse2', note: 59, ms: 450 },
      { ch: 'triangle', note: 46, ms: 450 },
      {
        ch: 'pulse1', freq: 233, freqEnd: 55, ms: 500, delayMs: 450,
      },
    ],
  },
  thunder: {
    layers: [{
      ch: 'noise', note: 36, ms: 700, env: { attack: 5, decay: 600, sustain: 0, release: 80 },
    }],
  },
  tieSting: {
    layers: [
      { ch: 'pulse1', note: 72, ms: 110 },
      {
        ch: 'pulse1', note: 67, ms: 220, delayMs: 130,
      },
      {
        ch: 'noise', note: 50, ms: 120, delayMs: 350,
      },
    ],
  },
  blip: { layers: [{ ch: 'pulse2', freq: 880, ms: 50 }] },
  fanfare: { song: fanfare, bpm: 140 },

  // Loops.
  crowd: {
    loop: true,
    layers: [{
      ch: 'noise', note: 66, ms: Infinity, lowpass: 900, vol: 0.25, env: NOISE_ENV_HISS,
    }],
  },
  rain: {
    loop: true,
    layers: [{
      ch: 'noise', note: 24, ms: Infinity, lowpass: 500, vol: 0.2, env: NOISE_ENV_HISS,
    }],
  },
  march: { loop: true, song: march, bpm: 130 },
  dirge: { loop: true, song: dirge, bpm: 75 },
};

// The title card's theme (`PostgameStage` starts `title`) is the march.
const ALIASES = { title: 'march' };

function defaultCreateContext() {
  const Context = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  return Context ? new Context() : null;
}

/**
 * The chiptune-backed implementation. `createContext` returns an AudioContext
 * (or null); it is called at most once, from `unlock`.
 */
export function createChiptuneSfx({ createContext = defaultCreateContext } = {}) {
  let chip = createChiptune({});
  let unlockTried = false;
  let live = false; // false while `chip` is the inert one, before a context exists
  let muted = !readPostgameSoundOn();
  const loops = new Set();

  const applyMute = () => chip.setMasterGain(muted ? 0 : MAX_MASTER_GAIN);

  function channelFor(layer) {
    if (layer.ch === 'pulse1') return chip.pulse(0.5);
    if (layer.ch === 'pulse2') return chip.pulse(0.25);
    if (layer.ch === 'triangle') return chip.triangle();
    return chip.noise();
  }

  function start(rawName) {
    const name = ALIASES[rawName] || rawName;
    const sound = Object.prototype.hasOwnProperty.call(SOUNDS, name) ? SOUNDS[name] : null;
    if (!sound) return;
    // The inert chip plays nothing, so a loop asked for now must not be
    // remembered as playing: a later real startLoop would return early.
    if (!live) return;
    if (sound.loop) {
      if (loops.has(name)) return;
      loops.add(name);
    }
    if (sound.song) {
      chip.sequence(sound.song, { bpm: sound.bpm, loop: Boolean(sound.loop) });
      return;
    }
    sound.layers.forEach((layer) => {
      channelFor(layer).play({
        note: layer.note,
        freq: layer.freq,
        freqEnd: layer.freqEnd,
        ms: layer.ms,
        delayMs: layer.delayMs,
        env: layer.env,
        volume: layer.vol,
        lowpass: layer.lowpass,
      });
    });
  }

  return {
    play: start,
    startLoop: start,
    stopAll({ fadeMs = 0 } = {}) {
      loops.clear();
      chip.stopAll({ fadeMs });
    },
    setMuted(next) {
      muted = Boolean(next);
      // Persist the choice, but never create the key just to say "on".
      if (readPostgameSoundOn() === muted) writePostgameSoundOn(!muted);
      applyMute();
    },
    unlock() {
      if (!unlockTried) {
        unlockTried = true;
        try {
          const context = createContext();
          if (context) {
            chip = createChiptune({ context });
            live = true;
            applyMute();
          }
        } catch {
          // No Web Audio, or the browser refused a context: stay silent.
        }
      }
      try {
        // A refused or closed context is silence, the same rule as above.
        return Promise.resolve(chip.resume()).catch(() => undefined);
      } catch {
        return Promise.resolve();
      }
    },
  };
}

const NOOP = Object.freeze({
  play() {},
  startLoop() {},
  stopAll() {},
  setMuted() {},
  unlock() {},
});

let impl = null; // null: the chiptune implementation, created on first use

const current = () => {
  if (!impl) impl = createChiptuneSfx();
  return impl;
};

export const sfx = {
  play: (name) => current().play(name),
  startLoop: (name) => current().startLoop(name),
  stopAll: (options = {}) => current().stopAll(options),
  setMuted: (muted) => current().setMuted(Boolean(muted)),
  unlock: () => current().unlock(),
};

/** Install another implementation (a partial one keeps the no-ops), or null to restore the chiptune one. */
export function setSfx(next) {
  impl = next ? { ...NOOP, ...next } : null;
}
