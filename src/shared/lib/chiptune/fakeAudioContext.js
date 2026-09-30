/**
 * A fake AudioContext for tests: records the graph the chiptune library builds
 * (gains, oscillators, buffer sources, ...) and every AudioParam scheduling call.
 * Test support only; nothing in the app imports it.
 */
/** An AudioParam stand-in that records every scheduling call. */
export function param(value = 0) {
  return {
    value,
    setValueAtTime: jest.fn(),
    linearRampToValueAtTime: jest.fn(),
    exponentialRampToValueAtTime: jest.fn(),
    cancelScheduledValues: jest.fn(),
  };
}

/** A fake AudioContext that records the graph it is asked to build. */
export function makeContext({ state = 'running', currentTime = 10 } = {}) {
  const ctx = {
    currentTime,
    sampleRate: 44100,
    state,
    destination: { kind: 'destination' },
    gains: [],
    oscillators: [],
    bufferSources: [],
    constantSources: [],
    filters: [],
  };
  const wire = (node) => Object.assign(node, {
    connect: jest.fn(),
    disconnect: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    onended: null,
  });
  ctx.resume = jest.fn(() => {
    ctx.state = 'running';
    return Promise.resolve();
  });
  ctx.createGain = jest.fn(() => {
    const node = wire({ kind: 'gain', gain: param(1) });
    ctx.gains.push(node);
    return node;
  });
  ctx.createOscillator = jest.fn(() => {
    const node = wire({ kind: 'osc', type: 'sine', frequency: param(440), setPeriodicWave: jest.fn() });
    ctx.oscillators.push(node);
    return node;
  });
  ctx.createBufferSource = jest.fn(() => {
    const node = wire({ kind: 'bufsrc', buffer: null, loop: false, playbackRate: param(1) });
    ctx.bufferSources.push(node);
    return node;
  });
  ctx.createConstantSource = jest.fn(() => {
    const node = wire({ kind: 'const', offset: param(1) });
    ctx.constantSources.push(node);
    return node;
  });
  ctx.createBiquadFilter = jest.fn(() => {
    const node = wire({ kind: 'filter', type: 'lowpass', frequency: param(350) });
    ctx.filters.push(node);
    return node;
  });
  ctx.createBuffer = jest.fn((channels, length, sampleRate) => {
    const data = new Float32Array(length);
    return { length, sampleRate, numberOfChannels: channels, getChannelData: () => data };
  });
  ctx.createPeriodicWave = jest.fn((real, imag) => ({ real, imag }));
  return ctx;
}
