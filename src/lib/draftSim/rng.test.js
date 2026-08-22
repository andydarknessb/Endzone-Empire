import { mulberry32, rngForPick, newSeed } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 20 }, () => a());
    const second = Array.from({ length: 20 }, () => b());
    expect(first).toEqual(second);
  });

  it('produces a different sequence for a different seed', () => {
    const a = Array.from({ length: 10 }, mulberry32(1));
    const b = Array.from({ length: 10 }, mulberry32(2));
    expect(a).not.toEqual(b);
  });

  it('stays inside [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 500; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('does not immediately repeat (a real generator, not a constant)', () => {
    const rng = mulberry32(7);
    const values = new Set(Array.from({ length: 100 }, () => rng()));
    expect(values.size).toBeGreaterThan(90);
  });
});

describe('rngForPick', () => {
  it('positions the stream so replaying a resumed draft reproduces it', () => {
    const straight = mulberry32(42);
    straight();
    straight();
    const expected = straight();
    expect(rngForPick(42, 2)()).toBe(expected);
  });

  it('defaults to the head of the stream', () => {
    expect(rngForPick(42)()).toBe(mulberry32(42)());
  });
});

describe('newSeed', () => {
  it('returns a uint32', () => {
    for (let i = 0; i < 25; i++) {
      const seed = newSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
