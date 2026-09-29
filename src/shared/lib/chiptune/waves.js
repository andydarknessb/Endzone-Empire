/**
 * The raw material of the chiptune library: pitch, pulse-wave spectra and the
 * NES noise register. Pure functions; nothing here touches an AudioContext
 * except `renderLfsrBuffer`, which is handed one.
 */

/** Steps of the NES 15-bit LFSR before it repeats (2^15 - 1). */
export const LFSR_STEPS = 32767;

const PULSE_HARMONICS = 64;

/** Hz of a MIDI note number (69 = A4 = 440 Hz). */
export function midiToFreq(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

/**
 * Fourier coefficients of a unit pulse train of the given duty cycle
 * (0 < duty < 1), in the form `createPeriodicWave(real, imag)` takes:
 * x(t) = sum(real[n] cos(2 pi n t) + imag[n] sin(2 pi n t)), DC left out.
 */
export function pulseCoefficients(duty, harmonics = PULSE_HARMONICS) {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n += 1) {
    real[n] = Math.sin(2 * Math.PI * n * duty) / (Math.PI * n);
    imag[n] = (1 - Math.cos(2 * Math.PI * n * duty)) / (Math.PI * n);
  }
  return { real, imag };
}

/**
 * Render one full period of the NES noise channel's 15-bit LFSR (feedback from
 * bits 0 and 1) into a mono AudioBuffer of +1 / -1 samples. Rendered once and
 * looped; pitch is the source's playbackRate.
 */
export function renderLfsrBuffer(context) {
  const buffer = context.createBuffer(1, LFSR_STEPS, context.sampleRate);
  const data = buffer.getChannelData(0);
  let register = 1;
  for (let i = 0; i < LFSR_STEPS; i += 1) {
    data[i] = register & 1 ? 1 : -1;
    const feedback = (register ^ (register >> 1)) & 1;
    register = (register >> 1) | (feedback << 14);
  }
  return buffer;
}
