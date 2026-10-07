import { hasNoHistory, projectionLabel, NO_HISTORY_LABEL } from './projectionLabel';

const baseline = { outcome: 'not_recommended', reason: 'no_history', numberTrusted: false };

describe('projectionLabel (#1776)', () => {
  it('reads "no history" for a Position-baseline row, never its number', () => {
    const entry = { startVerdict: baseline, projectedPoints: 15.37, availability: { available: true, reason: null } };
    expect(projectionLabel(entry)).toBe('no history');
    expect(NO_HISTORY_LABEL).toBe('no history');
  });

  it('reads "no history" for a Questionable or Doubtful Position-baseline row (still available)', () => {
    expect(projectionLabel({ startVerdict: baseline, projectedPoints: 15.37, injuryStatus: 'Q', availability: { available: true, reason: null } })).toBe('no history');
    expect(projectionLabel({ startVerdict: baseline, projectedPoints: 15.37, injuryStatus: 'D', availability: { available: true, reason: null } })).toBe('no history');
  });

  it('reads the formatted Point estimate for an evidenced row', () => {
    expect(projectionLabel({ startVerdict: { outcome: 'recommendable', reason: null, numberTrusted: true }, projectedPoints: 16.7 })).toBe('16.7');
    expect(projectionLabel({ projectedPoints: 8 })).toBe('8.0');
    expect(projectionLabel({ projectedPoints: 0 })).toBe('0.0');
  });

  it('reads a dash when an evidenced row has no Point estimate', () => {
    expect(projectionLabel({ projectedPoints: null })).toBe('-');
    expect(projectionLabel({})).toBe('-');
  });

  it('an Unavailable player is never "no history" (the harder fact wins)', () => {
    const entry = { startVerdict: baseline, projectedPoints: 15.37, availability: { available: false, reason: 'bye' } };
    expect(hasNoHistory(entry)).toBe(false);
    expect(projectionLabel(entry)).toBe('15.4');
  });

  it('never throws on a missing row', () => {
    expect(hasNoHistory(null)).toBe(false);
    expect(hasNoHistory(undefined)).toBe(false);
    expect(projectionLabel(null)).toBe('-');
    expect(projectionLabel(undefined)).toBe('-');
  });
});

describe('hasNoHistory', () => {
  it('is true only for a no_history Start verdict on an available row', () => {
    expect(hasNoHistory({ startVerdict: baseline })).toBe(true);
    expect(hasNoHistory({ startVerdict: baseline, availability: { available: true, reason: null } })).toBe(true);
    expect(hasNoHistory({ startVerdict: { outcome: 'recommendable', reason: null, numberTrusted: true } })).toBe(false);
    expect(hasNoHistory({ startVerdict: { outcome: 'not_recommended', reason: 'backup', numberTrusted: false } })).toBe(false);
    expect(hasNoHistory({ startVerdict: { outcome: 'unavailable', reason: 'bye', numberTrusted: true }, projectedPoints: 12 })).toBe(false);
    expect(hasNoHistory({})).toBe(false);
  });

  it('reads the Players page wire (#1778) the same way: its row carries startVerdict', () => {
    expect(hasNoHistory({ startVerdict: baseline, projectedPoints: 15.37 })).toBe(true);
    expect(projectionLabel({ startVerdict: baseline, projectedPoints: 15.37 })).toBe('no history');
    expect(hasNoHistory({ startVerdict: null, projectedPoints: 12 })).toBe(false);
  });
});
