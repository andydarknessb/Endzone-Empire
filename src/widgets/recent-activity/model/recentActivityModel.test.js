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
    // A seventh (#1134): a league-wide recap row, also given an explicit
    // entry rather than leaning on the fallback below happening to agree.
    ['recap', 'neutral', 'Recap'],
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

// The ladder itself (minutes, hours, "Yesterday", weekday, short date) is the
// shared compact time-since style, tested in shared/lib/formatTimeSince.test.js.
// The card owns its casing and its empty cell.
describe('formatActivityTime', () => {
  // Local Y/M/D/H/M components so the buckets land on the same wall calendar
  // day in any runner zone. September 9, 2026 is a Wednesday.
  const NOW = new Date(2026, 8, 9, 18, 0, 0).getTime();
  const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000);

  test('a timestamp under a minute old starts its cell as "Just now"', () => {
    expect(formatActivityTime(new Date(NOW - 10 * 1000).toISOString(), NOW)).toBe('Just now');
  });

  test('reads the compact style: hours, then "Yesterday", then the weekday', () => {
    expect(formatActivityTime(hoursAgo(2).toISOString(), NOW)).toBe('2h ago');
    expect(formatActivityTime(hoursAgo(30).toISOString(), NOW)).toBe('Yesterday');
    expect(formatActivityTime(hoursAgo(4 * 24).toISOString(), NOW, 'en-US')).toBe('Sat');
  });

  test('absent or unreadable input leaves the cell empty', () => {
    expect(formatActivityTime(null, NOW)).toBeNull();
    expect(formatActivityTime('not-a-date', NOW)).toBeNull();
  });
});
