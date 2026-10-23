import { playModel, playName } from './playModel';

const NOW = Date.parse('2026-10-15T17:00:00Z');
const at = (minutes) => new Date(NOW + minutes * 60000).toISOString();
const item = (id, over = {}) => ({
  id, type: 'lineup_problem', leagueId: 7, leagueName: 'L', title: `t${id}`, detail: null,
  severity: 'timed', deadlineAt: at(120), cta: { label: `go ${id}`, to: `/x/${id}` }, progress: null, ...over,
});
const ids = (plays) => plays.map((p) => p.feet.map((f) => f.id));

test('an empty list is empty: no plays, no lead, count 0, not urgent', () => {
  expect(playModel([], { now: NOW })).toEqual({
    plays: [], sideline: [], lead: null, count: 0, empty: true, urgent: false,
  });
  expect(playModel(undefined, { now: NOW }).empty).toBe(true);
});

test('a lineup problem and a picks_open sharing a deadline in one league are one Play with two feet', () => {
  const m = playModel([
    item('lineup_problem:7', { deadlineAt: at(90) }),
    item('picks_open:7:2026-6', { type: 'picks_open', deadlineAt: at(90) }),
  ], { now: NOW });
  expect(m.count).toBe(1);
  expect(ids(m.plays)).toEqual([['lineup_problem:7', 'picks_open:7:2026-6']]);
  expect(m.lead).toBe(m.plays[0]);
});

test('the same pair across two leagues is one Play, feet ordered by league name, leagues listed', () => {
  const m = playModel([
    item('b', { leagueId: 2, leagueName: 'Zeta', deadlineAt: at(90) }),
    item('a', { leagueId: 1, leagueName: 'Alpha', type: 'picks_open', deadlineAt: at(90) }),
  ], { now: NOW });
  expect(m.count).toBe(1);
  expect(ids(m.plays)).toEqual([['a', 'b']]);
  expect(m.plays[0].leagues).toEqual(['Alpha', 'Zeta']);
});

test('two leagues sharing a name stay two leagues', () => {
  const m = playModel([
    item('a', { leagueId: 1, leagueName: 'Same', deadlineAt: at(90) }),
    item('b', { leagueId: 2, leagueName: 'Same', deadlineAt: at(90) }),
  ], { now: NOW });
  expect(m.plays[0].leagues).toEqual(['Same', 'Same']);
});

test('a Play names items by their type, not by the shape of their id', () => {
  const m = playModel([
    item('x1', { type: 'lineup_problem', deadlineAt: at(90) }),
    item('x2', { type: 'picks_open', deadlineAt: at(90) }),
  ], { now: NOW });
  expect(m.plays[0].name).toBe('Lineup and picks');
});

test('feet keep server order within a league', () => {
  const m = playModel([item('x', { deadlineAt: at(9) }), item('y', { deadlineAt: at(9) })], { now: NOW });
  expect(ids(m.plays)).toEqual([['x', 'y']]);
});

test('the same instant written differently still groups', () => {
  const m = playModel(
    [item('a', { deadlineAt: '2026-10-15T20:00:00Z' }), item('b', { deadlineAt: '2026-10-15T20:00:00.000Z' })],
    { now: NOW }
  );
  expect(m.count).toBe(1);
});

test('plays run earliest lock first; an untimed item is its own Play after the timed ones, in server order', () => {
  const m = playModel(
    [item('n1', { deadlineAt: null }), item('late', { deadlineAt: at(300) }), item('soon', { deadlineAt: at(30) }), item('n2', { deadlineAt: null })],
    { now: NOW }
  );
  expect(ids(m.plays)).toEqual([['soon'], ['late'], ['n1'], ['n2']]);
  expect(m.plays[2].deadlineAt).toBeNull();
});

test('info items and join requests are sideline, never Plays', () => {
  const m = playModel([
    item('waiver_claims:7', { type: 'waiver_claims', severity: 'info' }),
    item('join_requests:7', { type: 'join_requests', severity: 'timed', deadlineAt: null }),
    item('a'),
  ], { now: NOW });
  expect(ids(m.plays)).toEqual([['a']]);
  expect(m.sideline.map((i) => i.id)).toEqual(['waiver_claims:7', 'join_requests:7']);
  expect(playModel([item('w', { severity: 'info' })], { now: NOW }).empty).toBe(true);
});

test('with a leagueId only that league counts (string or number)', () => {
  const m = playModel([item('a'), item('b', { leagueId: 8 })], { leagueId: '7', now: NOW });
  expect(ids(m.plays)).toEqual([['a']]);
  expect(playModel([item('b', { leagueId: 8 })], { leagueId: 7, now: NOW }).empty).toBe(true);
});

test('a one-item Play takes the item title; a mixed Play joins its nouns', () => {
  const one = playModel([item('lineup_problem:7', { title: 'Set your lineup' })], { now: NOW });
  expect(one.plays[0].name).toBe('Set your lineup');
  const mixed = playModel([
    item('lineup_problem:7'), item('picks_open:7:2026-6', { type: 'picks_open' }),
  ], { now: NOW });
  expect(mixed.plays[0].name).toBe('Lineup and picks');
  expect(playName([{ id: 'x:1', title: 'Odd' }, { id: 'y:1', title: 'Other' }])).toBe('Odd and other');
});

test('urgent at 45 minutes, not at 61; past, untimed and sideline items do not make it urgent', () => {
  expect(playModel([item('a', { deadlineAt: at(45) })], { now: NOW }).urgent).toBe(true);
  expect(playModel([item('a', { deadlineAt: at(61) })], { now: NOW }).urgent).toBe(false);
  expect(playModel([item('a', { deadlineAt: at(-5) })], { now: NOW }).urgent).toBe(false);
  expect(playModel([item('a', { deadlineAt: null })], { now: NOW }).urgent).toBe(false);
  expect(playModel([item('a', { deadlineAt: at(10), severity: 'info' })], { now: NOW }).urgent).toBe(false);
});

test('urgent looks at every Play, not just the lead, and now may be a Date', () => {
  expect(playModel([item('a', { deadlineAt: at(-5) }), item('b', { deadlineAt: at(20) })], { now: NOW }).urgent).toBe(true);
  expect(playModel([item('a', { deadlineAt: at(45) })], { now: new Date(NOW) }).urgent).toBe(true);
});
