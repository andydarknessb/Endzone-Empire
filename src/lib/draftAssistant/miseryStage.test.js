import { miseryStage, MISERY_BANDS } from './miseryStage';

describe('miseryStage', () => {
  it('exposes exactly four original band names', () => {
    expect(MISERY_BANDS).toHaveLength(4);
    expect(new Set(MISERY_BANDS).size).toBe(4);
  });

  it('bands a strongly negative net vs ADP (lots of steals) as the best band', () => {
    expect(miseryStage(-40)).toBe(MISERY_BANDS[0]);
    expect(miseryStage(-15.01)).toBe(MISERY_BANDS[0]);
    expect(miseryStage(-15)).toBe(MISERY_BANDS[0]);
  });

  it('bands a mildly negative or zero net vs ADP as the second band', () => {
    expect(miseryStage(-14.99)).toBe(MISERY_BANDS[1]);
    expect(miseryStage(-4)).toBe(MISERY_BANDS[1]);
    expect(miseryStage(0)).toBe(MISERY_BANDS[1]);
  });

  it('bands a mildly positive net vs ADP as the third band', () => {
    expect(miseryStage(0.01)).toBe(MISERY_BANDS[2]);
    expect(miseryStage(15)).toBe(MISERY_BANDS[2]);
  });

  it('bands a strongly positive net vs ADP (lots of reaches) as the worst band', () => {
    expect(miseryStage(15.01)).toBe(MISERY_BANDS[3]);
    expect(miseryStage(200)).toBe(MISERY_BANDS[3]);
  });

  it('treats a non-finite input as zero rather than throwing', () => {
    expect(miseryStage(undefined)).toBe(MISERY_BANDS[1]);
    expect(miseryStage(NaN)).toBe(MISERY_BANDS[1]);
  });
});
