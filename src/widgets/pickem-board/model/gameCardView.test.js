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
    othersPicksForWeek: { 'DAL|WAS': [{ pickedTeam: 'DAL' }, { pickedTeam: 'WAS' }] },
    totalManagers: 10,
  });
  expect(view.reveal).toEqual({ counts: { DAL: 2, WAS: 1 }, noPick: 7 });
});

test('no outcome before the game is final', () => {
  const view = gameCardView({ game: baseGame(), myPicks: [], othersPicksForWeek: {} });
  expect(view.outcome).toBeNull();
});

test('final and correct', () => {
  const game = { ...baseGame(), locked: true, status: 'final', winner: 'DAL' };
  const view = gameCardView({
    game,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 9 }],
    othersPicksForWeek: {},
  });
  expect(view.outcome).toBe('correct');
});

test('final and missed', () => {
  const game = { ...baseGame(), locked: true, status: 'final', winner: 'DAL' };
  const view = gameCardView({
    game,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'WAS', confidence: 9 }],
    othersPicksForWeek: {},
  });
  expect(view.outcome).toBe('missed');
});

test('final with no pick made is neither correct nor missed', () => {
  const game = { ...baseGame(), locked: true, status: 'final', winner: 'DAL' };
  const view = gameCardView({ game, myPicks: [], othersPicksForWeek: {} });
  expect(view.outcome).toBe('no-pick');
});

test('a tie credits nobody, even a manager who picked', () => {
  const game = { ...baseGame(), locked: true, status: 'final', isTie: true, winner: null };
  const view = gameCardView({
    game,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 9 }],
    othersPicksForWeek: {},
  });
  expect(view.outcome).toBe('tie');
});

// The invariant #1318 exists to check: a game cannot be final without also
// being locked. `dim` (GameCard.jsx's sideProps) is derived from `phase`
// alone and `disabled` from `lock` alone, and it is this invariant - not
// convention - that keeps a dimmed monogram always also disabled (WCAG
// 1.4.3's inactive-component exemption). A wire row that is final but not
// locked would break that; the model must never produce it.
test('a final status with the game not yet locked never reaches phase final', () => {
  const game = { ...baseGame(), locked: false, status: 'final', winner: 'DAL' };
  const view = gameCardView({ game, myPicks: [], othersPicksForWeek: {} });
  expect(view.phase).toBe('open');
  expect(view.lock).toBe(false);
});

test('lockMinutes counts whole minutes for an open game under an hour out, and nothing else', () => {
  const game = baseGame(); // kicks off 2026-09-20T17:00:00Z
  const at = (iso) => gameCardView({ game, myPicks: [], othersPicksForWeek: {}, now: new Date(iso).getTime() });
  expect(at('2026-09-20T16:15:00Z').lockMinutes).toBe(45);
  expect(at('2026-09-20T16:15:30Z').lockMinutes).toBe(44);
  expect(at('2026-09-20T16:00:00Z').lockMinutes).toBeNull(); // exactly an hour is not under an hour
  expect(at('2026-09-20T15:00:00Z').lockMinutes).toBeNull();
  expect(at('2026-09-20T17:00:00Z').lockMinutes).toBeNull(); // locks inclusively at kickoff
  expect(gameCardView({ game, myPicks: [], othersPicksForWeek: {} }).lockMinutes).toBeNull(); // no clock
  const locked = { ...game, locked: true };
  expect(gameCardView({ game: locked, myPicks: [], othersPicksForWeek: {}, now: new Date('2026-09-20T16:15:00Z').getTime() }).lockMinutes).toBeNull();
});
