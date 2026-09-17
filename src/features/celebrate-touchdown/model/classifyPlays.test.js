import { classifyPlays, MAX_CUTSCENES } from './classifyPlays';

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

  // Regression (#1241 follow-up): the overflow sum can be negative (a
  // non-touchdown event absorbing the server's residual lands in the same
  // `plays` array); the summary message must print its own hyphen sign, not
  // "+-6" (the old hardcoded "+" ahead of an already-signed `round1`).
  test('a negative overflow sum prints its own sign, never "+-"', () => {
    const plays = [td(1), td(2), td(3), td(4, { pointsDelta: -6 })];
    const out = classifyPlays(plays, ctx());
    expect(out.summaryToast.message).toBe('1 more TD: -6');
    expect(out.summaryToast.message).not.toContain('+-');
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
});
