import { matchupHeroView, compactScoreboardView } from './matchupHeroView';
import { formatKickoff } from '../../../shared/lib';

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

describe('matchupHeroView', () => {
  test('carries the board score text, 0.0 when the Matchup has no score yet', () => {
    expect(matchupHeroView(live, 10).scoreLabels).toEqual({ home: '82.2', away: '77.0' });
    const bare = { ...live, status: 'scheduled', home: { ...dock, score: null }, away: { ...frost, score: undefined } };
    expect(matchupHeroView(bare, 10).scoreLabels).toEqual({ home: '0.0', away: '0.0' });
  });

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
    expect(view.chipVariant).toBe('danger');
    expect(view.chipDot).toBe(true);
    expect(view.winProbability).toMatchObject({ homePct: 36, awayPct: 64 });
    expect(view.sentence).toBe('Ahead now, projected to trail by 13.4 · they have 6 players remaining');
    expect(view.kickoff).toBeNull();
  });

  test('the sentence is written from the viewer side', () => {
    expect(matchupHeroView(live, 20).sentence).toBe(
      'Behind now, projected to lead by 13.4 · they have 4 players remaining'
    );
  });

  // Critique 11 item 9 (spec #2334): "they have {n} players remaining, {k} yet to play", from the server's
  // yetToPlay on each side; "yet to play" means not started, and the count never mixes sources.
  test('the sentence reads the server yetToPlay, and singular for one', () => {
    const served = {
      ...live,
      home: { ...dock, yetToPlay: 1 },
      away: { ...frost, playersRemaining: 1, yetToPlay: 1 },
    };
    expect(matchupHeroView(served, 10).sentence)
      .toBe('Ahead now, projected to trail by 13.4 · they have 1 player remaining, 1 yet to play');
    expect(matchupHeroView({ ...served, away: { ...served.away, playersRemaining: 6, yetToPlay: 3 } }, 10).sentence)
      .toBe('Ahead now, projected to trail by 13.4 · they have 6 players remaining, 3 yet to play');
  });

  test('a page that computed its own counts hands them over and the sentence reads only those', () => {
    const counts = { home: { remaining: 2, yet: 0 }, away: { remaining: 5, yet: 2 } };
    expect(matchupHeroView({ ...live, away: { ...frost, yetToPlay: 9 } }, 10, { counts }).sentence)
      .toBe('Ahead now, projected to trail by 13.4 · they have 5 players remaining, 2 yet to play');
  });

  test('with none of theirs left it names the viewer own players', () => {
    const view = matchupHeroView({ ...live, away: { ...frost, playersRemaining: 0 }, home: { ...dock, yetToPlay: 1 } }, 10);
    expect(view.sentence).toBe('Ahead now, projected to trail by 13.4 · you have 4 players remaining, 1 yet to play');
  });

  test('the two percentages always sum to 100, the way TwoSidedOdds rounds', () => {
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
    expect(view.chipDot).toBe(false);
    expect(view.kickoff).toBe(formatKickoff(live.firstKickoffAt));
    expect(view.winProbability).toBeNull();
    expect(view.sentence).toBeNull();
  });

  // QA ruling (spec #2334): the bar is the Endzone Forecast's, so without an Expected final on both sides
  // there is no bar and no credit line, live or before kickoff.
  test.each([
    ['both null', null, null],
    ['home null', null, '123.9'],
    ['away null', '110.5', null],
  ])('a live matchup with %s Expected final has no win probability', (_name, homeFinal, awayFinal) => {
    const view = matchupHeroView({ ...live, home: { ...dock, expectedFinal: homeFinal }, away: { ...frost, expectedFinal: awayFinal } }, 10);
    expect(view.winProbability).toBeNull();
    expect(view.sentence).toMatch(/^Ahead now/);
  });

  test.each([
    ['both null', null, null],
    ['one null', '108.3', null],
  ])('a scheduled matchup with %s Expected final has no projected win probability', (_name, homeFinal, awayFinal) => {
    const view = matchupHeroView({ ...live, status: 'scheduled', home: { ...dock, expectedFinal: homeFinal }, away: { ...frost, expectedFinal: awayFinal } }, 10);
    expect(view.projectedWinProbability).toBeNull();
    expect(view.projectedMargin).toBeNull();
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

  test('a final matchup with no Expected final has no bar (nothing to price it from) and still states the result', () => {
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
    expect(view.winProbability).toBeNull();
    expect(view.sentence).toBe('You won by 5.2');
    // The canvas's `.chip.final`: the success chip, no live dot.
    expect(view.chipLabel).toBe('Final');
    expect(view.chipVariant).toBe('success');
    expect(view.chipDot).toBe(false);
  });

  // Red-tell (#897): collapsing the variant map back to live-or-neutral turns
  // this case and the final case above red (both read a third variant).
  test('a settled matchup states the board result line, in the same words as the Matchup page', () => {
    expect(matchupHeroView({ ...live, status: 'played' }, 10).sentence).toBe('Unofficial: You won by 5.2');
    expect(matchupHeroView({ ...live, status: 'final' }, 20).sentence).toBe('You lost by 5.2');
  });

  test('a played matchup carries the warning chip without the live dot', () => {
    const view = matchupHeroView({ ...live, status: 'played' }, 10);
    expect(view.chipLabel).toBe('Awaiting final');
    expect(view.chipVariant).toBe('warning');
    expect(view.chipDot).toBe(false);
  });
});

describe('compactScoreboardView', () => {
  test('puts the viewer first: home viewer left, away viewer left, a spectator keeps home left', () => {
    const home = compactScoreboardView(live, 10);
    expect([home.a.abbr, home.b.abbr]).toEqual(['DD', 'FF']);
    expect([home.a.score, home.b.score]).toEqual(['82.2', '77.0']);
    expect(home.lead).toBe('a');
    expect(home.marginText).toBe('Duluth Dockworkers by 5.2');
    const away = compactScoreboardView(live, 20);
    expect([away.a.abbr, away.b.abbr]).toEqual(['FF', 'DD']);
    expect([away.a.score, away.b.score]).toEqual(['77.0', '82.2']);
    expect(away.lead).toBe('b');
    expect(away.marginText).toBe('Duluth Dockworkers by 5.2');
    expect(compactScoreboardView(live, 99).a.abbr).toBe('DD');
  });

  test('is null before kickoff', () => {
    expect(compactScoreboardView({ ...live, status: 'scheduled' }, 10)).toBeNull();
  });
});

// formatKickoff itself is shared/lib's contract now (src/shared/lib/
// kickoff(.test).js, #1120, ADR 0031); this view model only consumes it, so
// its own tests live there. ordinal is likewise shared/lib's contract now
// (src/shared/lib/ordinal(.test).js, #1272 Addendum): this view model no
// longer exports its own copy.
