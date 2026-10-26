import { matchupFromDetailBody } from '../../../entities/matchup';
import { scoreboardView } from './scoreboardView';

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

test('prints the board\'s score text: one decimal, and 0.0 for a Matchup with no score rows yet', () => {
  const view = scoreboardView(detail({ matchup: { status: 'scheduled', home_score: null, away_score: undefined } }));
  expect(view.first.score).toBe('0.0');
  expect(view.second.score).toBe('0.0');
  expect(scoreboardView(detail()).first.score).toBe('82.2');
});

test('prints the board\'s Players remaining text, null when unknown', () => {
  const view = scoreboardView(detail({ home: { playersRemaining: 0 }, away: { playersRemaining: null } }));
  expect(view.first.playersRemaining).toBe('0');
  expect(view.second.playersRemaining).toBeNull();
});

test('marks the viewer side by Team id, not by name', () => {
  const view = scoreboardView(detail({ away: { name: 'Duluth Dockworkers' } }), { viewerTeamId: 34 });
  expect(view.first.isViewer).toBe(true);
  expect(view.second.isViewer).toBe(false);
});

test('an away viewer leads: first is their Team, keeping its origin, record, win share and Home / Away fallback', () => {
  const view = scoreboardView(detail({ home: { name: null }, away: { name: null } }), { viewerTeamId: 34, records: { 12: '2-0', 34: '1-1' } });
  expect(view.first).toMatchObject({ teamId: 34, origin: 'away', name: 'Away', record: '1-1', score: '77.0', winPct: 64 });
  expect(view.second).toMatchObject({ teamId: 12, origin: 'home', name: 'Home', record: '2-0', score: '82.2', winPct: 36 });
  expect(view.leader).toBe('second');
});

test('derives both sides from the entity model: names, scores, figures and complementary percentages', () => {
  const view = scoreboardView(detail());
  expect(view.first).toMatchObject({
    teamId: 12, name: 'Duluth Dockworkers', score: '82.2', expectedFinal: '110.5', playersRemaining: '4', winPct: 36,
  });
  expect(view.second).toMatchObject({
    teamId: 34, name: 'Fargo Frostbite', score: '77.0', expectedFinal: '123.9', playersRemaining: '6', winPct: 64,
  });
  expect(view.first.winPct + view.second.winPct).toBe(100);
  expect(Math.round(view.firstShare * 100)).toBe(view.first.winPct);
});

// The bar prices the scores once started and the projections before kickoff; a status the server
// could not state prices nothing (null, bogus), and a settled matchup states its result instead
// (#2007). Red-tell: defaulting the unknown status to 50/50 turns the null rows red.
test.each([
  ['live', true],
  ['played', false],
  ['final', false],
  ['scheduled', true],
  [null, false],
  ['bogus', false],
])('showBar for status %p is %p', (status, expected) => {
  expect(scoreboardView(detail({ matchup: { status } })).showBar).toBe(expected);
});

test('result is the settled line for played and final only, from the viewer side', () => {
  const settled = (status, viewerTeamId) => scoreboardView(
    detail({ matchup: { status, home_score: 115.9, away_score: 109.7 } }),
    { viewerTeamId },
  ).result;
  expect(settled('final', 12)).toBe('You won by 6.2');
  expect(settled('final', 99)).toBe('Duluth Dockworkers won by 6.2');
  expect(settled('played', 12)).toBe('Unofficial: You won by 6.2');
  expect(settled('live', 12)).toBeNull();
  expect(settled('scheduled', 12)).toBeNull();
  expect(settled(null, 12)).toBeNull();
});

// The chip variants are the canvas's statusChip() per status (#903 review),
// the hero's and the matchup cards' map, with the dot on LIVE alone.
// Red-tell: collapsing the map back to live-or-neutral turns the played and
// final rows red; a dot on every chip turns the other three rows red.
test.each([
  ['live', { label: 'LIVE', variant: 'danger', dot: true }],
  ['played', { label: 'Awaiting final', variant: 'warning', dot: false }],
  ['final', { label: 'Final', variant: 'success', dot: false }],
  ['scheduled', { label: 'Scheduled', variant: 'neutral', dot: false }],
  [null, null],
  ['bogus', null],
])('chip for status %p', (status, expected) => {
  expect(scoreboardView(detail({ matchup: { status } })).chip).toEqual(expected);
});

test('marks the viewer side by a strict, null-guarded Team id match', () => {
  expect(scoreboardView(detail(), { viewerTeamId: 12 }).first.isViewer).toBe(true);
  expect(scoreboardView(detail(), { viewerTeamId: 12 }).second.isViewer).toBe(false);
  expect(scoreboardView(detail(), { viewerTeamId: 34 }).first.isViewer).toBe(true);
  expect(scoreboardView(detail(), { viewerTeamId: 99 }).first.isViewer).toBe(false);
  expect(scoreboardView(detail(), { viewerTeamId: null }).first.isViewer).toBe(false);
  expect(scoreboardView(detail()).first.isViewer).toBe(false);
});

test('reads a record through an object lookup or a function, and none without one', () => {
  const byObject = scoreboardView(detail(), { records: { 12: '2-0', 34: '1-1' } });
  expect(byObject.first.record).toBe('2-0');
  expect(byObject.second.record).toBe('1-1');
  const byFn = scoreboardView(detail(), { records: (teamId) => (teamId === 12 ? '3-0' : null) });
  expect(byFn.first.record).toBe('3-0');
  expect(byFn.second.record).toBeNull();
  expect(scoreboardView(detail()).first.record).toBeNull();
  expect(scoreboardView(detail(), { records: {} }).first.record).toBeNull();
});

test('falls back to Home / Away for a side with no name and survives an empty model', () => {
  const view = scoreboardView(detail({ home: { name: null }, away: { name: '' } }));
  expect(view.first.name).toBe('Home');
  expect(view.second.name).toBe('Away');
  const empty = scoreboardView(null);
  expect(empty.first.score).toBe('0.0');
  expect(empty.showBar).toBe(false);
  expect(empty.chip).toBeNull();
});

test('once started the big figure is the score, and the margin is the leader by the gap in words', () => {
  const view = scoreboardView(detail());
  expect(view.started).toBe(true);
  expect(view.first.figure).toBe('82.2');
  expect(view.second.figure).toBe('77.0');
  expect(view.leader).toBe('first');
  expect(view.marginText).toBe('Duluth Dockworkers by 5.2');
  expect(scoreboardView(detail({ matchup: { home_score: 70, away_score: 77 } })).marginText).toBe('Fargo Frostbite by 7.0');
  expect(scoreboardView(detail({ matchup: { home_score: 77, away_score: 77 } })).marginText).toBe('Tied');
});

test('before kickoff the big figure is the Proj (the Expected final), not a 0.0 score, and the margin follows it', () => {
  const view = scoreboardView(detail({ matchup: { status: 'scheduled', home_score: 0, away_score: 0 } }));
  expect(view.started).toBe(false);
  expect(view.first.figure).toBe('110.5');
  expect(view.second.figure).toBe('123.9');
  expect(view.leader).toBe('second');
  expect(view.marginText).toBe('Fargo Frostbite by 13.4');
});

test('with no Proj there is no margin to state', () => {
  const view = scoreboardView(detail({ matchup: { status: 'scheduled' }, home: { expectedFinal: null } }));
  expect(view.first.figure).toBeNull();
  expect(view.marginText).toBeNull();
  expect(view.leader).toBeNull();
});
