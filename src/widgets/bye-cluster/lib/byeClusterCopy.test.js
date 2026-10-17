import { worstClusterLine } from './byeClusterCopy';

describe('worstClusterLine', () => {
  test('null when there is no worst cluster (no week reached two)', () => {
    expect(worstClusterLine({ worst: null, waiverPeriodHours: 24 })).toBeNull();
  });

  test('names two players and the waiver clear period, joined with "and"', () => {
    const worst = { week: 9, count: 2, players: [{ name: 'Robinson' }, { name: 'Hubbard' }] };
    expect(worstClusterLine({ worst, waiverPeriodHours: 24 })).toBe(
      'Week 9: Robinson and Hubbard sit. Waivers clear in 24 hours.'
    );
  });

  test('names three or more players with a comma list and a final "and"', () => {
    const worst = {
      week: 5,
      count: 3,
      players: [{ name: 'Robinson' }, { name: 'Hubbard' }, { name: 'Reed' }],
    };
    expect(worstClusterLine({ worst, waiverPeriodHours: 24 })).toBe(
      'Week 5: Robinson, Hubbard and Reed sit. Waivers clear in 24 hours.'
    );
  });

  test('a zero waiver period reads as immediate, not "0 hours"', () => {
    const worst = { week: 5, count: 2, players: [{ name: 'A' }, { name: 'B' }] };
    expect(worstClusterLine({ worst, waiverPeriodHours: 0 })).toBe(
      'Week 5: A and B sit. Waivers clear immediately.'
    );
  });

  test('a missing waiver period defaults to 24 hours, matching the league settings default', () => {
    const worst = { week: 5, count: 2, players: [{ name: 'A' }, { name: 'B' }] };
    expect(worstClusterLine({ worst, waiverPeriodHours: null })).toBe(
      'Week 5: A and B sit. Waivers clear in 24 hours.'
    );
  });
});

describe('worstClusterLine with a blanket clear time (spec #2347 ruling 4)', () => {
  const worst = { week: 8, count: 2, players: [{ name: 'Jahmyr Gibbs' }, { name: 'Puka Nacua' }] };
  const NOW = new Date('2026-10-18T14:10:00Z').getTime();
  const WED_2AM_CDT = '2026-10-21T07:00:00Z';

  test('names the weekday and time when a clear is still to come', () => {
    const line = worstClusterLine({
      worst, waiverPeriodHours: 48, waiversClearAt: WED_2AM_CDT, now: NOW,
    });
    expect(line).toMatch(/^Week 8: Jahmyr Gibbs and Puka Nacua sit\. Waivers clear \w{3} \d{1,2}:\d{2} [AP]M\.$/);
    expect(line).not.toMatch(/hours/);
  });

  test('keeps the rolling period copy when there is no clear time, or it has passed', () => {
    expect(worstClusterLine({ worst, waiverPeriodHours: 48, waiversClearAt: null, now: NOW })).toMatch(/Waivers clear in 48 hours\.$/);
    expect(worstClusterLine({ worst, waiverPeriodHours: 48, waiversClearAt: '2026-10-14T07:00:00Z', now: NOW })).toMatch(/Waivers clear in 48 hours\.$/);
    expect(worstClusterLine({ worst, waiverPeriodHours: 48, waiversClearAt: 'not a date', now: NOW })).toMatch(/Waivers clear in 48 hours\.$/);
  });
});
