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
  'Will Shipley',
  'Keon Coleman',
  'T.J. Hockenson',
  'Kirk Cousins',
  'C.J. Stroud',
  'Jameis Winston',
  'Romeo Doubs',
  'Brenton Strange',
  'Brian Robinson Jr.',
  'Darius Cooper',
  'Jalon Daniels',
  'MarShawn Lloyd',
  'Michael Mayer',
  'Tyler Allgeier',
  'Tyson Bagent',
  'Dohnte Meyers',
  'Keaton Mitchell',
  'Malik Washington',
  'Isaac TeSlaa',
  'Roman Wilson',
];

test('getBoard(2026, 5) lists the 21 Darkness Report players in the column order', () => {
  const board = waiverBoards.getBoard(2026, 5);
  assert.ok(board, 'Week 5 2026 board is listed');
  assert.equal(board.season, 2026);
  assert.equal(board.week, 5);
  assert.equal(board.entries.length, 21);
  assert.deepEqual(
    board.entries.map((e) => e.name),
    WEEK5_NAMES
  );
  assert.equal(board.entries[0].name, 'Emanuel Wilson');
  assert.equal(board.entries[20].name, 'Roman Wilson');
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

// The article's "The Full Board" table order (Week 6 2026 Darkness Report).
const WEEK6_NAMES = [
  'Woody Marks',
  'Germie Bernard',
  'Jameis Winston',
  'Jordan Love',
  'Pat Freiermuth',
  'Aaron Rodgers',
  'DeMario Douglas',
  'MarShawn Lloyd',
  'Tyler Huntley',
  'Brandin Cooks',
  'Tyler Higbee',
  'Dameon Pierce',
  'Kimani Vidal',
  'Darius Cooper',
  'Keenan Allen',
  'Brenton Strange',
  'Kendrick Bourne',
  'Ryan Flournoy',
  'Chig Okonkwo',
  'Raheim Sanders',
  'Kendre Miller',
  'Isaiah Bond',
  'Kyle Williams',
  'Efton Chism III',
  'Corey Kiner',
];

test('getBoard(2026, 6) lists the 25 Darkness Report players in the column order', () => {
  const board = waiverBoards.getBoard(2026, 6);
  assert.ok(board, 'Week 6 2026 board is listed');
  assert.equal(board.season, 2026);
  assert.equal(board.week, 6);
  assert.equal(board.entries.length, 25);
  assert.deepEqual(
    board.entries.map((e) => e.name),
    WEEK6_NAMES
  );
  assert.equal(board.entries[0].name, 'Woody Marks');
  assert.equal(board.entries[24].name, 'Corey Kiner');
});

test('every Week 6 entry has a distinct positive integer playerId', () => {
  const { entries } = waiverBoards.getBoard(2026, 6);
  for (const e of entries) {
    assert.ok(Number.isInteger(e.playerId) && e.playerId > 0, `${e.name} playerId`);
  }
  assert.equal(new Set(entries.map((e) => e.playerId)).size, entries.length);
});

test('every Week 6 entry has an integer bid range 1..100 with bidMin <= bidMax', () => {
  const { entries } = waiverBoards.getBoard(2026, 6);
  for (const e of entries) {
    for (const bid of [e.bidMin, e.bidMax]) {
      assert.ok(Number.isInteger(bid) && bid >= 1 && bid <= 100, `${e.name} bid ${bid}`);
    }
    assert.ok(e.bidMin <= e.bidMax, `${e.name} bidMin <= bidMax`);
  }
});

test('every Week 6 entry carries a non-empty reason', () => {
  const { entries } = waiverBoards.getBoard(2026, 6);
  for (const e of entries) {
    assert.equal(typeof e.reason, 'string');
    assert.ok(e.reason.trim().length > 0, `${e.name} reason`);
  }
});

test('a week with no board returns null', () => {
  assert.equal(waiverBoards.getBoard(2026, 3), null);
});

// The article's "The Full Board" table order (Week 7 2026 Darkness Report).
const WEEK7_NAMES = [
  'Tanner McKee',
  'Omar Cooper Jr.',
  'DeMario Douglas',
  'C.J. Stroud',
  'Michael Penix Jr.',
  'Roschon Johnson',
  'Jaylin Noel',
  'Kyler Murray',
  'Aaron Rodgers',
  'Tre Tucker',
  "Ja'Kobi Lane",
  'Kendre Miller',
  'Michael Mayer',
  'Keenan Allen',
  'Hunter Henry',
  'Jaleel McLaughlin',
  'Bam Knight',
  'Colby Parkinson',
  'Ryan Flournoy',
  'J.J. McCarthy',
  'Geno Smith',
  'Jahan Dotson',
  'Jawhar Jordan',
  'Audric Estime',
  'Darnell Washington',
];

test('getBoard(2026, 7) lists the 25 Darkness Report players in the column order', () => {
  const board = waiverBoards.getBoard(2026, 7);
  assert.ok(board, 'Week 7 2026 board is listed');
  assert.equal(board.season, 2026);
  assert.equal(board.week, 7);
  assert.equal(board.entries.length, 25);
  assert.deepEqual(
    board.entries.map((e) => e.name),
    WEEK7_NAMES
  );
  assert.equal(board.entries[0].name, 'Tanner McKee');
  assert.equal(board.entries[24].name, 'Darnell Washington');
});

test('every Week 7 entry has a distinct positive integer playerId', () => {
  const { entries } = waiverBoards.getBoard(2026, 7);
  for (const e of entries) {
    assert.ok(Number.isInteger(e.playerId) && e.playerId > 0, `${e.name} playerId`);
  }
  assert.equal(new Set(entries.map((e) => e.playerId)).size, entries.length);
});

test('every Week 7 entry has an integer bid range 1..100 with bidMin <= bidMax', () => {
  const { entries } = waiverBoards.getBoard(2026, 7);
  for (const e of entries) {
    for (const bid of [e.bidMin, e.bidMax]) {
      assert.ok(Number.isInteger(bid) && bid >= 1 && bid <= 100, `${e.name} bid ${bid}`);
    }
    assert.ok(e.bidMin <= e.bidMax, `${e.name} bidMin <= bidMax`);
  }
});

test('every Week 7 entry carries a non-empty reason', () => {
  const { entries } = waiverBoards.getBoard(2026, 7);
  for (const e of entries) {
    assert.equal(typeof e.reason, 'string');
    assert.ok(e.reason.trim().length > 0, `${e.name} reason`);
  }
});

// The article's "The Full Board" table order (Week 8 2026 Darkness Report).
const WEEK8_NAMES = [
  'Jonah Coleman',
  'KC Concepcion',
  'Omar Cooper Jr.',
  'Malik Willis',
  'Antonio Williams',
  'Makai Lemon',
  'Keon Coleman',
  'Jacoby Brissett',
  'Michael Penix Jr.',
  'Greg Dulcich',
  'Geno Smith',
  'Chig Okonkwo',
  'Hunter Henry',
  'Tanner McKee',
  'Dameon Pierce',
  'Deshaun Watson',
  'Tez Johnson',
  'AJ Barner',
  'Mason Taylor',
  'Dylan Sampson',
  'Colby Parkinson',
  'Elic Ayomanor',
  'Ryan Flournoy',
  'Caleb Douglas',
  'Drew Sample',
];

test('getBoard(2026, 8) lists the 25 Darkness Report players in the column order', () => {
  const board = waiverBoards.getBoard(2026, 8);
  assert.ok(board, 'Week 8 2026 board is listed');
  assert.equal(board.season, 2026);
  assert.equal(board.week, 8);
  assert.equal(board.entries.length, 25);
  assert.deepEqual(
    board.entries.map((e) => e.name),
    WEEK8_NAMES
  );
  assert.equal(board.entries[0].name, 'Jonah Coleman');
  assert.equal(board.entries[0].playerId, 815);
  assert.equal(board.entries[0].bidMin, 10);
  assert.equal(board.entries[0].bidMax, 16);
  assert.equal(board.entries[24].name, 'Drew Sample');
});

test('every Week 8 entry has a distinct positive integer playerId', () => {
  const { entries } = waiverBoards.getBoard(2026, 8);
  for (const e of entries) {
    assert.ok(Number.isInteger(e.playerId) && e.playerId > 0, `${e.name} playerId`);
  }
  assert.equal(new Set(entries.map((e) => e.playerId)).size, entries.length);
});

test('every Week 8 entry has an integer bid range 1..100 with bidMin <= bidMax', () => {
  const { entries } = waiverBoards.getBoard(2026, 8);
  for (const e of entries) {
    for (const bid of [e.bidMin, e.bidMax]) {
      assert.ok(Number.isInteger(bid) && bid >= 1 && bid <= 100, `${e.name} bid ${bid}`);
    }
    assert.ok(e.bidMin <= e.bidMax, `${e.name} bidMin <= bidMax`);
  }
});

test('every Week 8 entry carries a non-empty reason', () => {
  const { entries } = waiverBoards.getBoard(2026, 8);
  for (const e of entries) {
    assert.equal(typeof e.reason, 'string');
    assert.ok(e.reason.trim().length > 0, `${e.name} reason`);
  }
});
