/**
 * Disposable-Postgres test for the covering index behind the opponent-defense
 * sum (#2900, 20261113000001_player_stats_points_covering_index.js).
 *
 * getPositionDefense (projection.service.js) sums fantasy_points over a season's
 * player_stats rows. The index it could use did not hold that column, so the sum
 * read the wide table heap, and a cold cache cost seconds. What it proves, in order:
 *   1. idx_player_stats_season_week_player_points exists, and the index it
 *      replaced, idx_player_stats_season_week_player, is gone.
 *   2. getPositionDefense({ season, uptoWeek: 10 }) returns, for every defense,
 *      the points it allowed per game to each position, computed from the seeded
 *      rows. A ballast season (BALLAST_SEASON) is seeded beside SEASON so that a
 *      leaking season filter would double every total.
 *   3. EXPLAIN of the exact statement getPositionDefense sent, with its exact
 *      parameters, reads player_stats through the covering index.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17, every migration applied),
 * gated twice: PG_TESTS=1 or POSITION_DEFENSE_INDEX_PG_TESTS=1 must be set, and every
 * DATABASE_URL* variable must be ABSENT. It connects through server/modules/pool.js,
 * which falls back to the local dev database when PGDATABASE is unset, so that is
 * refused too. SEASON (2303) and BALLAST_SEASON (2304) are far-future years that no
 * other pg test or migration uses.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.POSITION_DEFENSE_INDEX_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);
const missingPgDatabase = !process.env.PGDATABASE;

if (!ENABLED) {
  test('positionDefenseIndex PG tests (skipped: set PG_TESTS=1 or POSITION_DEFENSE_INDEX_PG_TESTS=1; CI migration-smoke runs these)',
    { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('positionDefenseIndex PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (missingPgDatabase) {
  test('positionDefenseIndex PG tests refuse to run without PGDATABASE set', () => {
    assert.fail('set PGDATABASE (and the other PG* connection vars) to a disposable database - '
      + 'this file connects through server/modules/pool.js, which falls back to the local dev '
      + 'database name ("endzone_empire") when PGDATABASE is unset, and these tests write and delete real rows');
  });
} else {
  const pool = require('../modules/pool');
  const { getPositionDefense } = require('../services/projection.service');

  const NEW_INDEX = 'idx_player_stats_season_week_player_points';
  const OLD_INDEX = 'idx_player_stats_season_week_player';
  const SEASON = 2303;
  const BALLAST_SEASON = 2304;
  const SEASONS = [SEASON, BALLAST_SEASON];
  const UPTO_WEEK = 10;
  const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const PLAYER_COUNT = 200;
  const NAME_PREFIX = 'PG Position Defense ';
  // All 32 teams, as canonical codes: fn_normalize_nfl_team passes these through unchanged.
  const TEAMS = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
    'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG',
    'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'];
  const POSITIONS = ['QB', 'RB', 'WR', 'TE'];

  // An odd offset makes each week's pairing an involution with no fixed point,
  // so every team meets exactly one opponent and both sides get an nfl_games row.
  const opponentIndex = (team, week) => (2 * week + 1 - team + TEAMS.length) % TEAMS.length;
  const teamOf = (i) => TEAMS[i % TEAMS.length];
  const positionOf = (i) => POSITIONS[Math.floor(i / TEAMS.length) % POSITIONS.length];
  // Half-point steps keep every sum exact, both in numeric(8,2) and as a JS number.
  const pointsOf = (i, week) => ((i * 7 + week * 3) % 40) / 2;

  async function clearSeeded() {
    await pool.query('DELETE FROM "player_stats" WHERE "season" = ANY($1::int[])', [SEASONS]);
    await pool.query('DELETE FROM "nfl_games" WHERE "season" = ANY($1::int[])', [SEASONS]);
    await pool.query('DELETE FROM "players" WHERE "name" LIKE $1', [`${NAME_PREFIX}%`]);
  }

  async function seed() {
    const names = Array.from({ length: PLAYER_COUNT }, (_, i) => `${NAME_PREFIX}${String(i).padStart(3, '0')}`);
    const inserted = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
       RETURNING "id", "name"`,
      [names, names.map((_, i) => positionOf(i)), names.map((_, i) => teamOf(i))],
    );
    const idByName = new Map(inserted.rows.map((r) => [r.name, r.id]));

    const games = SEASONS.flatMap((season) => WEEKS.flatMap((week) => TEAMS.map((team, t) => ({
      season, week, team, opponent: TEAMS[opponentIndex(t, week)],
    }))));
    await pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
       SELECT u.season, u.week, u.team, u.opponent, now()
       FROM unnest($1::int[], $2::int[], $3::text[], $4::text[]) AS u(season, week, team, opponent)`,
      [games.map((g) => g.season), games.map((g) => g.week), games.map((g) => g.team), games.map((g) => g.opponent)],
    );

    const stats = [];
    for (const season of SEASONS) {
      for (let i = 0; i < PLAYER_COUNT; i += 1) {
        for (const week of WEEKS) {
          stats.push({ playerId: idByName.get(names[i]), season, week, points: pointsOf(i, week) });
        }
      }
    }
    // Distinct md5 hex, not one repeated string, so the pad does not compress away.
    // Fifty of them keep the row well under the 2,032-byte TOAST threshold, so it stays inline.
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats", "fantasy_points")
       SELECT u.player_id, u.season, u.week,
              jsonb_build_object('pad', (SELECT string_agg(md5(u.player_id || ':' || u.season || ':' || u.week || ':' || k), '')
                                         FROM generate_series(1, 50) AS k)),
              u.points
       FROM unnest($1::int[], $2::int[], $3::int[], $4::numeric[]) AS u(player_id, season, week, points)`,
      [stats.map((s) => s.playerId), stats.map((s) => s.season), stats.map((s) => s.week), stats.map((s) => s.points)],
    );
  }

  // The totals the seeded rows must produce, computed from the same pointsOf the seed used.
  function expectedPointsAllowed() {
    const cells = new Map();
    for (let i = 0; i < PLAYER_COUNT; i += 1) {
      for (const week of WEEKS) {
        const defense = TEAMS[opponentIndex(i % TEAMS.length, week)];
        const position = positionOf(i);
        const key = `${defense}|${position}`;
        if (!cells.has(key)) cells.set(key, { defense, position, points: 0, weeks: new Set() });
        const cell = cells.get(key);
        cell.points += pointsOf(i, week);
        cell.weeks.add(week);
      }
    }
    const expected = new Map();
    for (const { defense, position, points, weeks } of cells.values()) {
      if (!expected.has(defense)) expected.set(defense, {});
      expected.get(defense)[position] = Math.round((points / weeks.size) * 100) / 100;
    }
    return expected;
  }

  // Calls getPositionDefense through the real pool and keeps the one statement it
  // sends, so the plan test explains exactly that text with those parameters.
  async function readPositionDefense() {
    const original = pool.query;
    const sent = [];
    pool.query = function recordQuery(...args) {
      sent.push(args);
      return original.apply(this, args);
    };
    let defense;
    try {
      defense = await getPositionDefense({ season: SEASON, uptoWeek: UPTO_WEEK });
    } finally {
      pool.query = original;
    }
    assert.equal(sent.length, 1, 'getPositionDefense sends exactly one statement');
    const [text, params] = sent[0];
    return { defense, text, params };
  }

  test.before(async () => {
    await clearSeeded();
    await seed();
    // Visibility map for the index-only scan; statistics on all three tables so the join sees real row counts, not guesses.
    await pool.query('VACUUM (ANALYZE) "player_stats", "players", "nfl_games"');
  });

  test.after(async () => {
    try {
      await clearSeeded();
    } finally {
      await pool.end();
    }
  });

  test('the covering index exists and the index it replaced does not', async () => {
    const { rows } = await pool.query(
      `SELECT "indexname" FROM "pg_indexes"
       WHERE "tablename" = 'player_stats' AND "indexname" = ANY($1::text[])`,
      [[NEW_INDEX, OLD_INDEX]],
    );
    assert.deepEqual(rows.map((r) => r.indexname), [NEW_INDEX]);
  });

  test('getPositionDefense returns the points each defense allowed per game to each position', async () => {
    const { defense } = await readPositionDefense();
    const expected = expectedPointsAllowed();
    assert.deepEqual([...defense.keys()].sort(), [...expected.keys()].sort());
    for (const [team, byPosition] of expected) {
      assert.deepEqual(defense.get(team), byPosition, `points allowed by ${team}`);
    }
  });

  test('the statement getPositionDefense sends is planned as an index-only scan on the covering index', async () => {
    const { text, params } = await readPositionDefense();
    const explained = await pool.query(`EXPLAIN ${text}`, params);
    const plan = explained.rows.map((r) => r['QUERY PLAN']).join('\n');
    const { rows: [sizes] } = await pool.query(
      `SELECT relpages, relallvisible FROM pg_class WHERE oid = 'player_stats'::regclass`,
    );
    assert.ok(
      plan.includes(`Index Only Scan using ${NEW_INDEX}`),
      `expected an index-only scan on ${NEW_INDEX}; player_stats relpages ${sizes.relpages}, `
        + `relallvisible ${sizes.relallvisible}; planned:\n${plan}`,
    );
  });
}
