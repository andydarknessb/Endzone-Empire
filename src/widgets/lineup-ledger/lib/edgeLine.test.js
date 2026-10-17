import { EDGE_LINE_KINDS, edgeLineColor, displayEdgeKind } from './edgeLine';

test('the injury line reads in Ink and every other kind in Dim, never green or red', () => {
  expect(edgeLineColor('injury')).toBe('var(--ps-ink)');
  EDGE_LINE_KINDS.filter((kind) => kind !== 'injury').forEach((kind) => expect(edgeLineColor(kind)).toBe('var(--ps-dim)'));
});

test('an unknown kind reads in Dim rather than throwing', () => {
  expect(edgeLineColor('nonsense')).toBe('var(--ps-dim)');
});

// #1241 AC3: "the pace Edge line renders while the game is in progress and
// the result Edge line once final, following the entry's edge kind from the
// server on the next fetch and a client-side transition in between so the
// cell never shows a stale kind." The server's own edge.kind only refreshes
// on the next `GET /api/team/lineup`; the live game's own status (read
// instantly off the Realtime channel) drives the displayed kind in between,
// for the two kinds that are actually about game progress. Every
// higher-priority kind (injury, bench-above-starter, factor) - and `none` -
// never changes with game state, so it passes through untouched.
describe('displayEdgeKind', () => {
  test('a server kind of "pace" or "result" flips instantly with the Game cell\'s own live/final state', () => {
    expect(displayEdgeKind('pace', 'live')).toBe('pace');
    expect(displayEdgeKind('pace', 'final')).toBe('result');
    expect(displayEdgeKind('result', 'final')).toBe('result');
    expect(displayEdgeKind('result', 'live')).toBe('pace');
  });

  test('a higher-priority kind is never overridden by the live game state', () => {
    expect(displayEdgeKind('injury', 'final')).toBe('injury');
    expect(displayEdgeKind('bench-above-starter', 'live')).toBe('bench-above-starter');
    expect(displayEdgeKind('factor', 'final')).toBe('factor');
  });

  test('pre-kickoff or an unknown Game cell state keeps the server\'s own kind', () => {
    expect(displayEdgeKind('pace', 'pre')).toBe('pace');
    expect(displayEdgeKind('result', undefined)).toBe('result');
  });

  test('a null/none kind passes through unchanged', () => {
    expect(displayEdgeKind('none', 'live')).toBe('none');
    expect(displayEdgeKind(null, 'final')).toBeNull();
  });
});
