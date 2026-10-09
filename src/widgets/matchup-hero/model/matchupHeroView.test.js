import { matchupHeroView } from './matchupHeroView';
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
    expect(view.chipDot).toBe(false);
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

// formatKickoff itself is shared/lib's contract now (src/shared/lib/
// kickoff(.test).js, #1120, ADR 0031); this view model only consumes it, so
// its own tests live there. ordinal is likewise shared/lib's contract now
// (src/shared/lib/ordinal(.test).js, #1272 Addendum): this view model no
// longer exports its own copy.
