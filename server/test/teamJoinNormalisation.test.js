/**
 * #287: the raw `players.nfl_team = nfl_games.nfl_team` join.
 *
 * It lives in SQL, so it normalises in SQL through `fn_normalize_nfl_team`
 * on BOTH sides (the rule stated in `services/nflTeam.js`: a consumer that
 * JOINS two tables normalises in the database, a consumer that has already
 * read one side into memory normalises in JS):
 *
 *   - `projection.service.getPositionDefense` uses an INNER join, so a raw
 *     comparison DROPS the row and the aggregate loses DEF units and every
 *     WSH-coded week with no null anywhere to notice.
 *
 * The digest's lineup-reminder query used to be the other site (an `on_bye`
 * LEFT JOIN that made every DEF unit permanently on bye); it reads no bye any
 * more, since the Start verdict comes from the Weekly projection read (ADR
 * 0061), so its tests went with the join.
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
const { normalizeNflTeam } = require('../services/nflTeam');
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

const SEASON = 2026;

// --- projection: getPositionDefense -----------------------------------------

const OPPONENT_COLUMN = '"nfl_games"."opponent"';

/**
 * Whether the statement folds its defense key through `fn_normalize_nfl_team`
 * or reads it raw, READ OUT OF THE STATEMENT ITSELF rather than assumed by
 * this fixture (same discipline as `teamPredicateFrom` above). A fake that
 * decided this on its own would prove nothing about a reverted fix: this way,
 * reverting the SQL to a bare `"nfl_games"."opponent"` flips the fake back to
 * raw keys too, so the membership/arithmetic assertions below fail on the
 * regression exactly when the SQL text does.
 */
function defenseKeyFoldFrom(sql) {
  const text = flat(sql);
  const wrapped = new RegExp(`fn_normalize_nfl_team\\(\\s*${escape(OPPONENT_COLUMN)}\\s*\\)`);
  const bare = new RegExp(escape(OPPONENT_COLUMN));
  if (wrapped.test(text)) return normalizeNflTeam;
  if (bare.test(text)) return (raw) => raw;
  throw new Error(`no reference to ${OPPONENT_COLUMN} in the statement under test: ${text}`);
}

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
    const foldDefense = defenseKeyFoldFrom(sql);

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
      const defenseKey = foldDefense(game.opponent);
      const key = `${defenseKey} ${player.position}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          defense: defenseKey,
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

test('getPositionDefense folds WSH- and WAS-coded opponent weeks into one canonical WAS bucket (#1154, supersedes the raw-keyed ruling at ADR 0011)', async (t) => {
  // Superseded ruling: this test used to assert `defense.has('WSH')` and
  // `defense.has('WAS') === false`, reasoning that normalising the GROUP BY
  // key "would break the pairing that works today" against a raw opponent
  // read in decision.service.startSitAdvice. #1136 made every opponent that
  // leaves the server a Team code, so that raw-on-raw pairing no longer
  // exists to protect; on Cory's 2026-09-10 ruling (#1154), the aggregate now
  // folds its own key instead of leaving a second, JS-side fold
  // (`foldedDefense`, removed) to paper over the mismatch. ADR 0011's
  // Consequences bullet recording the old pairing as deliberate is amended,
  // not edited, to say so.
  //
  // Two raw aliases for Washington (WSH in week 1, WAS in week 3) must
  // combine into ONE 'WAS' bucket, and the assertions below prove ARITHMETIC,
  // not just membership: both weeks' points and both distinct game weeks
  // contribute to the resulting average.
  const world = {
    players: [
      { id: 1, position: 'DEF', nfl_team: 'Denver Broncos' },
      { id: 2, position: 'DEF', nfl_team: 'Buffalo Bills' },
    ],
    stats: [
      { player_id: 1, season: SEASON, week: 1, fantasy_points: 9 },
      { player_id: 2, season: SEASON, week: 3, fantasy_points: 5 },
    ],
    games: [
      { season: SEASON, week: 1, nfl_team: 'DEN', opponent: 'WSH' },
      { season: SEASON, week: 3, nfl_team: 'BUF', opponent: 'WAS' },
    ],
  };
  const { seen, answer } = positionDefenseFake(world);
  t.mock.method(pool, 'query', async (sql, params) => answer(sql, params));

  const defense = await projection.getPositionDefense({ season: SEASON, uptoWeek: 5 });

  // Membership: one canonical bucket, no raw alias key survives.
  assert.ok(defense.has('WAS'), 'both raw aliases fold into the canonical WAS bucket');
  assert.equal(defense.has('WSH'), false, 'the raw WSH spelling never survives as its own key');

  // Arithmetic: (9 + 5) points over 2 distinct game weeks = 7, not either
  // week's value alone. Proves the fake's own fold combined both aliases
  // rather than one alias silently winning last-wins.
  assert.equal(defense.get('WAS').DEF, 7);

  // Statement half, against the real SQL text (a fake cannot fake this): the
  // defense key is grouped and selected through fn_normalize_nfl_team, and no
  // raw "nfl_games"."opponent" survives ungrouped in the GROUP BY or the
  // SELECT of that key.
  const RAW_OPPONENT_KEY =
    /(?<!fn_normalize_nfl_team\()"nfl_games"\."opponent"(?!\s*\))/;
  assert.match(
    seen.statement,
    /fn_normalize_nfl_team\(\s*"nfl_games"\."opponent"\s*\)\s+AS\s+"defense"/,
    'the defense column is selected through fn_normalize_nfl_team'
  );
  assert.match(
    seen.statement,
    /GROUP BY\s+fn_normalize_nfl_team\(\s*"nfl_games"\."opponent"\s*\)/,
    'the defense key is grouped through fn_normalize_nfl_team'
  );
  assert.doesNotMatch(
    seen.statement,
    RAW_OPPONENT_KEY,
    'no un-normalised "nfl_games"."opponent" survives outside the fn_normalize_nfl_team call'
  );
});
