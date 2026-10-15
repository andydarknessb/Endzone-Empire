import { startVerdictReason, isStartVerdictUnavailable } from './startVerdict';

describe('startVerdict reader (spec #2042)', () => {
  it('reads the reason off the verdict, null when there is none', () => {
    expect(startVerdictReason({ startVerdict: { outcome: 'not_recommended', reason: 'backup', numberTrusted: false } })).toBe('backup');
    expect(startVerdictReason({ startVerdict: { outcome: 'recommendable', reason: null, numberTrusted: true } })).toBeNull();
    expect(startVerdictReason({ startVerdict: null })).toBeNull();
    expect(startVerdictReason({})).toBeNull();
    expect(startVerdictReason(null)).toBeNull();
  });

  it('is unavailable only on the unavailable outcome', () => {
    expect(isStartVerdictUnavailable({ startVerdict: { outcome: 'unavailable', reason: 'bye', numberTrusted: true } })).toBe(true);
    expect(isStartVerdictUnavailable({ startVerdict: { outcome: 'not_recommended', reason: 'no_history', numberTrusted: false } })).toBe(false);
    expect(isStartVerdictUnavailable({})).toBe(false);
    expect(isStartVerdictUnavailable(undefined)).toBe(false);
  });
});
