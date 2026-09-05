import { matchupHeroView, heroSentence, formatKickoff, ordinal } from './matchupHeroView';

// The canvas's live Sunday (docs/design/game-center-matchups/build.mjs, HERO):
// the viewer's Dockworkers ahead 82.2-77.0, projected to lose 110.5-123.9,
// with four of theirs and six of the Frostbite's starters still to play.
const dock = { teamId: 10, name: 'Duluth Dockworkers', score: '82.2', expectedFinal: '110.5', playersRemaining: 4 };
const frost = { teamId: 20, name: 'Fargo Frostbite', score: '77.0', expectedFinal: '123.9', playersRemaining: 6 };

const live = {
  id: 7,
  week: 3,
  final: false,
  status: 'live',
  firstKickoffAt: '2026-09-20T17:00:00.000Z',
  syncedAt: '2026-09-20T20:42:00.000Z',
  home: dock,
  away: frost,
};

describe('heroSentence', () => {
  test.each([
    ['the canvas sentence, from the home viewer', { me: dock, them: frost, status: 'live' }, 'Ahead now, projected to trail by 13.4 with 6 of theirs still to play'],
    ['the same matchup from the away viewer', { me: frost, them: dock, status: 'live' }, 'Behind now, projected to lead by 13.4 with 4 of theirs still to play'],
    ['names the viewer\'s own starters when the opponent has none left', { me: { ...dock, playersRemaining: 3 }, them: { ...frost, playersRemaining: 0 }, status: 'live' }, 'Ahead now, projected to trail by 13.4 with 3 of yours still to play'],
    ['drops the remaining clause when nobody has anyone left', { me: { ...dock, playersRemaining: 0 }, them: { ...frost, playersRemaining: 0 }, status: 'live' }, 'Ahead now, projected to trail by 13.4'],
    ['drops the projection when an Expected final is unknown', { me: { ...dock, expectedFinal: null }, them: frost, status: 'live' }, 'Ahead now with 6 of theirs still to play'],
    ['a projected tie reads as even', { me: { ...dock, expectedFinal: '100.0' }, them: { ...frost, expectedFinal: '100.04' }, status: 'live' }, 'Ahead now, projected to finish even with 6 of theirs still to play'],
    ['a level score reads as tied now', { me: { ...dock, score: '50.0' }, them: { ...frost, score: '50.0' }, status: 'live' }, 'Tied now, projected to trail by 13.4 with 6 of theirs still to play'],
    ['awaiting the final while ahead', { me: dock, them: frost, status: 'played' }, 'Ahead by 5.2, awaiting the final'],
    ['awaiting the final while behind', { me: frost, them: dock, status: 'played' }, 'Behind by 5.2, awaiting the final'],
    ['awaiting the final while tied', { me: { score: '1' }, them: { score: '1' }, status: 'played' }, 'Tied, awaiting the final'],
    ['a win once final', { me: dock, them: frost, status: 'final' }, 'Won by 5.2'],
    ['a loss once final', { me: frost, them: dock, status: 'final' }, 'Lost by 5.2'],
    ['a tie once final', { me: { score: '88.8' }, them: { score: '88.8' }, status: 'final' }, 'Tied'],
  ])('%s', (_label, input, expected) => {
    expect(heroSentence(input)).toBe(expected);
  });
});

describe('matchupHeroView', () => {
  test('finds the viewer side by Team id, not by home/away', () => {
    expect(matchupHeroView(live, 20).viewerSide).toBe('away');
    expect(matchupHeroView(live, 10).viewerSide).toBe('home');
    expect(matchupHeroView(live, 99).viewerSide).toBeNull();
    expect(matchupHeroView(live, null).viewerSide).toBeNull();
  });

  test('a live matchup carries the canvas percentages, the sentence and no kickoff', () => {
    const view = matchupHeroView(live, 10);
    expect(view.hasStarted).toBe(true);
    expect(view.chipLabel).toBe('LIVE');
    expect(view.chipVariant).toBe('live');
    expect(view.winProbability).toMatchObject({ homePct: 36, awayPct: 64 });
    expect(view.sentence).toBe('Ahead now, projected to trail by 13.4 with 6 of theirs still to play');
    expect(view.kickoff).toBeNull();
  });

  test('the sentence is written from the viewer side', () => {
    expect(matchupHeroView(live, 20).sentence).toBe(
      'Behind now, projected to lead by 13.4 with 4 of theirs still to play'
    );
  });

  test('the two percentages always sum to 100, the way SplitBar rounds', () => {
    const view = matchupHeroView(
      { ...live, home: { ...dock, expectedFinal: '100.25' }, away: { ...frost, expectedFinal: '100.0' } },
      10
    );
    expect(view.winProbability.homePct + view.winProbability.awayPct).toBe(100);
  });

  test('a scheduled matchup carries the kickoff line and neither bar nor sentence', () => {
    const view = matchupHeroView({ ...live, status: 'scheduled' }, 10);
    expect(view.hasStarted).toBe(false);
    expect(view.chipLabel).toBe('Scheduled');
    expect(view.chipVariant).toBe('neutral');
    expect(view.kickoff).toBe(formatKickoff(live.firstKickoffAt));
    expect(view.winProbability).toBeNull();
    expect(view.sentence).toBeNull();
  });

  test('a scheduled matchup without a kickoff time reads null, not Invalid Date', () => {
    expect(matchupHeroView({ ...live, status: 'scheduled', firstKickoffAt: null }, 10).kickoff).toBeNull();
    expect(matchupHeroView({ ...live, status: 'scheduled', firstKickoffAt: 'soon' }, 10).kickoff).toBeNull();
  });

  test('an unknown status asserts neither state and renders no chip', () => {
    for (const status of [null, undefined, 'postponed']) {
      const view = matchupHeroView({ ...live, status }, 10);
      expect(view.hasStarted).toBeNull();
      expect(view.chipLabel).toBeNull();
      expect(view.winProbability).toBeNull();
      expect(view.sentence).toBeNull();
      expect(view.kickoff).toBeNull();
    }
  });

  test('a final matchup with no Expected final still has a bar from the scores alone', () => {
    const view = matchupHeroView(
      {
        ...live,
        status: 'final',
        final: true,
        home: { ...dock, expectedFinal: null, playersRemaining: 0 },
        away: { ...frost, expectedFinal: null, playersRemaining: 0 },
      },
      10
    );
    expect(view.winProbability.homePct).toBeGreaterThan(50);
    expect(view.sentence).toBe('Won by 5.2');
  });
});

describe('formatKickoff', () => {
  test('formats weekday short plus time with Intl, in the runtime locale', () => {
    const iso = '2026-09-20T23:20:00.000Z';
    const expected = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso));
    expect(formatKickoff(iso)).toBe(expected);
    // Weekday short and a clock time are both present whatever the zone.
    expect(formatKickoff(iso)).toMatch(/^[A-Z][a-z]{2}\b/);
    expect(formatKickoff(iso)).toMatch(/\d{1,2}:\d{2}/);
  });

  test('reads null for a missing or unparseable value', () => {
    expect(formatKickoff(null)).toBeNull();
    expect(formatKickoff('')).toBeNull();
    expect(formatKickoff('not a date')).toBeNull();
  });
});

describe('ordinal', () => {
  test.each([
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
    [4, '4th'],
    [11, '11th'],
    [12, '12th'],
    [13, '13th'],
    [21, '21st'],
    [22, '22nd'],
    [23, '23rd'],
    [111, '111th'],
  ])('%s -> %s', (n, expected) => {
    expect(ordinal(n)).toBe(expected);
  });

  test('is null for a non-rank', () => {
    expect(ordinal(0)).toBeNull();
    expect(ordinal(-3)).toBeNull();
    expect(ordinal(NaN)).toBeNull();
    expect(ordinal('3')).toBeNull();
    expect(ordinal(null)).toBeNull();
  });
});
