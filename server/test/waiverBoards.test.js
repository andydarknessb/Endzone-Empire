const { test } = require('node:test');
const assert = require('node:assert/strict');
const waiverBoards = require('../services/waiverBoards');

// The article's "The Full Board" table order (Week 4 2026 Darkness Report).
const WEEK4_NAMES = [
  'Braelon Allen',
  'Ollie Gordon II',
  'Kenyon Sadiq',
  'Alvin Kamara',
  'Keenan Allen',
  'Jaylen Wright',
  'Darren Waller',
  'Jakobi Meyers',
  'Sam Darnold',
  'Jacoby Brissett',
  "Wan'Dale Robinson",
  'Geno Smith',
  'Mack Hollins',
  "Tre' Harris",
  'Kirk Cousins',
  'Mike Gesicki',
  'Marcus Mariota',
  'Kendre Miller',
];

test('getBoard(2026, 4) lists the 18 Darkness Report players in the column order', () => {
  const board = waiverBoards.getBoard(2026, 4);
  assert.ok(board, 'Week 4 2026 board is listed');
  assert.equal(board.season, 2026);
  assert.equal(board.week, 4);
  assert.equal(board.entries.length, 18);
  assert.deepEqual(
    board.entries.map((e) => e.name),
    WEEK4_NAMES
  );
  assert.equal(board.entries[0].name, 'Braelon Allen');
  assert.equal(board.entries[17].name, 'Kendre Miller');
});

test('every Week 4 entry has a distinct positive integer playerId', () => {
  const { entries } = waiverBoards.getBoard(2026, 4);
  for (const e of entries) {
    assert.ok(Number.isInteger(e.playerId) && e.playerId > 0, `${e.name} playerId`);
  }
  assert.equal(new Set(entries.map((e) => e.playerId)).size, entries.length);
});

test('every Week 4 entry has an integer bid range 1..100 with bidMin <= bidMax', () => {
  const { entries } = waiverBoards.getBoard(2026, 4);
  for (const e of entries) {
    for (const bid of [e.bidMin, e.bidMax]) {
      assert.ok(Number.isInteger(bid) && bid >= 1 && bid <= 100, `${e.name} bid ${bid}`);
    }
    assert.ok(e.bidMin <= e.bidMax, `${e.name} bidMin <= bidMax`);
  }
});

test('every Week 4 entry carries a non-empty reason', () => {
  const { entries } = waiverBoards.getBoard(2026, 4);
  for (const e of entries) {
    assert.equal(typeof e.reason, 'string');
    assert.ok(e.reason.trim().length > 0, `${e.name} reason`);
  }
});

// The article's "The Full Board" table order (Week 5 2026 Darkness Report).
const WEEK5_NAMES = [
  'Emanuel Wilson',
  'Keon Coleman',
  'T.J. Hockenson',
  'MarShawn Lloyd',
  'Kirk Cousins',
  'C.J. Stroud',
  'Will Shipley',
  'Brenton Strange',
  'Brian Robinson Jr.',
  'Athan Kaliakmanis',
  'Darius Cooper',
  'Jalon Daniels',
  'Michael Mayer',
  'Tyler Allgeier',
  'Tyson Bagent',
  'Dohnte Meyers',
  'Keaton Mitchell',
  'Malik Washington',
  'Isaac TeSlaa',
  'Roman Wilson',
];

test('getBoard(2026, 5) lists the 20 Darkness Report players in the column order', () => {
  const board = waiverBoards.getBoard(2026, 5);
  assert.ok(board, 'Week 5 2026 board is listed');
  assert.equal(board.season, 2026);
  assert.equal(board.week, 5);
  assert.equal(board.entries.length, 20);
  assert.deepEqual(
    board.entries.map((e) => e.name),
    WEEK5_NAMES
  );
  assert.equal(board.entries[0].name, 'Emanuel Wilson');
  assert.equal(board.entries[19].name, 'Roman Wilson');
});

test('every Week 5 entry has a distinct positive integer playerId', () => {
  const { entries } = waiverBoards.getBoard(2026, 5);
  for (const e of entries) {
    assert.ok(Number.isInteger(e.playerId) && e.playerId > 0, `${e.name} playerId`);
  }
  assert.equal(new Set(entries.map((e) => e.playerId)).size, entries.length);
});

test('every Week 5 entry has an integer bid range 1..100 with bidMin <= bidMax', () => {
  const { entries } = waiverBoards.getBoard(2026, 5);
  for (const e of entries) {
    for (const bid of [e.bidMin, e.bidMax]) {
      assert.ok(Number.isInteger(bid) && bid >= 1 && bid <= 100, `${e.name} bid ${bid}`);
    }
    assert.ok(e.bidMin <= e.bidMax, `${e.name} bidMin <= bidMax`);
  }
});

test('every Week 5 entry carries a non-empty reason', () => {
  const { entries } = waiverBoards.getBoard(2026, 5);
  for (const e of entries) {
    assert.equal(typeof e.reason, 'string');
    assert.ok(e.reason.trim().length > 0, `${e.name} reason`);
  }
});

test('a week with no board returns null', () => {
  assert.equal(waiverBoards.getBoard(2026, 3), null);
});
