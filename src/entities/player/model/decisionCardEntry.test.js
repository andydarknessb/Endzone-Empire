import { toDecisionCardEntry } from './decisionCardEntry';

test('maps a raw player row into the Decision card entry shape', () => {
  expect(
    toDecisionCardEntry({
      id: 7,
      name: 'Breece Hall',
      position: 'RB',
      nfl_team: 'New York Jets',
      injury_status: 'Q',
      photo_url: 'https://cdn.example/breece.png',
    })
  ).toEqual({
    playerId: 7,
    name: 'Breece Hall',
    position: 'RB',
    nflTeam: 'New York Jets',
    slot: 'RB',
    injuryStatus: 'Q',
    photoUrl: 'https://cdn.example/breece.png',
  });
});

test('defaults injuryStatus and photoUrl to null when absent', () => {
  const entry = toDecisionCardEntry({ id: 1, name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills' });
  expect(entry.injuryStatus).toBeNull();
  expect(entry.photoUrl).toBeNull();
});

test('a null player maps to null', () => {
  expect(toDecisionCardEntry(null)).toBeNull();
});
