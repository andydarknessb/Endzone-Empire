import { nextClaimRow, clearsUnderHour } from './nextClaimRow';

const row = (id, name, points, over = {}) => ({
  id,
  name,
  upgrade: points == null ? null : { points, week: 8 },
  projWeek: { week: 7, points: 10 },
  weeks: [{ week: 7, points: 10 }, { week: 8, points: 12 }],
  ...over,
});

describe('nextClaimRow', () => {
  test('picks the largest positive Upgrade', () => {
    const rows = [row(1, 'A', 1.2), row(2, 'B', 4.2), row(3, 'C', 2.4)];
    expect(nextClaimRow(rows, []).id).toBe(2);
  });

  test('skips rows with a pending claim', () => {
    const rows = [row(1, 'A', 1.2), row(2, 'B', 4.2), row(3, 'C', 2.4)];
    expect(nextClaimRow(rows, [2]).id).toBe(3);
    expect(nextClaimRow(rows, new Set([2, 3])).id).toBe(1);
  });

  test('ties go to the projection in the Upgrade week, then the name', () => {
    const byProjection = [
      row(1, 'A', 2, { weeks: [{ week: 8, points: 9 }] }),
      row(2, 'B', 2, { weeks: [{ week: 8, points: 11 }] }),
    ];
    expect(nextClaimRow(byProjection, []).id).toBe(2);
    const byName = [row(1, 'Zed', 2), row(2, 'Amy', 2)];
    expect(nextClaimRow(byName, []).id).toBe(2);
  });

  test('counts an Upgrade read in a later week', () => {
    const rows = [
      row(1, 'Now', 1.5, { upgrade: { points: 1.5, week: 7 } }),
      row(2, 'Later', 2.4, { upgrade: { points: 2.4, week: 9 } }),
    ];
    expect(nextClaimRow(rows, []).id).toBe(2);
  });

  test('falls back to the row week projection when the Upgrade week has no entry', () => {
    const rows = [
      row(1, 'A', 2, { weeks: [], projWeek: { week: 7, points: 5 } }),
      row(2, 'B', 2, { weeks: [], projWeek: { week: 7, points: 6 } }),
    ];
    expect(nextClaimRow(rows, []).id).toBe(2);
  });

  test('null in best ball (no Upgrade on any row) and with no positive Upgrade', () => {
    expect(nextClaimRow([row(1, 'A', null), row(2, 'B', null)], [])).toBeNull();
    expect(nextClaimRow([row(1, 'A', 0), row(2, 'B', -1)], [])).toBeNull();
    expect(nextClaimRow([], [])).toBeNull();
    expect(nextClaimRow(undefined)).toBeNull();
  });
});

describe('clearsUnderHour', () => {
  const now = Date.parse('2026-10-18T09:00:00Z');
  test('under an hour is true, an hour or more is false, a missing time is false', () => {
    expect(clearsUnderHour(new Date(now + 45 * 60000).toISOString(), now)).toBe(true);
    expect(clearsUnderHour(new Date(now + 60 * 60000).toISOString(), now)).toBe(false);
    expect(clearsUnderHour(null, now)).toBe(false);
  });
});
