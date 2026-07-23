import { formatRelative } from './formatRelative';

// Wed 2024-01-10 12:00:00 local time — a fixed "now" so weekday/short-date
// assertions aren't at the mercy of whenever the suite happens to run.
const NOW = new Date(2024, 0, 10, 12, 0, 0).getTime();

describe('formatRelative', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('collapses sub-minute differences to "just now"', () => {
    expect(formatRelative(NOW + 30 * 1000)).toBe('just now');
    expect(formatRelative(NOW - 45 * 1000)).toBe('just now');
  });

  test('shows minutes just past the just-now boundary', () => {
    expect(formatRelative(NOW + 60 * 1000)).toBe('in 1m');
    expect(formatRelative(NOW - 60 * 1000)).toBe('1m ago');
  });

  test('shows minutes within the same hour', () => {
    expect(formatRelative(NOW + 45 * 60 * 1000)).toBe('in 45m');
    expect(formatRelative(NOW - 45 * 60 * 1000)).toBe('45m ago');
  });

  test('shows hours just past the minutes boundary', () => {
    expect(formatRelative(NOW + 60 * 60 * 1000)).toBe('in 1h');
    expect(formatRelative(NOW - 60 * 60 * 1000)).toBe('1h ago');
  });

  test('shows hours within the same day', () => {
    expect(formatRelative(NOW + 14 * 60 * 60 * 1000)).toBe('in 14h');
    expect(formatRelative(NOW - 2 * 60 * 60 * 1000)).toBe('2h ago');
  });

  test('shows weekday + time just past the 24h boundary', () => {
    // NOW + 24h = Thu 2024-01-11 12:00 PM
    expect(formatRelative(NOW + 24 * 60 * 60 * 1000)).toBe('Thu 12:00 PM');
  });

  test('shows weekday + time for dates within the same week (past or future)', () => {
    // NOW + 3 days = Sat 2024-01-13 03:00 AM
    const future = new Date(2024, 0, 13, 3, 0, 0).getTime();
    expect(formatRelative(future)).toBe('Sat 3:00 AM');

    // NOW - 3 days = Sun 2024-01-07 06:30 PM
    const past = new Date(2024, 0, 7, 18, 30, 0).getTime();
    expect(formatRelative(past)).toBe('Sun 6:30 PM');
  });

  test('falls back to a short date at the 7-day boundary', () => {
    expect(formatRelative(NOW + 7 * 24 * 60 * 60 * 1000)).toBe('Jan 17');
  });

  test('includes the year for dates outside the current year', () => {
    const nextYear = new Date(2025, 5, 1, 9, 0, 0).getTime();
    expect(formatRelative(nextYear)).toBe('Jun 1, 2025');
  });

  test('accepts a Date instance as well as a date-like value', () => {
    expect(formatRelative(new Date(NOW + 60 * 1000))).toBe('in 1m');
  });
});
