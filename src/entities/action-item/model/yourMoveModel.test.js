import { yourMoveModel } from './yourMoveModel';

const NOW = Date.parse('2026-10-15T17:00:00Z');
const at = (minutes) => new Date(NOW + minutes * 60000).toISOString();
const item = (id, over = {}) => ({
  id, type: 'lineup_problem', leagueId: 7, leagueName: 'L', title: `t${id}`, detail: null,
  severity: 'timed', deadlineAt: at(120), cta: { label: `go ${id}`, to: `/x/${id}` }, progress: null, ...over,
});

test('an empty list is empty: no cards, no lead, badge 0, not urgent', () => {
  expect(yourMoveModel([], { leagueId: 7, now: NOW })).toEqual({
    cards: [], lead: null, rest: [], badge: 0, empty: true, urgent: false,
  });
  expect(yourMoveModel(undefined, { leagueId: 7, now: NOW }).empty).toBe(true);
});

test('items sharing a deadline form one card with one foot per item', () => {
  const m = yourMoveModel([item('a', { deadlineAt: at(90) }), item('b', { deadlineAt: at(90) })], { leagueId: 7, now: NOW });
  expect(m.badge).toBe(1);
  expect(m.lead.items.map((i) => i.id)).toEqual(['a', 'b']);
  expect(m.lead.feet).toEqual([{ id: 'a', label: 'go a', to: '/x/a' }, { id: 'b', label: 'go b', to: '/x/b' }]);
  expect(m.rest).toEqual([]);
});

test('the same instant written differently still groups', () => {
  const m = yourMoveModel(
    [item('a', { deadlineAt: '2026-10-15T20:00:00Z' }), item('b', { deadlineAt: '2026-10-15T20:00:00.000Z' })],
    { leagueId: 7, now: NOW }
  );
  expect(m.badge).toBe(1);
});

test('cards run earliest deadline first; badge is the card count', () => {
  const m = yourMoveModel(
    [item('late', { deadlineAt: at(300) }), item('soon', { deadlineAt: at(30) }), item('soon2', { deadlineAt: at(30) }), item('mid', { deadlineAt: at(100) })],
    { leagueId: 7, now: NOW }
  );
  expect(m.cards.map((c) => c.items.map((i) => i.id))).toEqual([['soon', 'soon2'], ['mid'], ['late']]);
  expect(m.lead.items[0].id).toBe('soon');
  expect(m.rest).toHaveLength(2);
  expect(m.badge).toBe(3);
  expect(m.empty).toBe(false);
});

test('other leagues are filtered out', () => {
  const m = yourMoveModel([item('a'), item('b', { leagueId: 8 })], { leagueId: 7, now: NOW });
  expect(m.cards.flatMap((c) => c.items.map((i) => i.id))).toEqual(['a']);
  expect(yourMoveModel([item('b', { leagueId: 8 })], { leagueId: 7, now: NOW }).empty).toBe(true);
});

test('a string league id matches a numeric one', () => {
  expect(yourMoveModel([item('a')], { leagueId: '7', now: NOW }).badge).toBe(1);
});

test('null deadlines sort last, keep server order, and never group', () => {
  const m = yourMoveModel(
    [item('n1', { deadlineAt: null }), item('t', { deadlineAt: at(500) }), item('n2', { deadlineAt: null })],
    { leagueId: 7, now: NOW }
  );
  expect(m.cards.map((c) => c.items.map((i) => i.id))).toEqual([['t'], ['n1'], ['n2']]);
  expect(m.badge).toBe(3);
  expect(m.cards[1].deadlineAt).toBeNull();
});

test('urgent at 45 minutes, not at 61', () => {
  expect(yourMoveModel([item('a', { deadlineAt: at(45) })], { leagueId: 7, now: NOW }).urgent).toBe(true);
  expect(yourMoveModel([item('a', { deadlineAt: at(61) })], { leagueId: 7, now: NOW }).urgent).toBe(false);
});

test('a past deadline, a null deadline and another league do not make it urgent', () => {
  expect(yourMoveModel([item('a', { deadlineAt: at(-5) })], { leagueId: 7, now: NOW }).urgent).toBe(false);
  expect(yourMoveModel([item('a', { deadlineAt: null })], { leagueId: 7, now: NOW }).urgent).toBe(false);
  expect(yourMoveModel([item('a', { deadlineAt: at(10), leagueId: 8 })], { leagueId: 7, now: NOW }).urgent).toBe(false);
});

test('urgent looks at every item, not just the lead card', () => {
  const m = yourMoveModel([item('a', { deadlineAt: at(-5) }), item('b', { deadlineAt: at(20) })], { leagueId: 7, now: NOW });
  expect(m.urgent).toBe(true);
});

test('now may be a Date', () => {
  expect(yourMoveModel([item('a', { deadlineAt: at(45) })], { leagueId: 7, now: new Date(NOW) }).urgent).toBe(true);
});
