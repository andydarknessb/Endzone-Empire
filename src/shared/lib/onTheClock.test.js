import {
  URGENT_SECONDS,
  deriveOnTheClock,
  formatRemaining,
  isTeamOnTheClock,
  isUrgent,
  remainingSeconds,
} from './onTheClock';

const team = { teamId: 7, teamName: 'Harbor Hawks' };
const T0 = Date.UTC(2026, 8, 2, 12, 0, 0);

describe('deriveOnTheClock', () => {
  test('idle when the draft is not active, whatever else is set', () => {
    expect(deriveOnTheClock({ team, deadlineAt: T0 + 30000, paused: false, active: false }))
      .toEqual({ team: null, state: 'idle', deadlineAt: null });
  });

  test('idle when nobody is on the clock', () => {
    expect(deriveOnTheClock({ team: null, deadlineAt: T0 + 30000, paused: false, active: true }))
      .toEqual({ team: null, state: 'idle', deadlineAt: null });
  });

  test('untimed when a team is up with no deadline', () => {
    expect(deriveOnTheClock({ team, deadlineAt: null, paused: false, active: true }))
      .toEqual({ team, state: 'untimed', deadlineAt: null });
  });

  test('running when a team is up against a deadline', () => {
    expect(deriveOnTheClock({ team, deadlineAt: T0 + 30000, paused: false, active: true }))
      .toEqual({ team, state: 'running', deadlineAt: T0 + 30000 });
  });

  test('paused keeps the team and drops the deadline', () => {
    expect(deriveOnTheClock({ team, deadlineAt: T0 + 30000, paused: true, active: true }))
      .toEqual({ team, state: 'paused', deadlineAt: null });
  });

  test('never carries a per-second field', () => {
    const value = deriveOnTheClock({ team, deadlineAt: T0 + 30000, paused: false, active: true });
    expect(Object.keys(value).sort()).toEqual(['deadlineAt', 'state', 'team']);
  });
});

describe('remainingSeconds', () => {
  test('a deadline 30 s out reads 30', () => {
    expect(remainingSeconds((T0 + 30000) - T0)).toBe(30);
  });

  test('floors a partial second down', () => {
    expect(remainingSeconds(29999)).toBe(29);
  });

  test('a deadline in the past reads 0, never negative', () => {
    expect(remainingSeconds((T0 - 5000) - T0)).toBe(0);
    expect(remainingSeconds(-1)).toBe(0);
  });
});

describe('isUrgent', () => {
  test('true at exactly the urgency threshold', () => {
    expect(isUrgent(URGENT_SECONDS)).toBe(true);
    expect(isUrgent(10)).toBe(true);
  });

  test('false one second above it', () => {
    expect(isUrgent(11)).toBe(false);
  });

  test('false with no remaining value', () => {
    expect(isUrgent(null)).toBe(false);
    expect(isUrgent(undefined)).toBe(false);
  });
});

describe('isTeamOnTheClock', () => {
  const running = deriveOnTheClock({ team, deadlineAt: T0 + 30000, paused: false, active: true });

  test('true for the team that is up', () => {
    expect(isTeamOnTheClock(running, 7)).toBe(true);
  });

  test('false for any other team', () => {
    expect(isTeamOnTheClock(running, 8)).toBe(false);
  });

  test('false for a null team, a null value, or a null id', () => {
    expect(isTeamOnTheClock(deriveOnTheClock({ team: null, active: true }), 7)).toBe(false);
    expect(isTeamOnTheClock(null, 7)).toBe(false);
    expect(isTeamOnTheClock(running, null)).toBe(false);
  });
});

describe('formatRemaining', () => {
  test.each([
    [0, '0:00'],
    [9, '0:09'],
    [30, '0:30'],
    [90, '1:30'],
    [600, '10:00'],
  ])('%i seconds reads %s', (seconds, expected) => {
    expect(formatRemaining(seconds)).toBe(expected);
  });

  test('null and negative values read 0:00', () => {
    expect(formatRemaining(null)).toBe('0:00');
    expect(formatRemaining(-4)).toBe('0:00');
  });
});
