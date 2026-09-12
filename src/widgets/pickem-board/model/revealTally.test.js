import revealTally from './revealTally';

// THE RED-TELL (#1265's acceptance criteria, checked hardest): an unlocked
// game's gameKey is absent from the week response's othersPicks map, so a
// caller's lookup reads `undefined`, never `[]`.
test('an absent (unlocked) reveal renders no direction at all', () => {
  expect(revealTally({ othersPicks: undefined, myPick: 'BAL', totalManagers: 10 })).toBeNull();
  expect(revealTally({ othersPicks: null, myPick: 'BAL', totalManagers: 10 })).toBeNull();
});

// The same red-tell restated the way a real caller would trip it: never test
// `.length` on the WEEK-level `othersPicks` object (a plain object keyed by
// gameKey, not an array - `{}.length` is `undefined`), only on the per-game
// array a caller already looked up by gameKey.
test('a present-but-empty reveal (locked, nobody yet revealed) is NOT the same as absent', () => {
  expect(revealTally({ othersPicks: [], myPick: null, totalManagers: 10 })).toEqual({
    counts: {},
    noPick: 10,
  });
});

test('tallies revealed picks by team and folds in the viewer\'s own pick', () => {
  const result = revealTally({
    othersPicks: [
      { pickedTeam: 'BAL' },
      { pickedTeam: 'BAL' },
      { pickedTeam: 'IND' },
      { pickedTeam: 'IND' },
      { pickedTeam: 'BAL' },
      { pickedTeam: 'BAL' },
      { pickedTeam: 'BAL' },
      { pickedTeam: 'IND' },
    ],
    myPick: 'BAL',
    totalManagers: 10,
  });
  expect(result).toEqual({ counts: { BAL: 6, IND: 3 }, noPick: 1 });
});

test('a viewer who has not picked is not folded into any count', () => {
  const result = revealTally({
    othersPicks: [{ pickedTeam: 'BAL' }],
    myPick: null,
    totalManagers: 10,
  });
  expect(result).toEqual({ counts: { BAL: 1 }, noPick: 9 });
});

test('an unknown total manager count reads noPick as null rather than a guess', () => {
  const result = revealTally({ othersPicks: [{ pickedTeam: 'BAL' }], myPick: null, totalManagers: null });
  expect(result.noPick).toBeNull();
});

test('noPick never goes negative when the count somehow exceeds the league', () => {
  const result = revealTally({
    othersPicks: [{ pickedTeam: 'BAL' }, { pickedTeam: 'IND' }],
    myPick: 'BAL',
    totalManagers: 1,
  });
  expect(result.noPick).toBe(0);
});
