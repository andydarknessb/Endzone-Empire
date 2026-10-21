import { draftCursorPlayerId } from './draftCursor';

const row = (id, isDrafted = false) => ({ id, isDrafted });
const rows = [row(1), row(2), row(3), row(4)];
const base = { onTheClock: true, canPick: true, queue: [], rows };

test.each([
  ['the first queued player on screen and not drafted', { queue: [{ id: 3 }, { id: 2 }] }, 3],
  [
    'skips a first queued player who is drafted',
    { queue: [{ id: 3 }, { id: 2 }], rows: [row(1), row(2), row(3, true), row(4)] },
    2,
  ],
  [
    'skips a first queued player filtered off screen',
    { queue: [{ id: 99 }, { id: 4 }] },
    4,
  ],
  ['an empty queue gives the first undrafted row', { rows: [row(1, true), row(2), row(3)] }, 2],
  ['a queue with nobody on screen falls back to the first undrafted row', { queue: [{ id: 99 }] }, 1],
  ['null when not on the clock', { onTheClock: false, queue: [{ id: 3 }] }, null],
  ['null when canPick is false', { canPick: false, queue: [{ id: 3 }] }, null],
  ['null when no rows qualify', { rows: [row(1, true), row(2, true)] }, null],
  ['null when there are no rows', { rows: [] }, null],
])('draftCursorPlayerId: %s', (_name, over, expected) => {
  expect(draftCursorPlayerId({ ...base, ...over })).toBe(expected);
});
