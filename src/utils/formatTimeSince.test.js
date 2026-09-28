import { formatTimeSince } from './formatTimeSince';

// Wed 2024-01-10 12:00:00 local time — a fixed "now" so weekday/short-date
// assertions aren't at the mercy of whenever the suite happens to run.
const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime();
const M = 60 * 1000;
const H = 60 * M;

describe('formatTimeSince', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('collapses the last minute to "just now"', () => {
    expect(formatTimeSince(NOW - 45 * 1000)).toBe('just now');
    expect(formatTimeSince(NOW)).toBe('just now');
  });

  // Time since reads the past only (spec #1737): a record stamped a little
  // ahead of the viewer's clock (clock skew) has just happened, and a real
  // future instant belongs to the time-until module.
  test('an instant not yet passed reads "just now", never a future time', () => {
    expect(formatTimeSince(NOW + 30 * 1000)).toBe('just now');
    expect(formatTimeSince(NOW + 14 * H)).toBe('just now');
    expect(formatTimeSince(NOW + 3 * 24 * H)).toBe('just now');
  });

  test('shows minutes, then hours, within the day', () => {
    expect(formatTimeSince(NOW - M)).toBe('1m ago');
    expect(formatTimeSince(NOW - 45 * M)).toBe('45m ago');
    expect(formatTimeSince(NOW - H)).toBe('1h ago');
    expect(formatTimeSince(NOW - 2 * H)).toBe('2h ago');
  });

  test('shows weekday + time within the week', () => {
    // NOW - 3 days = Sun 2024-01-07 06:30 PM
    expect(formatTimeSince(new Date(2024, 0, 7, 18, 30, 0).getTime())).toBe('Sun 6:30 PM');
  });

  test('falls back to a short date past a week, with the year only when it differs', () => {
    expect(formatTimeSince(NOW - 7 * 24 * H)).toBe('Jan 3');
    expect(formatTimeSince(new Date(2023, 5, 1, 9, 0, 0).getTime())).toBe('Jun 1, 2023');
  });

  test('accepts a Date instance as well as a date-like value', () => {
    expect(formatTimeSince(new Date(NOW - M))).toBe('1m ago');
    expect(formatTimeSince(new Date(NOW - M).toISOString())).toBe('1m ago');
  });
});
