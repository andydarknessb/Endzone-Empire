import {
  deriveOnTheClock,
  isTeamOnTheClock,
  remainingAt,
  isUrgent,
  formatRemaining,
  URGENT_SECONDS,
} from './onTheClock';

const TEAM = { teamId: 7, teamName: 'Anvils' };

describe('deriveOnTheClock', () => {
  test('idle when nobody is on the clock (pending or complete)', () => {
    expect(deriveOnTheClock({ team: null, deadlineAt: 1_000, paused: false, active: true }))
      .toEqual({ team: null, state: 'idle', deadlineAt: null });
  });

  test('untimed when a team is up but there is no deadline', () => {
    expect(deriveOnTheClock({ team: TEAM, deadlineAt: null, paused: false, active: true }))
      .toEqual({ team: TEAM, state: 'untimed', deadlineAt: null });
  });

  test('running when a team is up and a deadline is counting down', () => {
    expect(deriveOnTheClock({ team: TEAM, deadlineAt: 5_000, paused: false, active: true }))
      .toEqual({ team: TEAM, state: 'running', deadlineAt: 5_000 });
  });

  test('paused takes precedence over a deadline and carries no live timer', () => {
    expect(deriveOnTheClock({ team: TEAM, deadlineAt: 5_000, paused: true, active: true }))
      .toEqual({ team: TEAM, state: 'paused', deadlineAt: null });
  });

  test('untimed (not running) when a team is up with a deadline but the draft is not active', () => {
    expect(deriveOnTheClock({ team: TEAM, deadlineAt: 5_000, paused: false, active: false }))
      .toEqual({ team: TEAM, state: 'untimed', deadlineAt: null });
  });

  test('expired is not a stored state: it is running derived at remaining 0', () => {
    // The store never holds `expired` (A1). The ticking leaf derives it from a
    // running value once remainingAt hits 0; both halves are asserted here.
    const running = deriveOnTheClock({ team: TEAM, deadlineAt: 1_000, paused: false, active: true });
    expect(running.state).toBe('running');
    expect(remainingAt(1_000, 1_000)).toBe(0);
    expect(isUrgent(remainingAt(1_000, 1_000))).toBe(true);
  });
});

describe('remainingAt', () => {
  test('whole seconds until a future deadline', () => {
    expect(remainingAt(30_000, 0)).toBe(30);
  });

  test('a deadline in the past is 0, never negative', () => {
    expect(remainingAt(1_000, 5_000)).toBe(0);
  });

  test('null when there is no deadline', () => {
    expect(remainingAt(null, 5_000)).toBeNull();
  });
});

describe('isUrgent', () => {
  test('true at exactly the threshold and false one above it', () => {
    expect(isUrgent(URGENT_SECONDS)).toBe(true); // 10
    expect(isUrgent(URGENT_SECONDS + 1)).toBe(false); // 11
  });

  test('the boundary is keyed off the exported threshold', () => {
    // Guards the red-tell in AC1: with URGENT_SECONDS edited to 9 this fails.
    expect(isUrgent(10)).toBe(true);
    expect(isUrgent(11)).toBe(false);
  });

  test('null remaining is never urgent', () => {
    expect(isUrgent(null)).toBe(false);
  });
});

describe('isTeamOnTheClock', () => {
  test('true only for the team on the clock', () => {
    const value = { team: TEAM, state: 'running', deadlineAt: 5_000 };
    expect(isTeamOnTheClock(value, 7)).toBe(true);
    expect(isTeamOnTheClock(value, 8)).toBe(false);
  });

  test('false for a null team, a null value, and a null id', () => {
    expect(isTeamOnTheClock({ team: null, state: 'idle', deadlineAt: null }, 7)).toBe(false);
    expect(isTeamOnTheClock(null, 7)).toBe(false);
    expect(isTeamOnTheClock({ team: TEAM, state: 'running', deadlineAt: 5_000 }, null)).toBe(false);
  });
});

describe('formatRemaining', () => {
  test('renders m:ss', () => {
    expect(formatRemaining(0)).toBe('0:00');
    expect(formatRemaining(9)).toBe('0:09');
    expect(formatRemaining(30)).toBe('0:30');
    expect(formatRemaining(90)).toBe('1:30');
    expect(formatRemaining(600)).toBe('10:00');
  });
});
