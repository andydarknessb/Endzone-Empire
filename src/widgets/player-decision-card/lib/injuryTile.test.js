import { injuryTileView } from './injuryTile';

test('null for a healthy player (no designation) or a missing entry', () => {
  expect(injuryTileView({ injuryStatus: null, edge: null })).toBeNull();
  expect(injuryTileView(null)).toBeNull();
});

test("the designation name, with the injury Edge line's own text as the detail", () => {
  const entry = { injuryStatus: 'Q', edge: { kind: 'injury', text: 'Hamstring, questionable for Sunday' } };
  expect(injuryTileView(entry)).toEqual({ name: 'Questionable', detail: 'Hamstring, questionable for Sunday' });
});

test('the designation name alone when the Edge line is showing a different kind', () => {
  const entry = { injuryStatus: 'Q', edge: { kind: 'factor', text: 'Matchup +3' } };
  expect(injuryTileView(entry)).toEqual({ name: 'Questionable', detail: null });
});

test('the designation name alone when there is no edge at all', () => {
  expect(injuryTileView({ injuryStatus: 'O', edge: null })).toEqual({ name: 'Out', detail: null });
});
