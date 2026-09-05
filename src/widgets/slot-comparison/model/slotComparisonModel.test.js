import {
  columnTotals,
  formatPoints,
  formatStatLine,
  lineTwo,
  paceView,
  positionRingKey,
  starterStateView,
  unavailableLabel,
} from './slotComparisonModel';

describe('formatStatLine', () => {
  test('joins the recorded fields on a middot in reading order and drops zeros', () => {
    expect(formatStatLine({
      passingYards: 289, passingTDs: 2, interceptions: 1, rushingYards: 0, fumbles: null,
    })).toBe('289 pass yds · 2 pass TD · 1 INT');
    expect(formatStatLine({ rushingYards: 71, rushingTDs: 1, receptions: 3, receivingYards: 22 }))
      .toBe('71 rush yds · 1 rush TD · 3 rec · 22 rec yds');
  });

  test('is empty when nothing is recorded', () => {
    expect(formatStatLine(null)).toBe('');
    expect(formatStatLine({})).toBe('');
    expect(formatStatLine({ passingYards: 0 })).toBe('');
  });
});

describe('unavailableLabel', () => {
  test('names the reason in the Lineup page words, and nothing for an available row', () => {
    expect(unavailableLabel({ available: false, reason: 'bye' })).toBe('on bye');
    expect(unavailableLabel({ available: false, reason: 'out' })).toBe('out');
    expect(unavailableLabel({ available: false, reason: 'ir' })).toBe('on IR');
    expect(unavailableLabel({ available: false, reason: 'mystery' })).toBe('out');
    expect(unavailableLabel({ available: true, reason: null })).toBeNull();
    expect(unavailableLabel(null)).toBeNull();
  });
});

describe('starterStateView', () => {
  test('maps the three wire states to their markers and refuses an unknown one', () => {
    expect(starterStateView('in_progress')).toEqual({ kind: 'live', label: 'In progress' });
    expect(starterStateView('final')).toEqual({ kind: 'final', label: 'Final' });
    expect(starterStateView('scheduled')).toEqual({ kind: 'scheduled', label: 'Yet to play' });
    expect(starterStateView(null)).toBeNull();
    expect(starterStateView('played')).toBeNull();
  });
});

describe('paceView', () => {
  test('is the clamped share of the projection and whether the starter is at or ahead of it', () => {
    expect(paceView(4.8, 16.4)).toEqual({ percent: 29, ahead: false });
    expect(paceView(14.3, 13.8)).toEqual({ percent: 100, ahead: true });
    expect(paceView(13.8, 13.8)).toEqual({ percent: 100, ahead: true });
    expect(paceView(0, 12)).toEqual({ percent: 0, ahead: false });
  });

  test('is empty against a zero projection and null when nothing was projected', () => {
    expect(paceView(3, 0)).toEqual({ percent: 0, ahead: false });
    expect(paceView(3, null)).toBeNull();
    expect(paceView(3, undefined)).toBeNull();
    expect(paceView(3, 'n/a')).toBeNull();
  });
});

describe('columnTotals', () => {
  // The points-not-projections arithmetic itself is asserted once, in the
  // widget's footer test (#899's red-tell binds that one case alone); this
  // covers only the edges around it.
  test('reads a missing or non-numeric points as zero, an empty side as nothing, and no rows as zero', () => {
    expect(columnTotals([{ slot: 'K', home: { points: null, projected: null }, away: { points: 'x', projected: null } }]))
      .toEqual({ home: 0, away: 0 });
    expect(columnTotals([{ slot: 'K', home: null, away: null }])).toEqual({ home: 0, away: 0 });
    expect(columnTotals([])).toEqual({ home: 0, away: 0 });
    expect(columnTotals(null)).toEqual({ home: 0, away: 0 });
  });
});

describe('lineTwo', () => {
  test('reads team, opponent and clock with middots, dropping what is absent', () => {
    expect(lineTwo({ nfl_team: 'GB', opponent: 'TB', game_clock: 'Q3 6:42' })).toBe('GB vs TB · Q3 6:42');
    expect(lineTwo({ nfl_team: 'DET', opponent: 'CHI', game_clock: null })).toBe('DET vs CHI');
    expect(lineTwo({ nfl_team: 'HOU', opponent: null, game_clock: null })).toBe('HOU');
    expect(lineTwo({ nfl_team: null, opponent: null, game_clock: null })).toBe('');
  });
});

describe('positionRingKey and formatPoints', () => {
  test('rings by the position palette and falls back to the neutral gray', () => {
    expect(positionRingKey('QB')).toBe('qb');
    expect(positionRingKey('LB')).toBe('idp');
    expect(positionRingKey('DEF')).toBe('def');
    expect(positionRingKey('??')).toBe('def');
    expect(positionRingKey(null)).toBe('def');
  });

  test('formats points to one decimal, zero for nothing', () => {
    expect(formatPoints(18.64)).toBe('18.6');
    expect(formatPoints(null)).toBe('0.0');
    expect(formatPoints('7')).toBe('7.0');
  });
});
