import { activityBadge, formatActivityTime } from './recentActivityModel';

describe('activityBadge', () => {
  // One assertion per type, each pinned to its own exact variant/label pair
  // (the issue's red-tell: swapping `drop`'s variant to `success` must turn
  // exactly the `drop` case red and no other).
  test.each([
    ['add', 'success', 'Add'],
    ['drop', 'danger', 'Drop'],
    ['trade', 'live', 'Trade'],
    ['waiver', 'neutral', 'Waiver'],
    ['commissioner', 'warning', 'Settings'],
  ])('%s maps to variant %s, label %s', (type, variant, label) => {
    expect(activityBadge(type)).toEqual({ variant, label });
  });

  test('an unrecognized type degrades to a neutral chip labelled with the capitalized type', () => {
    expect(activityBadge('stat_correction')).toEqual({ variant: 'neutral', label: 'Stat_correction' });
  });

  test('a null/undefined type degrades to a neutral "Activity" chip rather than throwing', () => {
    expect(activityBadge(null)).toEqual({ variant: 'neutral', label: 'Activity' });
    expect(activityBadge(undefined)).toEqual({ variant: 'neutral', label: 'Activity' });
  });
});

describe('formatActivityTime', () => {
  const NOW = new Date('2026-09-09T18:00:00.000Z').getTime();

  test('a timestamp two hours old reads "2h ago"', () => {
    const at = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    expect(formatActivityTime(at, NOW)).toBe('2h ago');
  });

  test('a timestamp under a minute old reads "Just now"', () => {
    const at = new Date(NOW - 10 * 1000).toISOString();
    expect(formatActivityTime(at, NOW)).toBe('Just now');
  });

  test('a timestamp under an hour old reads in minutes', () => {
    const at = new Date(NOW - 42 * 60 * 1000).toISOString();
    expect(formatActivityTime(at, NOW)).toBe('42m ago');
  });

  test('a timestamp from yesterday (24-48h elapsed) reads "Yesterday"', () => {
    const at = new Date(NOW - 30 * 60 * 60 * 1000).toISOString();
    expect(formatActivityTime(at, NOW)).toBe('Yesterday');
  });

  test('a timestamp just under 24h old stays in the hour bucket, not "Yesterday"', () => {
    const at = new Date(NOW - 23 * 60 * 60 * 1000).toISOString();
    expect(formatActivityTime(at, NOW)).toBe('23h ago');
  });

  test('a timestamp 3-6 days old reads as the short weekday name', () => {
    // NOW is a Wednesday (2026-09-09); 4 days back is Saturday.
    const at = new Date(NOW - 4 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatActivityTime(at, NOW)).toBe('Sat');
  });

  test('a timestamp a week or more old reads as a short date', () => {
    const at = new Date(NOW - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatActivityTime(at, NOW)).toBe('Aug 30');
  });

  test('a timestamp from a prior year carries the year', () => {
    const at = '2025-01-15T12:00:00.000Z';
    expect(formatActivityTime(at, NOW)).toBe('Jan 15, 2025');
  });

  test('accepts a Date for `now` as well as epoch ms', () => {
    const at = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
    expect(formatActivityTime(at, new Date(NOW))).toBe('2h ago');
  });
});
