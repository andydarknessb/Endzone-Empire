import {
  IDLE_LINE,
  formatPlayTime,
  formatPoints,
  playsThisHour,
  playsThisHourLabel,
  sideKey,
  toMs,
} from './scoringFeedModel';

describe('formatPoints', () => {
  test.each([
    [10.4, '+10.4'],
    [7, '+7.0'],
    [0, '+0.0'],
    [-2, '-2.0'],
    [6.25, '+6.3'],
    [-0.04, '+0.0'],
    ['9.3', '+9.3'],
    [null, '+0.0'],
    ['nope', '+0.0'],
  ])('%p reads as %s', (input, expected) => {
    expect(formatPoints(input)).toBe(expected);
  });

  test('a negative play uses a hyphen, never a minus glyph', () => {
    expect(formatPoints(-2)).not.toContain('\u2212');
  });
});

describe('formatPlayTime', () => {
  const at = new Date(2026, 8, 6, 15, 41);

  test('is the clock time of the play', () => {
    expect(formatPlayTime(at, 'en-US')).toBe('3:41 PM');
  });

  test('reads an ISO string and an epoch the same as a Date', () => {
    expect(formatPlayTime(at.toISOString(), 'en-US')).toBe('3:41 PM');
    expect(formatPlayTime(at.getTime(), 'en-US')).toBe('3:41 PM');
  });

  test('is blank when the play carries no time', () => {
    expect(formatPlayTime(undefined)).toBe('');
    expect(formatPlayTime(null)).toBe('');
    expect(formatPlayTime('')).toBe('');
    expect(formatPlayTime('not a date')).toBe('');
  });
});

describe('toMs', () => {
  test('reads a Date, a string and a number, and refuses the rest', () => {
    const d = new Date(1000);
    expect(toMs(d)).toBe(1000);
    expect(toMs(d.toISOString())).toBe(1000);
    expect(toMs(1000)).toBe(1000);
    expect(toMs(null)).toBeNull();
    expect(toMs('x')).toBeNull();
  });
});

describe('playsThisHour', () => {
  const now = new Date(2026, 8, 6, 15, 42).getTime();
  const minutesAgo = (m) => new Date(now - m * 60 * 1000).toISOString();

  test('counts the plays inside the last rolling hour', () => {
    const items = [
      { at: minutesAgo(1) },
      { at: minutesAgo(5) },
      { at: minutesAgo(59) },
      { at: minutesAgo(61) },
      { at: minutesAgo(180) },
    ];
    expect(playsThisHour(items, now)).toBe(3);
  });

  test('a play with no time is one just received, and counts', () => {
    expect(playsThisHour([{ at: null }, {}, { at: minutesAgo(120) }], now)).toBe(2);
  });

  test('tolerates an absent or malformed list', () => {
    expect(playsThisHour(undefined, now)).toBe(0);
    expect(playsThisHour([null, undefined], now)).toBe(0);
  });
});

describe('playsThisHourLabel', () => {
  test('is singular for one and plural otherwise', () => {
    expect(playsThisHourLabel(1)).toBe('1 play this hour');
    expect(playsThisHourLabel(0)).toBe('0 plays this hour');
    expect(playsThisHourLabel(6)).toBe('6 plays this hour');
  });
});

describe('sideKey', () => {
  test('is home, away, or neutral for anything else', () => {
    expect(sideKey('home')).toBe('home');
    expect(sideKey('away')).toBe('away');
    expect(sideKey(null)).toBe('neutral');
    expect(sideKey(undefined)).toBe('neutral');
    expect(sideKey('opponent')).toBe('neutral');
  });
});

test('the idle line is house style: no em dash, no emoji', () => {
  expect(IDLE_LINE).not.toMatch(/\u2014/);
  expect(IDLE_LINE).not.toMatch(/\p{Extended_Pictographic}/u);
});
