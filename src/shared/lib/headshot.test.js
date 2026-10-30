import { headshotSrc } from './headshot';

const FULL = 'https://a.espncdn.com/i/headshots/nfl/players/full/3139477.png';

describe('headshotSrc', () => {
  it('rewrites an ESPN headshot to the combiner at 2x height', () => {
    expect(headshotSrc(FULL, 38)).toBe(
      'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/3139477.png&w=105&h=76',
    );
  });

  it('rewrites the http variant to https', () => {
    expect(headshotSrc(FULL.replace('https', 'http'), 38)).toBe(headshotSrc(FULL, 38));
  });

  it('drops a query string or fragment from the source URL', () => {
    expect(headshotSrc(`${FULL}?x=1`, 38)).toBe(headshotSrc(FULL, 38));
    expect(headshotSrc(`${FULL}#f`, 38)).toBe(headshotSrc(FULL, 38));
  });

  it('passes other hosts, combiner URLs and empty values through', () => {
    const other = 'https://example.com/i/headshots/a.png';
    const combiner = 'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/1.png&w=110&h=80';
    expect(headshotSrc(other, 38)).toBe(other);
    expect(headshotSrc(combiner, 38)).toBe(combiner);
    expect(headshotSrc(null, 38)).toBeNull();
    expect(headshotSrc(undefined, 38)).toBeUndefined();
    expect(headshotSrc('', 38)).toBe('');
  });
});
