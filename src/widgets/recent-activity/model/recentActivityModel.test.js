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
    // A sixth, documented row shape (entities/activity's own docblock) the
    // issue's mockup names no chip for; it gets a real label rather than
    // falling through to the generic fallback below.
    ['stat_correction', 'neutral', 'Stat correction'],
  ])('%s maps to variant %s, label %s', (type, variant, label) => {
    expect(activityBadge(type)).toEqual({ variant, label });
  });

  test('an unrecognized type degrades to a neutral chip labelled with the capitalized type', () => {
    expect(activityBadge('birthday')).toEqual({ variant: 'neutral', label: 'Birthday' });
  });

  test('a null/undefined type degrades to a neutral "Activity" chip rather than throwing', () => {
    expect(activityBadge(null)).toEqual({ variant: 'neutral', label: 'Activity' });
    expect(activityBadge(undefined)).toEqual({ variant: 'neutral', label: 'Activity' });
  });

  test('a non-string type degrades to a neutral "Activity" chip rather than throwing', () => {
    expect(activityBadge(42)).toEqual({ variant: 'neutral', label: 'Activity' });
  });

  test('the returned badge is a copy: mutating it does not corrupt a later lookup of the same type', () => {
    const first = activityBadge('add');
    first.variant = 'danger';
    expect(activityBadge('add')).toEqual({ variant: 'success', label: 'Add' });
  });
});

describe('formatActivityTime', () => {
  // Built from local Y/M/D/H/M components (the `new Date(y, m, d, h, min)`
  // shape ScoringFeed.test.jsx uses, "times in local clock time so the
  // formatted output is the viewer's own"), NOT parsed from a UTC 'Z' ISO
  // string: the Date constructor's numeric-args form is read in the
  // runner's own local zone, so NOW and every offset below land on the same
  // wall-clock calendar day in any timezone the suite runs in. Building them
  // from a UTC instant instead is exactly the bug ArticlePage.test.jsx's own
  // comment records - "in any timezone west of UTC ... every byline was a
  // day early" - and it would flip the weekday/date buckets below the same
  // way. September 9, 2026 is a Wednesday on the Gregorian calendar; that
  // fact does not depend on timezone.
  const NOW = new Date(2026, 8, 9, 18, 0, 0).getTime();
  const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000);
  const daysAgo = (d) => new Date(NOW - d * 24 * 60 * 60 * 1000);

  // The weekday/short-date buckets format with `toLocaleDateString`, which
  // also reads the runtime's DEFAULT LOCALE (distinct from timezone) - under
  // `LANG=de-DE` 'Sat' renders 'Sa' and 'Aug 30' renders '30. Aug'. Pinning
  // `locale` (formatActivityTime's third argument, the same shape
  // `formatPlayTime`'s own `locale` param takes) makes those specific
  // assertions independent of the machine running the suite; every other
  // bucket below never reaches `toLocaleDateString` and needs no locale.
  const LOCALE = 'en-US';

  test('a timestamp two hours old reads "2h ago"', () => {
    expect(formatActivityTime(hoursAgo(2).toISOString(), NOW)).toBe('2h ago');
  });

  test('a timestamp under a minute old reads "Just now"', () => {
    const at = new Date(NOW - 10 * 1000);
    expect(formatActivityTime(at.toISOString(), NOW)).toBe('Just now');
  });

  test('a timestamp under an hour old reads in minutes', () => {
    const at = new Date(NOW - 42 * 60 * 1000);
    expect(formatActivityTime(at.toISOString(), NOW)).toBe('42m ago');
  });

  test('a timestamp from yesterday (24-48h elapsed) reads "Yesterday"', () => {
    expect(formatActivityTime(hoursAgo(30).toISOString(), NOW)).toBe('Yesterday');
  });

  test('a timestamp just under 24h old stays in the hour bucket, not "Yesterday"', () => {
    expect(formatActivityTime(hoursAgo(23).toISOString(), NOW)).toBe('23h ago');
  });

  test('a timestamp 3-6 days old reads as the short weekday name', () => {
    // 4 days back from Wednesday Sep 9 is Saturday Sep 5.
    expect(formatActivityTime(daysAgo(4).toISOString(), NOW, LOCALE)).toBe('Sat');
  });

  test('a timestamp a week or more old reads as a short date', () => {
    expect(formatActivityTime(daysAgo(10).toISOString(), NOW, LOCALE)).toBe('Aug 30');
  });

  test('a timestamp from a prior year carries the year', () => {
    const at = new Date(2025, 0, 15, 12, 0, 0);
    expect(formatActivityTime(at.toISOString(), NOW, LOCALE)).toBe('Jan 15, 2025');
  });

  test('accepts a Date for `now` as well as epoch ms', () => {
    expect(formatActivityTime(hoursAgo(2).toISOString(), new Date(NOW))).toBe('2h ago');
  });
});
