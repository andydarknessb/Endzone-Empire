import {
  formatPoints,
  formatStatLine,
  lineTwo,
  starterStateView,
} from './slotComparisonModel';

describe('formatStatLine', () => {
  test('joins the recorded fields on a middot in reading order and drops zeros', () => {
    expect(formatStatLine({
      passingYards: 289, passingTDs: 2, interceptions: 1, rushingYards: 0, fumbles: null,
    })).toBe('289 pass yds · 2 pass TD · 1 INT');
    expect(formatStatLine({ rushingYards: 71, rushingTDs: 1, receptions: 3, receivingYards: 22 }))
      .toBe('71 rush yds · 1 rush TD · 3 rec · 22 rec yds');
  });

  // Live week-6 rows: an IDP's line carries zeroed offense keys, a D/ST's only team-defense keys.
  test('reads an IDP line and a D/ST line, keeping a D/ST shutout as 0 PA', () => {
    expect(formatStatLine({
      soloTackle: 6, assistedTackle: 2, idpSack: 0, passingYards: 0, receptions: 0, fumbles: 0,
    })).toBe('6 Solo · 2 Ast');
    expect(formatStatLine({
      sack: 2, safety: 0, blockedKick: 0, defensiveTD: 0, yardsAllowed: 399, pointsAllowed: 25,
      fumbleRecovery: 0, interceptionReturn: 0,
    })).toBe('2 Sk · 25 PA · 399 YdA');
    expect(formatStatLine({ sack: 0, pointsAllowed: 0, yardsAllowed: 0 })).toBe('0 PA');
  });

  test('is empty when nothing is recorded', () => {
    expect(formatStatLine(null)).toBe('');
    expect(formatStatLine({})).toBe('');
    expect(formatStatLine({ passingYards: 0 })).toBe('');
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

describe('lineTwo', () => {
  test('reads team, opponent and clock with middots, dropping what is absent', () => {
    expect(lineTwo({ nfl_team: 'GB', opponent: 'TB', game_clock: 'Q3 6:42' })).toBe('GB vs TB · Q3 6:42');
    expect(lineTwo({ nfl_team: 'DET', opponent: 'CHI', game_clock: null })).toBe('DET vs CHI');
    expect(lineTwo({ nfl_team: 'HOU', opponent: null, game_clock: null })).toBe('HOU');
    expect(lineTwo({ nfl_team: null, opponent: null, game_clock: null })).toBe('');
  });
});

describe('formatPoints', () => {
  test('formats points to one decimal, zero for nothing', () => {
    expect(formatPoints(18.64)).toBe('18.6');
    expect(formatPoints(null)).toBe('0.0');
    expect(formatPoints('7')).toBe('7.0');
  });
});
