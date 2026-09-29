/**
 * The sound interface the Postgame scenes call. This ticket ships no audio, so
 * the default implementation is a no-op; the chiptune ticket swaps in a real
 * one through `setSfx`. Scenes import `sfx` and call it unconditionally, so a
 * silent build and a sounding one differ only by what is installed here.
 *
 *   play(name)            one-shot effect
 *   startLoop(name)       looping cue (the title card theme)
 *   stopAll({ fadeMs })   stop everything, fading over `fadeMs`
 *   setMuted(bool)        the per-device mute (`soundPreference`)
 */
const NOOP = Object.freeze({
  play() {},
  startLoop() {},
  stopAll() {},
  setMuted() {},
});

let impl = NOOP;

export const sfx = {
  play: (name) => impl.play(name),
  startLoop: (name) => impl.startLoop(name),
  stopAll: (options = {}) => impl.stopAll(options),
  setMuted: (muted) => impl.setMuted(Boolean(muted)),
};

/** Install a real implementation (or null to restore the no-op). */
export function setSfx(next) {
  impl = next ? { ...NOOP, ...next } : NOOP;
}
