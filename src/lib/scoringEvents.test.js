import { classifyPlays, MAX_CUTSCENES, playLabel } from './scoringEvents';
import { matchupWinProbability, remainingPoints, MARGIN_SCALE } from './winProbability';

const td = (playerId, over = {}) => ({
  playerId,
  name: `Player ${playerId}`,
  type: 'rushing',
  tdDelta: 1,
  pointsDelta: 6,
  ...over,
});

const ctx = (over = {}) => ({
  myStarterIds: new Set([1, 2, 3, 4, 5]),
  oppStarterIds: new Set([90, 91]),
  celebrationsEnabled: true,
  ...over,
});

describe('classifyPlays', () => {
  test('one own-starter TD -> exactly one cutscene, no toast, no summary', () => {
    const out = classifyPlays([td(1)], ctx());
    expect(out.cutscenes).toHaveLength(1);
    expect(out.summaryToast).toBeNull();
    expect(out.toasts).toHaveLength(0);
  });

  test('4 own TDs in one window -> 3 cutscenes + 1 summary toast', () => {
    const plays = [td(1), td(2), td(3), td(4, { pointsDelta: 6 })];
    const out = classifyPlays(plays, ctx());
    expect(out.cutscenes).toHaveLength(MAX_CUTSCENES);
    expect(out.summaryToast).not.toBeNull();
    expect(out.summaryToast.count).toBe(1);
    expect(out.summaryToast.message).toMatch(/1 more TD: \+6/);
  });

  test('summary toast sums the overflow points', () => {
    const plays = [td(1), td(2), td(3), td(4, { pointsDelta: 6 }), td(5, { pointsDelta: 5.4 })];
    const out = classifyPlays(plays, ctx());
    expect(out.summaryToast.count).toBe(2);
    expect(out.summaryToast.pointsDelta).toBeCloseTo(11.4, 1);
    expect(out.summaryToast.message).toMatch(/2 more TDs: \+11\.4/);
  });

  test('opponent TD -> toast only, never a cutscene', () => {
    const out = classifyPlays([td(90)], ctx());
    expect(out.cutscenes).toHaveLength(0);
    expect(out.summaryToast).toBeNull();
    expect(out.toasts).toHaveLength(1);
    expect(out.toasts[0].side).toBe('opponent');
  });

  test('celebrations off -> nothing fires for own TDs (opponent toast still shows)', () => {
    const out = classifyPlays([td(1), td(2), td(90)], ctx({ celebrationsEnabled: false }));
    expect(out.cutscenes).toHaveLength(0);
    expect(out.summaryToast).toBeNull();
    expect(out.toasts).toHaveLength(1); // opponent toast is informational, not a celebration
  });

  test('a player in neither lineup (bench / other matchup) is ignored', () => {
    const out = classifyPlays([td(555)], ctx());
    expect(out.cutscenes).toHaveLength(0);
    expect(out.toasts).toHaveLength(0);
  });

  test('handles empty / missing plays without throwing', () => {
    expect(classifyPlays(undefined, ctx()).cutscenes).toHaveLength(0);
    expect(classifyPlays([], ctx()).cutscenes).toHaveLength(0);
    expect(classifyPlays([null, { name: 'no id' }], ctx()).cutscenes).toHaveLength(0);
  });

  test('playLabel describes the TD type', () => {
    expect(playLabel(td(1, { type: 'receiving' }))).toBe('receiving TD');
    expect(playLabel({})).toBe('scoring TD');
  });
});

describe('win probability', () => {
  test('remainingPoints never goes negative', () => {
    expect(remainingPoints(100, 40)).toBe(60);
    expect(remainingPoints(40, 100)).toBe(0);
  });

  test('symmetric even matchup is 50/50', () => {
    const p = matchupWinProbability({
      homeScore: 50, awayScore: 50, homeProjectedTotal: 110, awayProjectedTotal: 110,
    });
    expect(p.home).toBeCloseTo(0.5, 5);
    expect(p.home + p.away).toBeCloseTo(1, 10);
  });

  test('a big lead late (little projected remaining) approaches certainty', () => {
    const p = matchupWinProbability({
      homeScore: 120, awayScore: 90, homeProjectedTotal: 121, awayProjectedTotal: 91,
    });
    expect(p.home).toBeGreaterThan(0.75);
  });

  test('projected comeback still in play keeps it competitive', () => {
    const p = matchupWinProbability({
      homeScore: 80, awayScore: 60, homeProjectedTotal: 100, awayProjectedTotal: 115,
    });
    // Away trails now but is projected to finish ahead -> home under 50%.
    expect(p.home).toBeLessThan(0.5);
  });

  test('MARGIN_SCALE is exposed for the bar to reason about certainty', () => {
    expect(MARGIN_SCALE).toBeGreaterThan(0);
  });
});
