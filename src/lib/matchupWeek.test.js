import { computeDefaultWeek } from './matchupWeek';

const m = (week, final) => ({ week, final });

describe('computeDefaultWeek', () => {
  it('uses the league current_week when it has matchups', () => {
    const league = { current_week: 3 };
    const matchups = [m(1, true), m(2, true), m(3, false)];
    const weeks = [1, 2, 3];
    expect(computeDefaultWeek(league, matchups, weeks)).toBe(3);
  });

  it('falls back to the latest non-final week when current_week has no matchups', () => {
    const league = { current_week: 5 };
    const matchups = [m(1, true), m(2, false), m(3, false)];
    const weeks = [1, 2, 3];
    expect(computeDefaultWeek(league, matchups, weeks)).toBe(3);
  });

  it('falls back to the latest week overall when everything is final', () => {
    const league = { current_week: 5 };
    const matchups = [m(1, true), m(2, true), m(3, true)];
    const weeks = [1, 2, 3];
    expect(computeDefaultWeek(league, matchups, weeks)).toBe(3);
  });

  it('returns "All" when there are no matchups at all', () => {
    expect(computeDefaultWeek(null, [], [])).toBe('All');
  });

  it('handles a missing league gracefully', () => {
    const matchups = [m(1, false), m(2, true)];
    const weeks = [1, 2];
    expect(computeDefaultWeek(null, matchups, weeks)).toBe(1);
  });
});
