import { matchupFromDetailBody } from '../../../entities/matchup';
import {
  scoreboardView,
  formatScore,
  formatExpectedFinal,
  formatPlayersRemaining,
} from './scoreboardView';

// One live Sunday afternoon, the canvas's sample (HERO in build.mjs): the
// numbers below are the ones the design source derives its 36% / 64% from.
const detail = (overrides = {}) => matchupFromDetailBody({
  matchup: {
    id: 7, season: 2026, week: 3, final: false, status: 'live', home_score: 82.2, away_score: 77.0,
    ...overrides.matchup,
  },
  home: { teamId: 12, name: 'Duluth Dockworkers', expectedFinal: 110.5, playersRemaining: 4, ...overrides.home },
  away: { teamId: 34, name: 'Fargo Frostbite', expectedFinal: 123.9, playersRemaining: 6, ...overrides.away },
});

test('formats a score to one decimal and a missing score as 0.0', () => {
  expect(formatScore(82.2)).toBe('82.2');
  expect(formatScore('77')).toBe('77.0');
  expect(formatScore(null)).toBe('0.0');
  expect(formatScore(undefined)).toBe('0.0');
});

test('formats Expected final to one decimal and Players remaining as an integer, null when unknown', () => {
  expect(formatExpectedFinal(110.5)).toBe('110.5');
  expect(formatExpectedFinal('123.9')).toBe('123.9');
  expect(formatExpectedFinal(null)).toBeNull();
  expect(formatExpectedFinal('n/a')).toBeNull();
  expect(formatPlayersRemaining(4)).toBe('4');
  expect(formatPlayersRemaining('6')).toBe('6');
  expect(formatPlayersRemaining(0)).toBe('0');
  expect(formatPlayersRemaining(null)).toBeNull();
});

test('derives both sides from the entity model: names, scores, figures and complementary percentages', () => {
  const view = scoreboardView(detail());
  expect(view.home).toMatchObject({
    teamId: 12, name: 'Duluth Dockworkers', score: '82.2', expectedFinal: '110.5', playersRemaining: '4', winPct: 36,
  });
  expect(view.away).toMatchObject({
    teamId: 34, name: 'Fargo Frostbite', score: '77.0', expectedFinal: '123.9', playersRemaining: '6', winPct: 64,
  });
  expect(view.home.winPct + view.away.winPct).toBe(100);
  expect(Math.round(view.homeShare * 100)).toBe(view.home.winPct);
});

// The bar is gated on `hasStarted === true` and nothing looser. Red-tell:
// gating on `hasStarted !== false` turns the null-status case red and no other.
test.each([
  ['live', true],
  ['played', true],
  ['final', true],
  ['scheduled', false],
  [null, false],
  ['bogus', false],
])('showBar for status %p is %p', (status, expected) => {
  expect(scoreboardView(detail({ matchup: { status } })).showBar).toBe(expected);
});

test.each([
  ['live', { label: 'LIVE', variant: 'live' }],
  ['played', { label: 'Awaiting final', variant: 'neutral' }],
  ['final', { label: 'Final', variant: 'neutral' }],
  ['scheduled', { label: 'Scheduled', variant: 'neutral' }],
  [null, null],
  ['bogus', null],
])('chip for status %p', (status, expected) => {
  expect(scoreboardView(detail({ matchup: { status } })).chip).toEqual(expected);
});

test('marks the viewer side by a strict, null-guarded Team id match', () => {
  expect(scoreboardView(detail(), { viewerTeamId: 12 }).home.isViewer).toBe(true);
  expect(scoreboardView(detail(), { viewerTeamId: 12 }).away.isViewer).toBe(false);
  expect(scoreboardView(detail(), { viewerTeamId: 34 }).away.isViewer).toBe(true);
  expect(scoreboardView(detail(), { viewerTeamId: 99 }).home.isViewer).toBe(false);
  expect(scoreboardView(detail(), { viewerTeamId: null }).home.isViewer).toBe(false);
  expect(scoreboardView(detail()).home.isViewer).toBe(false);
});

test('reads a record through an object lookup or a function, and none without one', () => {
  const byObject = scoreboardView(detail(), { records: { 12: '2-0', 34: '1-1' } });
  expect(byObject.home.record).toBe('2-0');
  expect(byObject.away.record).toBe('1-1');
  const byFn = scoreboardView(detail(), { records: (teamId) => (teamId === 12 ? '3-0' : null) });
  expect(byFn.home.record).toBe('3-0');
  expect(byFn.away.record).toBeNull();
  expect(scoreboardView(detail()).home.record).toBeNull();
  expect(scoreboardView(detail(), { records: {} }).home.record).toBeNull();
});

test('falls back to Home / Away for a side with no name and survives an empty model', () => {
  const view = scoreboardView(detail({ home: { name: null }, away: { name: '' } }));
  expect(view.home.name).toBe('Home');
  expect(view.away.name).toBe('Away');
  const empty = scoreboardView(null);
  expect(empty.home.score).toBe('0.0');
  expect(empty.showBar).toBe(false);
  expect(empty.chip).toBeNull();
});
