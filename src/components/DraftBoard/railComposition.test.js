import { railCompositionFor, RAIL_PANELS } from './railComposition';

// Issue #123 acceptance criteria 1-4. The rail used to be one permanently
// stacked list of panels; each draft status now gets a deliberate composition,
// and this is the single place that ordering is stated.

test('pending is Readiness, Draft order, then My Queue', () => {
  expect(railCompositionFor('pending')).toEqual([
    RAIL_PANELS.READINESS, RAIL_PANELS.ORDER, RAIL_PANELS.QUEUE,
  ]);
});

test('active is My Queue, My Roster, then the compact Upcoming strip', () => {
  // On the clock is the fourth member of the active composition and is
  // deliberately not a rail panel: it is the persistent banner above the
  // rail's own scrolling region (issue #122), which is what makes it
  // persistent at all. A copy inside the rail would scroll away.
  expect(railCompositionFor('active')).toEqual([
    RAIL_PANELS.QUEUE, RAIL_PANELS.ROSTER, RAIL_PANELS.UPCOMING,
  ]);
});

test('complete is My Roster alone - the completed record lives on the Board', () => {
  expect(railCompositionFor('complete')).toEqual([RAIL_PANELS.ROSTER]);
});

test('Readiness appears in no composition but pending', () => {
  // A fact of the pending lobby only; it has no meaning once the draft starts
  // (CONTEXT.md: Readiness).
  expect(railCompositionFor('active')).not.toContain(RAIL_PANELS.READINESS);
  expect(railCompositionFor('complete')).not.toContain(RAIL_PANELS.READINESS);
});

test('full Pick history is in no composition at all - it belongs to the Board', () => {
  // CONTEXT.md: Draft board. Pick history is the chronological view of the
  // same committed picks, so it is a view within Board, never a second rail
  // panel competing with live decisions.
  for (const status of ['pending', 'active', 'complete', null]) {
    expect(railCompositionFor(status)).not.toContain('pickHistory');
  }
});

test('an unknown status composes as active, so the rail is never blank mid-connect', () => {
  // league is null until the first draft:state frame arrives.
  expect(railCompositionFor(null)).toEqual(railCompositionFor('active'));
  expect(railCompositionFor(undefined)).toEqual(railCompositionFor('active'));
});
