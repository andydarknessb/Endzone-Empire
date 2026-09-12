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
