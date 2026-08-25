const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const pickem = require('../services/pickem.service');
const privacy = require('../services/privacy.service');

const KICKOFF = '2026-09-13T17:00:00.000Z';

const nflGameRows = (week, pairs) =>
  pairs.flatMap(([a, b, kickoff]) => [
    { week, nfl_team: a, opponent: b, kickoff_at: kickoff || KICKOFF },
    { week, nfl_team: b, opponent: a, kickoff_at: kickoff || KICKOFF },
  ]);

/* ------------------------------------------------------------------ *
 * pairKey / slate derivation                                          *
 * ------------------------------------------------------------------ */

test('pairKey is order- and case-insensitive, and rejects a bye-week row', () => {
  assert.equal(pickem.pairKey('mia', 'BUF'), 'BUF|MIA');
  assert.equal(pickem.pairKey('BUF', 'mia'), 'BUF|MIA');
  assert.equal(pickem.pairKey('  buf  ', 'MIA'), 'BUF|MIA');
  // nfl_games stores a null opponent on a bye week — no game to pick.
  assert.equal(pickem.pairKey('BUF', null), null);
  assert.equal(pickem.pairKey('', 'MIA'), null);
});

test('deriveSlateFromRows pairs the two nfl_games rows and takes the EARLIER kickoff', () => {
  const games = pickem.deriveSlateFromRows(
    [
      { week: 2, nfl_team: 'BUF', opponent: 'MIA', kickoff_at: '2026-09-13T17:00:05.000Z' },
      { week: 2, nfl_team: 'MIA', opponent: 'BUF', kickoff_at: '2026-09-13T17:00:00.000Z' },
    ],
    []
  );
  assert.equal(games.length, 1);
  assert.equal(games[0].gameKey, 'BUF|MIA');
  assert.deepEqual(games[0].teams, ['BUF', 'MIA']);
  // MIN of the pair: a half-synced schedule can never push a lock later.
  assert.equal(games[0].kickoffAt, '2026-09-13T17:00:00.000Z');
});

test('the slate is complete for a FUTURE week with no live_game_states rows at all', () => {
  const games = pickem.deriveSlateFromRows(
    nflGameRows(17, [['KC', 'DEN'], ['SF', 'SEA']]),
    [] // the live engine has not written a single row for week 17 yet
  );
  assert.equal(games.length, 2);
  for (const game of games) {
    assert.equal(game.status, 'scheduled');
    assert.equal(game.homeTeam, null);
    assert.equal(game.awayTeam, null);
    assert.equal(game.tank01GameId, null);
    assert.ok(game.kickoffAt); // locks come from nfl_games, never from lgs
  }
});

test('live_game_states overlays home/away, status and score onto the pair key', () => {
  const [game] = pickem.deriveSlateFromRows(nflGameRows(3, [['DAL', 'WAS']]), [
    {
      week: 3,
      tank01_game_id: '20260920_WAS@DAL',
      home_team: 'DAL',
      away_team: 'WAS',
      game_status: 'final',
      current_score_home: 17,
      current_score_away: 24,
      quarter: 'Final',
      time_remaining: null,
    },
  ]);
  assert.equal(game.gameKey, 'DAL|WAS');
  assert.equal(game.homeTeam, 'DAL');
  assert.equal(game.awayTeam, 'WAS');
  assert.equal(game.status, 'final');
  assert.equal(game.tank01GameId, '20260920_WAS@DAL');
  assert.deepEqual(pickem.winnerOf(game), { winner: 'WAS', isTie: false, final: true });
});

test('WSH/WAS and full-name DEF vocabulary only pair once SQL has normalized them', () => {
  // fn_normalize_nfl_team() folds WSH, WFT and 'WASHINGTON COMMANDERS' to WAS
  // in the query itself, so this is what the JS actually receives:
  const normalized = pickem.deriveSlateFromRows(nflGameRows(3, [['WAS', 'DAL']]), [
    { week: 3, home_team: 'DAL', away_team: 'WAS', game_status: 'in_progress',
      current_score_home: 7, current_score_away: 3 },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].status, 'in_progress');

  // And this is why normalizing in SQL is mandatory rather than nice-to-have:
  // raw Tank01 'WSH' against a full-name live row never pairs, silently
  // dropping the overlay from every Washington game.
  const raw = pickem.deriveSlateFromRows(nflGameRows(3, [['WSH', 'DAL']]), [
    { week: 3, home_team: 'Dallas Cowboys', away_team: 'Washington Commanders',
      game_status: 'in_progress', current_score_home: 7, current_score_away: 3 },
  ]);
  assert.equal(raw[0].gameKey, 'DAL|WSH');
  assert.equal(raw[0].status, 'scheduled');
  assert.equal(raw[0].homeTeam, null);
});

test('applyRecapFinals resolves a game the live table never marked final', () => {
  const slate = pickem.deriveSlateFromRows(nflGameRows(1, [['NYG', 'PHI']]), []);
  assert.equal(slate[0].status, 'scheduled');
  const resolved = pickem.applyRecapFinals(slate, [
    { week: 1, home_team: 'PHI', away_team: 'NYG', home_score: 31, away_score: 10 },
  ]);
  assert.equal(resolved[0].status, 'final');
  assert.equal(pickem.winnerOf(resolved[0]).winner, 'PHI');

  // A game the live table already finalized is left alone.
  const live = pickem.deriveSlateFromRows(nflGameRows(1, [['NYG', 'PHI']]), [
    { week: 1, home_team: 'PHI', away_team: 'NYG', game_status: 'final',
      current_score_home: 20, current_score_away: 17 },
  ]);
  const untouched = pickem.applyRecapFinals(live, [
    { week: 1, home_team: 'PHI', away_team: 'NYG', home_score: 99, away_score: 0 },
  ]);
  assert.equal(untouched[0].homeScore, 20);
});

/* ------------------------------------------------------------------ *
 * Locks and winners                                                   *
 * ------------------------------------------------------------------ */

test('a game locks INCLUSIVELY at kickoff, matching lineup.service lockedPlayerIds', () => {
  const game = { gameKey: 'BUF|MIA', kickoffAt: KICKOFF };
  const at = (ms) => new Date(Date.parse(KICKOFF) + ms);
  assert.equal(pickem.isGameLocked(game, at(-60_000)), false, 'a minute before kickoff');
  assert.equal(pickem.isGameLocked(game, at(-1)), false, 'one millisecond before kickoff');
  assert.equal(pickem.isGameLocked(game, at(0)), true, 'exactly at kickoff — inclusive');
  assert.equal(pickem.isGameLocked(game, at(1)), true, 'one millisecond after kickoff');
  assert.equal(pickem.isGameLocked(game, at(3 * 3600_000)), true, 'well into the game');
});

test('winnerOf resolves finals only, and a tie has no winner', () => {
  const base = { gameKey: 'BUF|MIA', homeTeam: 'BUF', awayTeam: 'MIA' };
  assert.deepEqual(
    pickem.winnerOf({ ...base, status: 'in_progress', homeScore: 21, awayScore: 0 }),
    { winner: null, isTie: false, final: false }
  );
  assert.deepEqual(
    pickem.winnerOf({ ...base, status: 'final', homeScore: 21, awayScore: 24 }),
    { winner: 'MIA', isTie: false, final: true }
  );
  assert.deepEqual(
    pickem.winnerOf({ ...base, status: 'final', homeScore: 24, awayScore: 24 }),
    { winner: null, isTie: true, final: true }
  );
  // Final but no home/away order (no live row, no recap) — ungradeable.
  assert.equal(
    pickem.winnerOf({ gameKey: 'BUF|MIA', status: 'final', homeTeam: null, awayTeam: null }).final,
    false
  );
});

/* ------------------------------------------------------------------ *
 * Validation                                                          *
 * ------------------------------------------------------------------ */

const slateOf = (week = 1) =>
  pickem.deriveSlateFromRows(
    nflGameRows(week, [
      ['BUF', 'MIA', '2026-09-10T00:20:00.000Z'],
      ['DAL', 'WAS', '2026-09-13T17:00:00.000Z'],
      ['KC', 'DEN', '2026-09-13T20:25:00.000Z'],
    ]),
    []
  );

const BEFORE_ALL = new Date('2026-09-09T12:00:00.000Z');

test('validatePicksPayload accepts a straight-up batch and nulls out confidence', () => {
  const result = pickem.validatePicksPayload({
    picks: [
      { gameKey: 'BUF|MIA', pickedTeam: 'buf', confidence: 3 },
      { gameKey: 'DAL|WAS', pickedTeam: 'WAS' },
    ],
    games: slateOf(),
    mode: 'straight',
    now: BEFORE_ALL,
  });
  assert.equal(result.code, null);
  assert.deepEqual(result.picks, [
    { gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: null },
    { gameKey: 'DAL|WAS', pickedTeam: 'WAS', confidence: null },
  ]);
});

test('validatePicksPayload rejects unknown games, duplicates and teams not in the game', () => {
  const games = slateOf();
  const unknown = pickem.validatePicksPayload({
    picks: [{ gameKey: 'ATL|CAR', pickedTeam: 'ATL' }],
    games, mode: 'straight', now: BEFORE_ALL,
  });
  assert.equal(unknown.code, 'PICKEM_BAD_GAME');
  assert.deepEqual(unknown.gameKeys, ['ATL|CAR']);

  const duplicated = pickem.validatePicksPayload({
    picks: [
      { gameKey: 'BUF|MIA', pickedTeam: 'BUF' },
      { gameKey: 'BUF|MIA', pickedTeam: 'MIA' },
    ],
    games, mode: 'straight', now: BEFORE_ALL,
  });
  assert.equal(duplicated.code, 'PICKEM_BAD_GAME');
  assert.deepEqual(duplicated.gameKeys, ['BUF|MIA']);

  const badTeam = pickem.validatePicksPayload({
    picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'NYJ' }],
    games, mode: 'straight', now: BEFORE_ALL,
  });
  assert.equal(badTeam.code, 'PICKEM_BAD_TEAM');
  assert.deepEqual(badTeam.gameKeys, ['BUF|MIA']);

  assert.equal(
    pickem.validatePicksPayload({ picks: [], games, mode: 'straight' }).code,
    'PICKEM_BAD_GAME'
  );
});

test('one kicked-off game rejects the WHOLE batch and names the offender', () => {
  const games = slateOf();
  const result = pickem.validatePicksPayload({
    picks: [
      { gameKey: 'BUF|MIA', pickedTeam: 'BUF' }, // Thursday, already kicked off
      { gameKey: 'DAL|WAS', pickedTeam: 'DAL' },
    ],
    games,
    mode: 'straight',
    now: new Date('2026-09-10T00:20:00.000Z'), // exactly BUF/MIA kickoff
  });
  assert.equal(result.code, 'PICKEM_LOCKED');
  assert.deepEqual(result.gameKeys, ['BUF|MIA']);
  assert.equal(result.picks, undefined, 'nothing is saved when any entry is locked');
});

test('confidence mode requires a whole number in 1..slateSize on every pick', () => {
  const games = slateOf();
  const missing = pickem.validatePicksPayload({
    picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF' }],
    games, mode: 'confidence', now: BEFORE_ALL,
  });
  assert.equal(missing.code, 'PICKEM_BAD_CONFIDENCE');

  const tooBig = pickem.validatePicksPayload({
    picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 4 }],
    games, mode: 'confidence', now: BEFORE_ALL,
  });
  assert.equal(tooBig.code, 'PICKEM_BAD_CONFIDENCE');
  assert.deepEqual(tooBig.gameKeys, ['BUF|MIA']);

  const fractional = pickem.validatePicksPayload({
    picks: [{ gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 1.5 }],
    games, mode: 'confidence', now: BEFORE_ALL,
  });
  assert.equal(fractional.code, 'PICKEM_BAD_CONFIDENCE');
});

test('confidence values must be unique, but a FULL permutation is not required', () => {
  const games = slateOf();
  // Only one of three games picked — legal, so Thursday can be picked early.
  const partial = pickem.validatePicksPayload({
    picks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 2 }],
    games, mode: 'confidence', now: BEFORE_ALL,
  });
  assert.equal(partial.code, null);
  assert.deepEqual(partial.picks, [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 2 }]);

  const dupeWithinBatch = pickem.validatePicksPayload({
    picks: [
      { gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 2 },
      { gameKey: 'DEN|KC', pickedTeam: 'KC', confidence: 2 },
    ],
    games, mode: 'confidence', now: BEFORE_ALL,
  });
  assert.equal(dupeWithinBatch.code, 'PICKEM_BAD_CONFIDENCE');
  assert.deepEqual(dupeWithinBatch.gameKeys, ['DEN|KC']);

  // A confidence already committed to a game this batch doesn't touch (in
  // practice a locked Thursday pick) is off the table too.
  const dupeWithHeld = pickem.validatePicksPayload({
    picks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 3 }],
    games, mode: 'confidence', now: BEFORE_ALL,
    heldConfidences: [{ gameKey: 'BUF|MIA', confidence: 3 }],
  });
  assert.equal(dupeWithHeld.code, 'PICKEM_BAD_CONFIDENCE');
  assert.deepEqual(dupeWithHeld.gameKeys, ['DAL|WAS']);
});

/* ------------------------------------------------------------------ *
 * Scoring                                                             *
 * ------------------------------------------------------------------ */

const finalGame = (key, homeTeam, awayTeam, homeScore, awayScore, week = 1) => ({
  week, gameKey: key, teams: key.split('|'), kickoffAt: KICKOFF,
  status: 'final', homeTeam, awayTeam, homeScore, awayScore,
});

test('scorePickemWeek pays 1 point per correct pick in straight-up mode', () => {
  const games = [
    finalGame('BUF|MIA', 'BUF', 'MIA', 30, 10),
    finalGame('DAL|WAS', 'DAL', 'WAS', 3, 20),
  ];
  const [rowA, rowB] = pickem.scorePickemWeek({
    games,
    mode: 'straight',
    picks: [
      { userId: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 9 },
      { userId: 1, gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 9 },
      { userId: 2, gameKey: 'BUF|MIA', pickedTeam: 'BUF' },
      { userId: 2, gameKey: 'DAL|WAS', pickedTeam: 'WAS' },
    ],
  });
  assert.deepEqual(
    { userId: rowA.userId, points: rowA.points, correct: rowA.correct, incorrect: rowA.incorrect },
    { userId: 1, points: 1, correct: 1, incorrect: 1 }
  );
  assert.equal(rowB.points, 2, 'confidence is ignored entirely in straight-up mode');
});

test('scorePickemWeek pays the pick\'s own confidence in confidence mode', () => {
  const [row] = pickem.scorePickemWeek({
    games: [
      finalGame('BUF|MIA', 'BUF', 'MIA', 30, 10),
      finalGame('DAL|WAS', 'DAL', 'WAS', 3, 20),
    ],
    mode: 'confidence',
    picks: [
      { userId: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 2 },
      { userId: 1, gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 1 },
    ],
  });
  assert.equal(row.points, 2);
  assert.equal(row.correct, 1);
});

test('a tied game credits NOBODY, in either mode', () => {
  const games = [finalGame('BUF|MIA', 'BUF', 'MIA', 20, 20)];
  for (const mode of ['straight', 'confidence']) {
    const rows = pickem.scorePickemWeek({
      games, mode,
      picks: [
        { userId: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 1 },
        { userId: 2, gameKey: 'BUF|MIA', pickedTeam: 'MIA', confidence: 1 },
      ],
    });
    for (const row of rows) {
      assert.equal(row.points, 0, `${mode}: no points on a tie`);
      assert.equal(row.correct, 0);
      assert.equal(row.incorrect, 0);
      assert.equal(row.pushes, 1);
    }
  }
});

test('an unresolved game counts as pending, not wrong', () => {
  const [row] = pickem.scorePickemWeek({
    games: [{ week: 1, gameKey: 'BUF|MIA', teams: ['BUF', 'MIA'], kickoffAt: KICKOFF,
      status: 'in_progress', homeTeam: 'BUF', awayTeam: 'MIA', homeScore: 7, awayScore: 3 }],
    mode: 'straight',
    picks: [{ userId: 1, gameKey: 'BUF|MIA', pickedTeam: 'MIA' }],
  });
  assert.deepEqual(
    { points: row.points, correct: row.correct, incorrect: row.incorrect, pending: row.pending },
    { points: 0, correct: 0, incorrect: 0, pending: 1 }
  );
});

test('computePickemStandings ranks by points, then correct picks, then username', () => {
  const games = [
    finalGame('BUF|MIA', 'BUF', 'MIA', 30, 10, 1),
    finalGame('DAL|WAS', 'DAL', 'WAS', 3, 20, 1),
    finalGame('DEN|KC', 'KC', 'DEN', 28, 7, 2),
  ];
  const members = [
    { userId: 1, username: 'zoe', teamName: 'Z' },
    { userId: 2, username: 'abe', teamName: 'A' },
    { userId: 3, username: 'mia', teamName: 'M' },
  ];
  const standings = pickem.computePickemStandings({
    members,
    games,
    mode: 'confidence',
    picks: [
      // zoe: 3 points from ONE correct pick
      { userId: 1, week: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 3 },
      // abe: 3 points from TWO correct picks — wins the tiebreak
      { userId: 2, week: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 2 },
      { userId: 2, week: 2, gameKey: 'DEN|KC', pickedTeam: 'KC', confidence: 1 },
      // mia: nothing right
      { userId: 3, week: 1, gameKey: 'DAL|WAS', pickedTeam: 'DAL', confidence: 3 },
    ],
  });
  assert.deepEqual(
    standings.map((row) => [row.rank, row.username, row.points, row.correct]),
    [[1, 'abe', 3, 2], [2, 'zoe', 3, 1], [3, 'mia', 0, 0]]
  );
});

test('computePickemStandings gives co-champions competition ranks', () => {
  const games = [
    finalGame('BUF|MIA', 'BUF', 'MIA', 30, 10, 1),
    finalGame('DEN|KC', 'KC', 'DEN', 28, 7, 1),
  ];
  const standings = pickem.computePickemStandings({
    members: [
      { userId: 1, username: 'zoe' },
      { userId: 2, username: 'abe' },
      { userId: 3, username: 'mia' },
    ],
    games,
    picks: [
      { userId: 1, week: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF' },
      { userId: 1, week: 1, gameKey: 'DEN|KC', pickedTeam: 'KC' },
      { userId: 2, week: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF' },
      { userId: 2, week: 1, gameKey: 'DEN|KC', pickedTeam: 'KC' },
      { userId: 3, week: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF' },
      { userId: 3, week: 1, gameKey: 'DEN|KC', pickedTeam: 'DEN' },
    ],
    mode: 'straight',
  });

  assert.deepEqual(
    standings.map((row) => [row.rank, row.username, row.points, row.correct]),
    [[1, 'abe', 2, 2], [1, 'zoe', 2, 2], [3, 'mia', 1, 1]]
  );
});

test('computePickemStandings keeps all-zero standings sequential', () => {
  const standings = pickem.computePickemStandings({
    members: [
      { userId: 1, username: 'zoe' },
      { userId: 2, username: 'abe' },
      { userId: 3, username: 'mia' },
    ],
  });

  assert.deepEqual(
    standings.map((row) => [row.rank, row.username, row.points, row.correct]),
    [[1, 'abe', 0, 0], [2, 'mia', 0, 0], [3, 'zoe', 0, 0]]
  );
});

test('computePickemStandings carries per-week points for the standings UI', () => {
  const standings = pickem.computePickemStandings({
    members: [{ userId: 2, username: 'abe' }, { userId: 9, username: 'zoe' }],
    games: [
      finalGame('BUF|MIA', 'BUF', 'MIA', 30, 10, 1),
      finalGame('DEN|KC', 'KC', 'DEN', 28, 7, 2),
    ],
    picks: [
      { userId: 2, week: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF', confidence: 5 },
      { userId: 2, week: 2, gameKey: 'DEN|KC', pickedTeam: 'KC', confidence: 2 },
    ],
    mode: 'confidence',
  });
  const abe = standings.find((row) => row.username === 'abe');
  assert.deepEqual(abe.weekly, { 1: 5, 2: 2 });
  assert.equal(abe.points, 7);
  // A member with no picks still gets the empty map, never undefined.
  assert.deepEqual(standings.find((row) => row.username === 'zoe').weekly, {});
});

test('computePickemStandings lists members who never picked, at zero', () => {
  const standings = pickem.computePickemStandings({
    members: [{ userId: 1, username: 'abe' }, { userId: 2, username: 'bo' }],
    games: [finalGame('BUF|MIA', 'BUF', 'MIA', 30, 10)],
    picks: [{ userId: 1, week: 1, gameKey: 'BUF|MIA', pickedTeam: 'BUF' }],
    mode: 'straight',
  });
  assert.deepEqual(standings.map((row) => [row.username, row.points, row.made]), [
    ['abe', 1, 1],
    ['bo', 0, 0],
  ]);
});

/* ------------------------------------------------------------------ *
 * I/O — every schedule read goes through fn_normalize_nfl_team        *
 * ------------------------------------------------------------------ */

test('getWeekSlate normalizes BOTH tables in SQL', async (t) => {
  const statements = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    statements.push(text);
    if (text.includes('"nfl_games"')) return { rows: nflGameRows(2, [['BUF', 'MIA']]) };
    if (text.includes('"live_game_states"')) return { rows: [] };
    throw new Error(`unexpected query: ${text}`);
  });

  const games = await pickem.getWeekSlate({ season: 2026, week: 2 });
  assert.equal(games.length, 1);

  const [scheduleSql, liveSql] = statements;
  assert.match(scheduleSql, /fn_normalize_nfl_team\("nfl_team"\)/);
  assert.match(scheduleSql, /fn_normalize_nfl_team\("opponent"\)/);
  assert.match(liveSql, /fn_normalize_nfl_team\("home_team"\)/);
  assert.match(liveSql, /fn_normalize_nfl_team\("away_team"\)/);
});

test('getSeasonSlate normalizes the recap table too, and survives it not existing', async (t) => {
  const statements = [];
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    statements.push(text);
    if (text.includes('"nfl_games"')) return { rows: nflGameRows(1, [['BUF', 'MIA']]) };
    if (text.includes('"live_game_states"')) return { rows: [] };
    if (text.includes('game_recaps')) {
      const error = new Error('relation "private.game_recaps" does not exist');
      error.code = '42P01';
      throw error;
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const games = await pickem.getSeasonSlate({ season: 2026 });
  assert.equal(games.length, 1, 'a missing recap table degrades, it does not throw');
  const recapSql = statements.find((sql) => sql.includes('game_recaps'));
  assert.match(recapSql, /fn_normalize_nfl_team\("home_team"\)/);
  assert.match(recapSql, /fn_normalize_nfl_team\("away_team"\)/);
});

test('getSettings treats a missing row as the feature being off', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  assert.deepEqual(await pickem.getSettings(4), { enabled: false, mode: 'straight' });
});

test('getWeekView hides unlocked picks and reveals locked ones', async (t) => {
  const now = new Date('2026-09-13T18:00:00.000Z'); // after DAL/WAS, before KC/DEN
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('"nfl_games"')) {
      return {
        rows: nflGameRows(1, [
          ['DAL', 'WAS', '2026-09-13T17:00:00.000Z'],
          ['KC', 'DEN', '2026-09-13T20:25:00.000Z'],
        ]),
      };
    }
    if (text.includes('"live_game_states"')) return { rows: [] };
    if (text.includes('FROM "pickem_picks"')) {
      return {
        rows: [
          { user_id: 9, team_pair: 'DAL|WAS', picked_team: 'DAL', confidence: 2, username: 'me', teamId: 90, teamName: 'My Team' },
          { user_id: 9, team_pair: 'DEN|KC', picked_team: 'KC', confidence: 1, username: 'me', teamId: 90, teamName: 'My Team' },
          { user_id: 5, team_pair: 'DAL|WAS', picked_team: 'WAS', confidence: 1, username: 'rival', teamId: 50, teamName: 'Rival Team' },
          { user_id: 5, team_pair: 'DEN|KC', picked_team: 'DEN', confidence: 2, username: 'rival', teamId: 50, teamName: 'Rival Team' },
        ],
      };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const view = await pickem.getWeekView({
    leagueId: 3, userId: 9, season: 2026, week: 1, mode: 'confidence', now,
  });
  assert.deepEqual(view.games.map((g) => [g.gameKey, g.locked]), [
    ['DAL|WAS', true],
    ['DEN|KC', false],
  ]);
  assert.equal(view.myPicks.length, 2, 'my own picks are always mine to see');
  assert.deepEqual(Object.keys(view.othersPicks), ['DAL|WAS']);
  // Team identity rides beside the author's account fields (#112, parent #108).
  assert.deepEqual(view.othersPicks['DAL|WAS'], [
    {
      userId: 5, username: 'rival', teamId: 50, teamName: 'Rival Team',
      gameKey: 'DAL|WAS', pickedTeam: 'WAS', confidence: 1,
    },
  ]);
});

/* ------------------------------------------------------------------ *
 * I/O — transactional writes                                          *
 * ------------------------------------------------------------------ */

function mockClient(t, handlers) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      const text = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ text, params });
      for (const [pattern, handler] of handlers) {
        if (pattern.test(text)) return handler(text, params);
      }
      throw new Error(`unexpected query: ${text}`);
    },
    release: () => {},
  };
  t.mock.method(pool, 'connect', async () => client);
  return calls;
}

const TXN = [
  [/^BEGIN$/, () => ({ rows: [] })],
  [/^COMMIT$/, () => ({ rows: [] })],
  [/^ROLLBACK$/, () => ({ rows: [] })],
];

test('putSettings refuses a mode change once the season has picks', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues"/, () => ({ rows: [{ id: 3, name: 'Ballers', current_season: 2026, current_week: 4 }] })],
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    [/SELECT 1 FROM "pickem_picks"/, () => ({ rows: [{ '?column?': 1 }] })],
  ]);

  await assert.rejects(
    () => pickem.putSettings({ leagueId: 3, enabled: true, mode: 'confidence' }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'PICKEM_MODE_LOCKED');
      return true;
    }
  );
  // #274: count, not boolean. ROLLBACK is the complementary check; the upsert
  // count is the load-bearing one, since work followed by a ROLLBACK also
  // leaves no COMMIT and looks identical from outside.
  assert.ok(calls.some((call) => call.text === 'ROLLBACK'));
  assert.equal(
    calls.filter((call) => /^INSERT INTO "pickem_settings"/.test(call.text)).length,
    0,
    'the locked mode was not rewritten'
  );
  assert.equal(
    calls.filter((call) => /^INSERT INTO "transactions"/.test(call.text)).length,
    0,
    'and no activity row claimed it had been'
  );
});

test('putSettings toggles enabled without touching the mode, and logs it', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues"/, () => ({ rows: [{ id: 3, name: 'Ballers', current_season: 2026, current_week: 4 }] })],
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: false, mode: 'confidence' }] })],
    [/INSERT INTO "pickem_settings"/, () => ({ rows: [] })],
    [/INSERT INTO "transactions"/, () => ({ rows: [] })],
  ]);

  const settings = await pickem.putSettings({ leagueId: 3, enabled: true });
  assert.deepEqual(settings, { enabled: true, mode: 'confidence' });
  // No picks lookup at all — the mode didn't change, so nothing is at risk.
  assert.ok(!calls.some((call) => /"pickem_picks"/.test(call.text)));
  assert.ok(calls.some((call) => /INSERT INTO "transactions"/.test(call.text)));
  assert.ok(calls.some((call) => call.text === 'COMMIT'));
});

// #274, documented exemption (no write assertion needed): the MODES.includes
// check throws PICKEM_BAD_MODE at pickem.service.js:537, above the
// `await pool.connect()` on :541. No client is checked out, no BEGIN is
// issued, no statement is dispatched. There is no mutable work behind this
// refusal for a guard to sink below.
test('putSettings rejects an unknown mode outright', async () => {
  await assert.rejects(() => pickem.putSettings({ leagueId: 3, mode: 'parlay' }), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'PICKEM_BAD_MODE');
    return true;
  });
});

test('upsertPicks re-checks the lock INSIDE the transaction', async (t) => {
  // The client rendered its board before kickoff; by the time the save lands,
  // the Thursday game has started.
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    [/FROM "nfl_games"/, () => ({ rows: nflGameRows(1, [
      ['BUF', 'MIA', '2026-09-10T00:20:00.000Z'],
      ['DAL', 'WAS', '2026-09-13T17:00:00.000Z'],
    ]) })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/SELECT "team_pair", "confidence" FROM "pickem_picks"/, () => ({ rows: [] })],
  ]);

  await assert.rejects(
    () => pickem.upsertPicks({
      leagueId: 3, userId: 9, season: 2026, week: 1,
      picks: [
        { gameKey: 'BUF|MIA', pickedTeam: 'BUF' },
        { gameKey: 'DAL|WAS', pickedTeam: 'DAL' },
      ],
      now: new Date('2026-09-10T01:00:00.000Z'),
    }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'PICKEM_LOCKED');
      assert.deepEqual(error.details, { gameKeys: ['BUF|MIA'] });
      return true;
    }
  );
  // #274: count, not boolean. This is the case the ticket exists for - the
  // lock is re-read inside the transaction, so the guard sits one statement
  // above the upsert and a move down is invisible from the response.
  assert.equal(
    calls.filter((call) => /^INSERT INTO "pickem_picks"/.test(call.text)).length,
    0,
    'no pick was saved for a game that had started'
  );
  assert.ok(calls.some((call) => call.text === 'ROLLBACK'));
});

test('upsertPicks bulk-upserts the whole batch in one statement', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'confidence' }] })],
    [/FROM "nfl_games"/, () => ({ rows: nflGameRows(1, [
      ['BUF', 'MIA', '2026-09-10T00:20:00.000Z'],
      ['DAL', 'WAS', '2026-09-13T17:00:00.000Z'],
    ]) })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/SELECT "team_pair", "confidence" FROM "pickem_picks"/, () => ({
      // A locked Thursday pick already owns confidence 2.
      rows: [{ team_pair: 'BUF|MIA', confidence: 2 }],
    })],
    [/INSERT INTO "pickem_picks"/, () => ({ rows: [] })],
  ]);

  const result = await pickem.upsertPicks({
    leagueId: 3, userId: 9, season: 2026, week: 1,
    picks: [{ gameKey: 'DAL|WAS', pickedTeam: 'was', confidence: 1 }],
    now: new Date('2026-09-10T01:00:00.000Z'),
  });
  assert.deepEqual(result, {
    saved: 1,
    myPicks: [{ gameKey: 'DAL|WAS', pickedTeam: 'WAS', confidence: 1 }],
  });

  const upsert = calls.find((call) => /INSERT INTO "pickem_picks"/.test(call.text));
  assert.match(upsert.text, /ON CONFLICT \("league_id", "user_id", "season", "week", "team_pair"\)/);
  assert.deepEqual(upsert.params, [3, 9, 2026, 1, ['DAL|WAS'], ['WAS'], [1]]);
  assert.ok(calls.some((call) => call.text === 'COMMIT'));
});

test('upsertPicks refuses to write when the league has Pick\'em turned off', async (t) => {
  // #274. Two changes make the absence below load-bearing rather than
  // decorative. First, the fixture now answers everything the save would need
  // past this guard, INSERT included, so the write could genuinely land.
  // Second, the call carries a REAL pick: with the previous `picks: []` the
  // batch was empty, so even a guard moved below the upsert would have written
  // nothing and a zero count would have proved nothing.
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "pickem_settings"/, () => ({ rows: [] })],
    [/FROM "nfl_games"/, () => ({ rows: nflGameRows(1, [['DAL', 'WAS', '2026-09-13T17:00:00.000Z']]) })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/SELECT "team_pair", "confidence" FROM "pickem_picks"/, () => ({ rows: [] })],
    [/INSERT INTO "pickem_picks"/, () => ({ rows: [] })],
  ]);
  await assert.rejects(
    () => pickem.upsertPicks({
      leagueId: 3, userId: 9, season: 2026, week: 1,
      picks: [{ gameKey: 'DAL|WAS', pickedTeam: 'WAS' }],
      now: new Date('2026-09-10T01:00:00.000Z'),
    }),
    (error) => {
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'PICKEM_DISABLED');
      return true;
    }
  );
  assert.equal(
    calls.filter((call) => /^INSERT INTO "pickem_picks"/.test(call.text)).length,
    0,
    'a disabled league stored no picks'
  );
});

/* ------------------------------------------------------------------ *
 * Privacy                                                             *
 * ------------------------------------------------------------------ */

test("a data export includes the user's Pick'em picks", async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('FROM "users"')) return { rows: [{ id: 9, username: 'me' }] };
    if (text.includes('FROM "pickem_picks"')) {
      return { rows: [{ league_id: 3, season: 2026, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null }] };
    }
    return { rows: [] };
  });

  const exported = await privacy.exportUserData(9);
  assert.deepEqual(exported.pickemPicks, [
    { league_id: 3, season: 2026, week: 1, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
  ]);
});

test('account deletion wipes pickem_picks', async (t) => {
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "users"/, () => ({ rows: [{ id: 9, username: 'me' }] })],
    [/FROM "leagues"/, () => ({ rows: [] })],
    [/SELECT "avatar_url"/, () => ({ rows: [] })],
    [/^UPDATE /, () => ({ rows: [] })],
    [/^DELETE FROM /, () => ({ rows: [] })],
    [/^INSERT INTO "data_privacy_requests"/, () => ({ rows: [] })],
  ]);

  await privacy.deleteUserAccount({ userId: 9, confirmation: 'me' });
  assert.ok(
    calls.some((call) => call.text === 'DELETE FROM "pickem_picks" WHERE "user_id" = $1'),
    'pickem_picks must be deleted alongside chat_reads'
  );
  assert.ok(calls.some((call) => call.text === 'COMMIT'));
});
