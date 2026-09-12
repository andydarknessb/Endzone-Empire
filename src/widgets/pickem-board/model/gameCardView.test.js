import gameCardView from './gameCardView';

const baseGame = () => ({
  gameKey: 'DAL|WAS',
  teams: ['WAS', 'DAL'],
  kickoffAt: '2026-09-20T17:00:00Z',
  homeTeam: 'DAL',
  awayTeam: 'WAS',
  status: 'scheduled',
  homeScore: null,
  awayScore: null,
  quarter: null,
  timeRemaining: null,
  locked: false,
  winner: null,
  isTie: false,
  pickedCount: 3,
  line: null,
  weather: null,
  venue: null,
  broadcast: null,
  records: null,
  situation: null,
  linescores: null,
  headline: null,
});

// THE RED-TELL, at the composition boundary: an unlocked game whose gameKey
// is absent from the week's othersPicks map renders no direction at all,
// only the pickedCount.
test('an unlocked game with othersPicks absent renders no direction, only the count', () => {
  const view = gameCardView({
    game: baseGame(),
    myPicks: [],
    draftFor: () => null,
    othersPicksForWeek: {}, // present at the week level, but this gameKey never made it in
    totalManagers: 10,
  });
  expect(view.reveal).toBeNull();
  expect(view.pickedCount).toBe(3);
});

test('a locked game with revealed picks tallies them, folding in my own pick', () => {
  const game = { ...baseGame(), locked: true, status: 'in_progress' };
  const view = gameCardView({
    game,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 10 }],
    draftFor: () => null,
    othersPicksForWeek: { 'DAL|WAS': [{ pickedTeam: 'DAL' }, { pickedTeam: 'WAS' }] },
    totalManagers: 10,
  });
  expect(view.reveal).toEqual({ counts: { DAL: 2, WAS: 1 }, noPick: 7 });
});

test('a local draft overrides the server pick', () => {
  const view = gameCardView({
    game: baseGame(),
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 10 }],
    draftFor: () => ({ pickedTeam: 'WAS', confidence: 4 }),
    othersPicksForWeek: {},
    totalManagers: 10,
  });
  expect(view.myPick).toBe('WAS');
  expect(view.confidence).toBe(4);
});

test('no outcome before the game is final', () => {
  const view = gameCardView({ game: baseGame(), myPicks: [], draftFor: () => null, othersPicksForWeek: {} });
  expect(view.outcome).toBeNull();
});

test('final and correct', () => {
  const game = { ...baseGame(), locked: true, status: 'final', winner: 'DAL' };
  const view = gameCardView({
    game,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 9 }],
    draftFor: () => null,
    othersPicksForWeek: {},
  });
  expect(view.outcome).toBe('correct');
});

test('final and missed', () => {
  const game = { ...baseGame(), locked: true, status: 'final', winner: 'DAL' };
  const view = gameCardView({
    game,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'WAS', confidence: 9 }],
    draftFor: () => null,
    othersPicksForWeek: {},
  });
  expect(view.outcome).toBe('missed');
});

test('final with no pick made is neither correct nor missed', () => {
  const game = { ...baseGame(), locked: true, status: 'final', winner: 'DAL' };
  const view = gameCardView({ game, myPicks: [], draftFor: () => null, othersPicksForWeek: {} });
  expect(view.outcome).toBe('no-pick');
});

test('a tie credits nobody, even a manager who picked', () => {
  const game = { ...baseGame(), locked: true, status: 'final', isTie: true, winner: null };
  const view = gameCardView({
    game,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 9 }],
    draftFor: () => null,
    othersPicksForWeek: {},
  });
  expect(view.outcome).toBe('tie');
});

test('flagged passes through as given', () => {
  const view = gameCardView({
    game: baseGame(),
    myPicks: [],
    draftFor: () => null,
    othersPicksForWeek: {},
    flagged: true,
  });
  expect(view.flagged).toBe(true);
});
