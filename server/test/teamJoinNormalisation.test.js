/**
 * #287: the two remaining raw `players.nfl_team = nfl_games.nfl_team` joins.
 *
 * Both live in SQL, so both normalise in SQL through `fn_normalize_nfl_team`
 * on BOTH sides (the rule stated in `services/nflTeam.js`: a consumer that
 * JOINS two tables normalises in the database, a consumer that has already
 * read one side into memory normalises in JS). One issue, one defect, so the
 * two sites are tested together here:
 *
 *   - `digest.service`'s lineup-reminder query reads `on_bye` off a LEFT JOIN,
 *     so a raw comparison makes every DEF unit permanently on bye;
 *   - `projection.service.getPositionDefense` uses an INNER join, so a raw
 *     comparison DROPS the row and the aggregate loses DEF units and every
 *     WSH-coded week with no null anywhere to notice.
 *
 * HOW THIS TESTS A SQL JOIN WITHOUT A DATABASE, AND WHY THAT IS HONEST.
 * These services are driven through a fake pool, and the standing warning
 * (head of `test/helpers/tenureFakes.js`, and the day #190 lost to it) is
 * that a fake which answers a normalisation question out of its own
 * re-implementation reports on the fixture rather than on the code.
 *
 * So the fake here does not decide anything. It READS THE PREDICATE OUT OF
 * THE STATEMENT THE SERVICE ACTUALLY ISSUED and then joins the fixture rows
 * the way Postgres would for that exact predicate: raw text equality where
 * the SQL compares the columns raw, folded identity where the SQL wraps a
 * side in `fn_normalize_nfl_team`, and one-sided where the SQL wraps only
 * one. A predicate it cannot recognise is an error, never a pass. Revert
 * either service to the raw comparison and these tests fail on the row that
 * goes missing, which is the only property worth having.
 *
 * The MEANING of `fn_normalize_nfl_team` comes from `services/nflTeam.js`,
 * the JS mirror whose agreement with the migration's VALUES lists is itself
 * guarded, by `test/nflTeam.test.js`. Nothing in this file re-states the
 * team vocabulary. It inherits that module's ONE documented divergence from
 * the SQL: an empty team folds to `null` here and to `''` in the database, so
 * two blank teams match in Postgres and not in this fake. No fixture below
 * has a blank team, and `players.nfl_team` is populated for every seeded row.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { createFakePool } = require('./helpers/fakePool');
const { normalizeNflTeam } = require('../services/nflTeam');
const accountService = require('../services/account.service');
const push = require('../services/push.service');
const { sendLineupReminders } = require('../services/digest.service');
const projection = require('../services/projection.service');

const flat = (sql) => String(sql).replace(/\s+/g, ' ').trim();
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Either spelling of one operand: bare column, or wrapped in the SQL
// normaliser. Captured whole so the comparator can see which it got.
const operand = (column) =>
  `(fn_normalize_nfl_team\\(\\s*${escape(column)}\\s*\\)|${escape(column)})`;

/**
 * The join predicate as WRITTEN BY THE SERVICE, turned into the comparator
 * Postgres would evaluate for it.
 *
 * `fn_normalize_nfl_team` folds a full team name and an alias code onto one
 * canonical abbreviation; bare `=` is text equality and folds nothing. A
 * one-sided wrap is modelled exactly as written rather than rounded up to
 * "normalised", so removing one of the two calls is a mutation this kills
 * instead of one it waves through.
 */
function teamPredicateFrom(sql, columnA, columnB) {
  const text = flat(sql);
  const either =
    `${operand(columnA)}\\s*=\\s*${operand(columnB)}` +
    `|${operand(columnB)}\\s*=\\s*${operand(columnA)}`;
  // ALL of them, in either operand ordering. Taking the first match would let
  // a normalised comparison earlier in the statement speak for a raw join
  // predicate later in it, which is the one direction a scoping bug travels.
  const matches = [...text.matchAll(new RegExp(either, 'g'))];
  if (matches.length === 0) {
    throw new Error(
      `no predicate joining ${columnA} to ${columnB} in the statement under test: ${text}`
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} predicates join ${columnA} to ${columnB}; this fake models one: ${text}`
    );
  }
  const [, ...groups] = matches[0];
  const [first, second] = groups.filter(Boolean);
  const sideA = first.includes(columnA) ? first : second;
  const sideB = sideA === first ? second : first;
  const fold = (side) =>
    (side.startsWith('fn_normalize_nfl_team') ? normalizeNflTeam : (raw) => raw);
  const foldA = fold(sideA);
  const foldB = fold(sideB);
  return (valueA, valueB) => {
    const left = foldA(valueA);
    const right = foldB(valueB);
    // SQL `=` is never true against NULL, and neither is this.
    return left !== null && left !== undefined && left === right;
  };
}

/**
 * The `nfl_games` row a player's week joins to under `sameTeam`, which both
 * fakes below need and neither should spell twice.
 */
const gameFor = (games, { season, week, team }, sameTeam) =>
  games.find(
    (g) =>
      Number(g.season) === Number(season) &&
      Number(g.week) === Number(week) &&
      sameTeam(g.nfl_team, team)
  );

/** Fails loudly rather than quietly joining on something else. */
function requireInStatement(sql, pattern, what) {
  if (!pattern.test(flat(sql))) {
    throw new Error(`${what} is missing from the statement under test: ${flat(sql)}`);
  }
}

const GAMES_TEAM = '"nfl_games"."nfl_team"';
const PLAYERS_TEAM = '"players"."nfl_team"';
// The shape the bug wears, in EITHER operand ordering: the grep #287 asks the
// next reader to run is written both ways round for the same reason.
const RAW_PREDICATE =
  /"nfl_games"\."nfl_team" *= *"players"\."nfl_team"|"players"\."nfl_team" *= *"nfl_games"\."nfl_team"/;

// --- digest: on_bye ---------------------------------------------------------

const SEASON = 2026;

/**
 * Answers the lineup-reminder digest query out of fixture tables, joining
 * `nfl_games` the way the statement itself says to.
 */
const digestRows = (world) => (sql, params) => {
  const [, season, week] = params;
  requireInStatement(sql, /LEFT JOIN "nfl_games"/, 'the LEFT JOIN on nfl_games');
  requireInStatement(sql, /"nfl_games"\."season" = \$2/, 'the season scope on the game join');
  requireInStatement(sql, /"nfl_games"\."week" = \$3/, 'the week scope on the game join');
  requireInStatement(
    sql,
    /\("nfl_games"\."nfl_team" IS NULL\) AS "on_bye"/,
    'the on_bye projection'
  );
  const sameTeam = teamPredicateFrom(sql, GAMES_TEAM, PLAYERS_TEAM);
  const rows = world.entries.map((entry) => {
    const player = world.players.find((p) => p.id === entry.player_id);
    const game = gameFor(world.games, { season, week, team: player.nfl_team }, sameTeam);
    return {
      slot: entry.slot,
      ir_attested: entry.ir_attested || false,
      name: player.name,
      injury_status: player.injury_status || null,
      on_bye: !game,
    };
  });
  return { rows };
};

/**
 * A one-team league whose reminder run reaches the digest query. The roster
 * is already materialized (every roster player has a lineup row), so
 * materializeLineup returns before it writes anything.
 */
function digestWorld(t, world) {
  const statements = [];
  const fake = createFakePool([
    [/^SELECT 1 FROM "matchups"/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: world.leagueId,
        current_season: SEASON,
        current_week: world.week,
        best_ball: false,
        roster_slots: [],
        bench_slots: 5,
        ir_slots: 1,
      }],
    })],
    [/^SELECT 1 FROM "nfl_games"/, () => ({ rows: [{ exists: 1 }] })],
    [/^SELECT "teams"\."id"/, () => ({
      rows: [{
        id: world.teamId,
        name: 'Test Team',
        owner_id: world.ownerId,
        email: 'manager@example.test',
      }],
    })],
    [/^SELECT "user_id", "prefs" FROM "notification_prefs"/, () => ({ rows: [] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: world.entries.map((e) => ({ player_id: e.player_id, position: e.position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: world.entries.map((e) => ({ player_id: e.player_id })),
    })],
    [/^SELECT "lineup_entries"\."slot"/, (sql, params) => {
      statements.push(flat(sql));
      return digestRows(world)(sql, params);
    }],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]).install(t);
  const messages = [];
  t.mock.method(push, 'sendPushToUsers', async (userIds, payload) => {
    messages.push(payload.body);
    return { sent: 1 };
  });
  t.mock.method(accountService, 'deliverEmail', async () => ({ sent: 1 }));
  return { fake, messages, statements };
}

const OUT_RECEIVER = {
  id: 901, name: 'Hurt Receiver', position: 'WR', nfl_team: 'BUF', injury_status: 'O',
};

test('a DEF unit is not on bye in a week his team plays', async (t) => {
  const denverDefense = {
    // `syncTeamDefenses` seeds a DEF unit with name = nfl_team, so both
    // columns carry the full team name and neither carries a code.
    id: 902, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos',
  };
  const { fake, messages, statements } = digestWorld(t, {
    leagueId: 5101, teamId: 5201, ownerId: 5301, week: 3,
    players: [denverDefense, OUT_RECEIVER],
    entries: [
      { player_id: 902, position: 'DEF', slot: 'DEF' },
      { player_id: 901, position: 'WR', slot: 'WR' },
    ],
    // players.nfl_team says "Denver Broncos"; the schedule says DEN. The
    // receiver's own team plays too, so the only thing separating the two
    // starters is the vocabulary their team is written in.
    games: [
      { season: SEASON, week: 3, nfl_team: 'DEN', opponent: 'KC' },
      { season: SEASON, week: 3, nfl_team: 'BUF', opponent: 'NYJ' },
    ],
  });

  const result = await sendLineupReminders();

  // The reminder fires for the Out receiver, which is what makes the silence
  // about the defense an assertion rather than an absence of output.
  assert.equal(result.remindersSent, 1);
  assert.match(messages[0], /Hurt Receiver \(WR\) is Out/);
  assert.doesNotMatch(messages[0], /on bye/);
  assert.doesNotMatch(statements[0], RAW_PREDICATE);
  fake.assertClean();
});

// The control, and the only test here that also passes on the raw
// comparison: a join that matches nothing satisfies "on bye" by accident.
// It earns its place by proving the harness can still say TRUE, so the
// silence in its partner above is a real answer and not a broken fixture.
// Keep the pair together.
test('a DEF unit is on bye in his real bye week', async (t) => {
  const denverDefense = {
    id: 912, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos',
  };
  const { fake, messages } = digestWorld(t, {
    leagueId: 5102, teamId: 5202, ownerId: 5302, week: 9,
    players: [denverDefense],
    entries: [{ player_id: 912, position: 'DEF', slot: 'DEF' }],
    // Week 9 is Denver's bye: other teams play, Denver does not.
    games: [{ season: SEASON, week: 9, nfl_team: 'KC', opponent: 'LV' }],
  });

  const result = await sendLineupReminders();

  assert.equal(result.remindersSent, 1);
  assert.match(messages[0], /Denver Broncos \(DEF\) is on bye/);
  fake.assertClean();
});

test('a WAS player matches a WSH-coded game row', async (t) => {
  const washingtonReceiver = {
    id: 922, name: 'Washington Receiver', position: 'WR', nfl_team: 'WAS',
  };
  const { fake, messages } = digestWorld(t, {
    leagueId: 5103, teamId: 5203, ownerId: 5303, week: 4,
    players: [washingtonReceiver, OUT_RECEIVER],
    entries: [
      { player_id: 922, position: 'WR', slot: 'WR' },
      { player_id: 901, position: 'WR', slot: 'FLEX' },
    ],
    // Tank01 spells Washington WSH; players.nfl_team spells it WAS.
    games: [
      { season: SEASON, week: 4, nfl_team: 'WSH', opponent: 'PHI' },
      { season: SEASON, week: 4, nfl_team: 'BUF', opponent: 'NYJ' },
    ],
  });

  const result = await sendLineupReminders();

  assert.equal(result.remindersSent, 1);
  assert.match(messages[0], /Hurt Receiver \(FLEX\) is Out/);
  assert.doesNotMatch(messages[0], /on bye/);
  fake.assertClean();
});

// --- projection: getPositionDefense -----------------------------------------

/**
 * Answers the position-vs-defense aggregate out of fixture tables, joining
 * `nfl_games` the way the statement itself says to, and REPORTING how many
 * `player_stats` rows the join swallowed.
 *
 * That count is the point. The defect is a missing row, and an average over
 * whatever survived is a perfectly plausible number, so the assertions below
 * are on row counts and membership. `dropped` makes the silent half of the
 * inner join speak.
 */
function positionDefenseFake(world) {
  const seen = { input: 0, joined: 0, dropped: 0, statement: null };
  const answer = (sql, params) => {
    const [season, uptoWeek] = params;
    seen.statement = flat(sql);
    requireInStatement(sql, /JOIN "nfl_games"/, 'the join on nfl_games');
    requireInStatement(
      sql,
      /"nfl_games"\."season" = "player_stats"\."season"/,
      'the season scope on the game join'
    );
    requireInStatement(
      sql,
      /"nfl_games"\."week" = "player_stats"\."week"/,
      'the week scope on the game join'
    );
    // The row-loss this test exists for depends on the join being INNER. A
    // LEFT JOIN would keep an unmatched row under a null defense key instead
    // of dropping it, which is different behaviour and would need a different
    // test, so it is refused here rather than quietly modelled.
    if (/LEFT JOIN "nfl_games"/.test(flat(sql))) {
      throw new Error(
        `getPositionDefense joins nfl_games INNER; this statement does not: ${flat(sql)}`
      );
    }
    const sameTeam = teamPredicateFrom(sql, GAMES_TEAM, PLAYERS_TEAM);

    const grouped = new Map();
    for (const stat of world.stats) {
      if (Number(stat.season) !== Number(season)) continue;
      if (!(Number(stat.week) < Number(uptoWeek))) continue;
      seen.input += 1;
      const player = world.players.find((p) => p.id === stat.player_id);
      const game = gameFor(
        world.games,
        { season: stat.season, week: stat.week, team: player.nfl_team },
        sameTeam
      );
      if (!game) {
        seen.dropped += 1;
        continue;
      }
      seen.joined += 1;
      const key = `${game.opponent} ${player.position}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          defense: game.opponent,
          position: player.position,
          points: 0,
          weeks: new Set(),
        });
      }
      const bucket = grouped.get(key);
      bucket.points += Number(stat.fantasy_points);
      bucket.weeks.add(Number(stat.week));
    }
    return {
      rows: [...grouped.values()].map((b) => ({
        defense: b.defense,
        position: b.position,
        points: b.points,
        games: b.weeks.size,
      })),
    };
  };
  return { seen, answer };
}

/** (defense, position) pairs actually present in the returned aggregate. */
const pairsIn = (defense) =>
  [...defense.entries()].flatMap(([team, byPosition]) =>
    Object.keys(byPosition).map((position) => `${team}:${position}`)
  );

test('getPositionDefense keeps every stat row, including DEF units and WSH weeks', async (t) => {
  const world = {
    players: [
      { id: 1, position: 'DEF', nfl_team: 'Denver Broncos' },
      { id: 2, position: 'WR', nfl_team: 'WAS' },
      { id: 3, position: 'RB', nfl_team: 'BUF' },
    ],
    stats: [
      { player_id: 1, season: SEASON, week: 1, fantasy_points: 12 },
      { player_id: 2, season: SEASON, week: 2, fantasy_points: 20 },
      { player_id: 3, season: SEASON, week: 3, fantasy_points: 15 },
    ],
    games: [
      { season: SEASON, week: 1, nfl_team: 'DEN', opponent: 'KC' },
      { season: SEASON, week: 2, nfl_team: 'WSH', opponent: 'PHI' },
      { season: SEASON, week: 3, nfl_team: 'BUF', opponent: 'MIA' },
    ],
  };
  const { seen, answer } = positionDefenseFake(world);
  t.mock.method(pool, 'query', async (sql, params) => answer(sql, params));

  const defense = await projection.getPositionDefense({ season: SEASON, uptoWeek: 5 });

  // ROW COUNT, not a value: the bug is a row that never arrives, and an
  // average over the survivors reads perfectly normal without it.
  assert.equal(seen.input, 3, 'three stat rows are in scope');
  assert.equal(seen.dropped, 0, 'no stat row failed to find its game');
  assert.equal(seen.joined, 3, 'every stat row reached the aggregate');

  // MEMBERSHIP: the two rows the raw comparison loses.
  assert.ok(defense.has('KC'), 'the DEF unit contributed to the KC bucket');
  assert.ok('DEF' in defense.get('KC'), 'and did so as a DEF unit');
  assert.ok(defense.has('PHI'), 'the WAS player matched his WSH-coded week');
  assert.ok('WR' in defense.get('PHI'));
  assert.deepEqual(pairsIn(defense).sort(), ['KC:DEF', 'MIA:RB', 'PHI:WR']);

  // Values last, and only once membership is established.
  assert.equal(defense.get('KC').DEF, 12);
  assert.equal(defense.get('PHI').WR, 20);
  assert.equal(defense.get('MIA').RB, 15);

  // The predicate the fix removes must be gone, not merely joined by a
  // normalised one somewhere else in the statement.
  assert.doesNotMatch(seen.statement, RAW_PREDICATE);
});

test('getPositionDefense still keys the aggregate by the schedule opponent vocabulary', async (t) => {
  // The consumer (decision.service.startSitAdvice) looks this map up with an
  // opponent read straight out of nfl_games, so normalising the GROUP BY key
  // would break the pairing that works today. #287 changes the join, not the
  // key. The opponent-label lookups are a separate, lower-severity ticket.
  const world = {
    players: [{ id: 1, position: 'DEF', nfl_team: 'Denver Broncos' }],
    stats: [{ player_id: 1, season: SEASON, week: 1, fantasy_points: 9 }],
    games: [{ season: SEASON, week: 1, nfl_team: 'DEN', opponent: 'WSH' }],
  };
  const { answer } = positionDefenseFake(world);
  t.mock.method(pool, 'query', async (sql, params) => answer(sql, params));

  const defense = await projection.getPositionDefense({ season: SEASON, uptoWeek: 5 });

  assert.ok(defense.has('WSH'), 'the opponent column is passed through unfolded');
  assert.equal(defense.has('WAS'), false);
});
