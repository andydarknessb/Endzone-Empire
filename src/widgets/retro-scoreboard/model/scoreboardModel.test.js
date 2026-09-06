import {
  homeProbability,
  ledScore,
  ledFigure,
  ledPercents,
  ledStatus,
  matchupHasStarted,
  unavailableLabel,
  positionRingKey,
  lineupNoteParts,
  lineupNote,
  gameState,
  gameLine,
  gameClock,
  formatKickoff,
  liveCount,
} from './scoreboardModel';

// Table tests on the widget's pure presentation arithmetic. The sprite
// DIRECTION is deliberately not asserted here: the ticket's red-tell binds it
// to the one placement case in RetroScoreboard.test.jsx and no other.

test('homeProbability clamps a known value and flags an unknown one', () => {
  expect(homeProbability(0.36)).toEqual({ value: 0.36, known: true });
  expect(homeProbability(1.4)).toEqual({ value: 1, known: true });
  expect(homeProbability(-2)).toEqual({ value: 0, known: true });
  expect(homeProbability(0)).toEqual({ value: 0, known: true });
  expect(homeProbability(null)).toEqual({ value: 0.5, known: false });
  expect(homeProbability(undefined)).toEqual({ value: 0.5, known: false });
  expect(homeProbability('abc')).toEqual({ value: 0.5, known: false });
});

test('ledScore is always one decimal and ledFigure blanks a missing value', () => {
  expect(ledScore(82.2)).toBe('82.2');
  expect(ledScore(77)).toBe('77.0');
  expect(ledScore(null)).toBe('0.0');
  expect(ledFigure(110.54, 1)).toBe('110.5');
  expect(ledFigure(4, 0)).toBe('4');
  expect(ledFigure(0, 0)).toBe('0');
  expect(ledFigure(null, 1)).toBe('-');
  expect(ledFigure(undefined, 0)).toBe('-');
});

test('ledPercents rounds the home share and complements the away share', () => {
  expect(ledPercents(0.36)).toEqual({ home: '36%', away: '64%' });
  expect(ledPercents(0.005)).toEqual({ home: '1%', away: '99%' });
  expect(ledPercents(null)).toEqual({ home: '-', away: '-' });
});

test('ledStatus uppercases the entity label and is blank for an unknown status', () => {
  expect(ledStatus('live')).toBe('LIVE');
  expect(ledStatus('played')).toBe('AWAITING FINAL');
  expect(ledStatus('final')).toBe('FINAL');
  expect(ledStatus('scheduled')).toBe('SCHEDULED');
  expect(ledStatus(null)).toBe('');
});

// The started gate is `hasStarted === true` and nothing looser, the strip's
// rule (#903 review). Red-tell: gating on `hasStarted !== false` turns the
// null and bogus cases red and no other.
test.each([
  ['live', true],
  ['played', true],
  ['final', true],
  ['scheduled', false],
  [null, false],
  ['bogus', false],
])('matchupHasStarted(%p) is %p', (status, expected) => {
  expect(matchupHasStarted(status)).toBe(expected);
});

test('positionRingKey maps a position onto the pos-* palette and falls back to def', () => {
  expect(positionRingKey('QB')).toBe('qb');
  expect(positionRingKey('rb')).toBe('rb');
  expect(positionRingKey('WR')).toBe('wr');
  expect(positionRingKey('TE')).toBe('te');
  expect(positionRingKey('K')).toBe('k');
  expect(positionRingKey('DEF')).toBe('def');
  expect(positionRingKey('D/ST')).toBe('def');
  expect(positionRingKey('LB')).toBe('idp');
  expect(positionRingKey('CB')).toBe('idp');
  expect(positionRingKey('FLEX')).toBe('def');
  expect(positionRingKey(null)).toBe('def');
});

test('a lineup note is points and projection, or the Unavailable reason in its place', () => {
  expect(lineupNoteParts({ points: 18.6, projected: 19.2 })).toEqual({ points: '18.6', reason: null, projected: '19.2' });
  expect(lineupNoteParts({ points: 0, projected: 0, availability: { available: false, reason: 'bye' } }))
    .toEqual({ points: '0.0', reason: 'on bye', projected: null });
  expect(lineupNoteParts({ points: 4.2, projected: null })).toEqual({ points: '4.2', reason: null, projected: null });

  expect(lineupNote({ points: 18.6, projected: 19.2 })).toBe('18.6 · proj 19.2');
  expect(lineupNote({ points: 0, projected: 0, availability: { available: false, reason: 'bye' } })).toBe('0.0 · on bye');
  expect(lineupNote({ points: 2.5, projected: 8, availability: { available: false, reason: 'ir' } })).toBe('2.5 · on IR');
  expect(lineupNote({ points: 0, projected: 8, availability: { available: false, reason: 'out' } })).toBe('0.0 · out');
  expect(lineupNote({ points: 4.2, projected: null })).toBe('4.2');
  expect(unavailableLabel({ available: true })).toBeNull();
  expect(unavailableLabel(null)).toBeNull();
});

test('a game row reads as live, final or scheduled with the matching line and clock', () => {
  const live = { game_status: 'in_progress', quarter: 'Q3', time_remaining: '8:42', home_team: 'KC', away_team: 'DEN', current_score_home: 17, current_score_away: 10 };
  const clockless = { ...live, quarter: null, time_remaining: null };
  const final = { game_status: 'final', quarter: 'Final', home_team: 'CLE', away_team: 'BAL', current_score_home: 20, current_score_away: 24 };
  const scheduled = { game_status: 'scheduled', home_team: 'NYJ', away_team: 'CIN', current_score_home: 0, current_score_away: 0, start_time: null };

  expect(gameState(live)).toBe('live');
  expect(gameState(final)).toBe('final');
  expect(gameState(scheduled)).toBe('scheduled');
  expect(gameState(null)).toBe('scheduled');

  expect(gameLine(live)).toBe('DEN 10 - 17 KC');
  expect(gameLine(final)).toBe('BAL 24 - 20 CLE');
  expect(gameLine(scheduled)).toBe('CIN @ NYJ');

  expect(gameClock(live)).toBe('Q3 8:42');
  expect(gameClock(clockless)).toBe('LIVE');
  expect(gameClock(final)).toBe('FINAL');
  expect(gameClock(scheduled)).toBe('TBD');
  // The kickoff reads `kickoff_at` first, then the table's own `start_time`.
  expect(gameClock({ ...scheduled, start_time: '2026-09-20T23:20:00Z' })).toMatch(/\d{1,2}:\d{2}/);
  expect(gameClock({ ...scheduled, kickoff_at: '2026-09-20T23:20:00Z' })).toMatch(/\d{1,2}:\d{2}/);

  expect(liveCount([live, final, scheduled])).toBe(1);
  expect(liveCount(null)).toBe(0);
});

test('formatKickoff renders a clock time in the given zone and null for nothing usable', () => {
  expect(formatKickoff('2026-09-20T23:20:00Z', 'America/New_York')).toBe('7:20 PM');
  expect(formatKickoff('2026-09-20T23:20:00Z')).toMatch(/\d{1,2}:\d{2}/);
  expect(formatKickoff(null)).toBeNull();
  expect(formatKickoff('not a date')).toBeNull();
});
