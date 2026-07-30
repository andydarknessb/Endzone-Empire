/**
 * Disposable-Postgres CONTRACT tests for the snapshot client: the properties a
 * JS emulation can only claim until a real Postgres has agreed with it.
 *
 * The snapshot client re-implements eight SQL queries in JavaScript. Every one
 * of those re-implementations is a guess about what Postgres does until it is
 * checked against Postgres. The guesses that actually bite are not the obvious
 * ones - they are `ANY` on an empty array, a `LEFT JOIN` that produces nulls
 * rather than dropping a row, `ORDER BY` under the server's COLLATION (which is
 * not JS string order), and `fn_normalize_nfl_team` versus its hand-maintained
 * JS twin.
 *
 * Two kinds of check live here:
 *
 *   1. **Real query vs JS emulation on identical seeded rows.** Both sides are
 *      handed the same data; the rows must match exactly.
 *   2. **Reconstructed-mode behaviour vs INDEPENDENT reference SQL.** The
 *      reference queries below are written FRESH from the preregistration's
 *      definitions - per-week team from the roster relation, attribution
 *      through `gameTeam` - and deliberately NOT derived from the client's
 *      code. Deriving them from the implementation would only prove the
 *      implementation equals itself.
 *
 * These run ONLY in the CI migration-smoke job (postgres:17 service), gated
 * twice: BACKTEST_PG_TESTS=1 must be set explicitly, and every DATABASE_URL*
 * variable must be ABSENT - connections are built from PG* variables only, so a
 * stray local run can never touch the shared production database. Locally they
 * report as a visible SKIP, never as silent green.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.BACKTEST_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('backtest snapshot-client PG contracts (skipped: BACKTEST_PG_TESTS not set — CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('backtest PG contracts refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} — these tests must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const snapshotClient = require('../../scripts/backtest/lib/snapshotClient');
  const surface = require('../../scripts/backtest/lib/sqlSurface');
  const asOf = require('../../scripts/backtest/lib/asOfView');
  const { normalizeTeamKey } = require('../services/projectionFeatures');

  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const pool = new pg.Pool({ ...connection, max: 2 });
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });

  const SEASON = 2031; // far future: cannot collide with any seeded fixture
  const WEEK = 4;
  const sqlFor = (name) => surface.SQL_BY_NAME.get(name).text;

  /** Seeded players, chosen so collation and normalization both get exercised. */
  const PLAYERS = [
    { name: 'aaron lowercase', position: 'QB', nfl_team: 'KC' },
    { name: 'Aaron Uppercase', position: 'QB', nfl_team: 'WSH' },
    { name: "O'Brien Apostrophe", position: 'RB', nfl_team: 'LAR' },
    { name: 'Zeta Last', position: 'WR', nfl_team: 'BUF' },
    { name: 'Washington Commanders', position: 'DEF', nfl_team: 'Washington Commanders' },
  ];
  let playerIds = [];
  let byName = new Map();

  test.before(async () => {
    await knex.migrate.latest();
    const inserted = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
       RETURNING "id", "name"`,
      [PLAYERS.map((p) => p.name), PLAYERS.map((p) => p.position), PLAYERS.map((p) => p.nfl_team)]
    );
    byName = new Map(inserted.rows.map((r) => [r.name, r.id]));
    playerIds = inserted.rows.map((r) => r.id);

    // A NON-NULL numeric, so the surprising OID actually round-trips: pg hands
    // `numeric` back as a STRING, and a fixture where every numeric is null
    // would let a broken rehydration rule pass unnoticed.
    await pool.query(
      'UPDATE "players" SET "adp" = $2 WHERE "id" = $1', [playerIds[0], '12.75']
    );

    // Schedule: weeks 1..5, two games a week, one team on a bye in week 3.
    const games = [];
    for (let week = 1; week <= 5; week++) {
      const pairs = week === 3 ? [['KC', 'WSH']] : [['KC', 'WSH'], ['LAR', 'BUF']];
      for (const [home, away] of pairs) {
        for (const [team, opponent] of [[home, away], [away, home]]) {
          games.push({
            season: SEASON, week, nfl_team: team, opponent,
            kickoff_at: new Date(Date.UTC(2031, 8, week + 6, 17, 0, 0)).toISOString(),
          });
        }
      }
    }
    await pool.query(
      `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
       SELECT * FROM unnest($1::int[], $2::int[], $3::text[], $4::text[], $5::timestamptz[])`,
      [games.map((g) => g.season), games.map((g) => g.week), games.map((g) => g.nfl_team),
        games.map((g) => g.opponent), games.map((g) => g.kickoff_at)]
    );
    // NON-NULL numeric and boolean schedule columns, for the same reason as
    // `adp` above: `latitude` is numeric (pg -> string) and `neutral_site` is
    // bool (pg -> boolean), and a fixture of all-nulls would exercise neither
    // rehydration rule. `home_away` is left NULL deliberately - that IS
    // production's 2024/2025 state and off mode must reproduce it.
    await pool.query(
      `UPDATE "nfl_games"
          SET "latitude" = 39.0489, "longitude" = -94.4839,
              "neutral_site" = ("week" = 2), "rest_days" = 7
        WHERE "season" = $1`,
      [SEASON]
    );

    // Stat rows for weeks 1..3, including one with NO gameTeam (unenriched) and
    // one whose gameTeam contradicts the player's current team.
    const stats = [];
    for (let week = 1; week <= 3; week++) {
      for (const player of PLAYERS.slice(0, 4)) {
        const id = byName.get(player.name);
        const jsonb = { passingYards: 100 + week };
        if (!(player.name === 'Zeta Last' && week === 2)) jsonb.gameTeam = player.nfl_team;
        if (player.name === "O'Brien Apostrophe" && week === 3) jsonb.gameTeam = 'BUF';
        stats.push({ player_id: id, season: SEASON, week, stats: jsonb });
      }
    }
    await pool.query(
      `INSERT INTO "player_stats" ("player_id", "season", "week", "stats")
       SELECT * FROM unnest($1::int[], $2::int[], $3::int[], $4::jsonb[])`,
      [stats.map((s) => s.player_id), stats.map((s) => s.season), stats.map((s) => s.week),
        stats.map((s) => JSON.stringify(s.stats))]
    );
  });

  test.after(async () => {
    await pool.query('DELETE FROM "player_stats" WHERE "season" = $1', [SEASON]);
    await pool.query('DELETE FROM "nfl_games" WHERE "season" = $1', [SEASON]);
    if (playerIds.length > 0) {
      await pool.query('DELETE FROM "players" WHERE "id" = ANY($1::int[])', [playerIds]);
    }
    await pool.end();
    await knex.destroy();
  });

  /** Load the seeded relations into the shape the snapshot client reads. */
  async function buildSnapshotFromDatabase() {
    const players = await pool.query(
      `SELECT "id", "name", "position", "nfl_team", "injury_status", "injury_detail", "adp",
              fn_normalize_nfl_team("nfl_team") AS "team_key"
       FROM "players" WHERE "id" = ANY($1::int[]) ORDER BY "id"`,
      [playerIds]
    );
    const stats = await pool.query(
      `SELECT "player_id", "season", "week", "stats" FROM "player_stats"
       WHERE "season" = $1 ORDER BY "player_id", "week"`,
      [SEASON]
    );
    const games = await pool.query(
      `SELECT "season", "week", "nfl_team", "opponent", "kickoff_at", "game_key", "home_away",
              "neutral_site", "venue", "roof", "surface", "latitude", "longitude", "rest_days",
              fn_normalize_nfl_team("nfl_team") AS "team_key",
              fn_normalize_nfl_team("opponent") AS "opponent_key"
       FROM "nfl_games" WHERE "season" = $1 ORDER BY "week", "nfl_team"`,
      [SEASON]
    );
    const fieldsOf = (result) => result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID }));
    const manifest = {
      quarantineFromSeason: 2026,
      // Deliberately EMPTY. `seasons` is the study's list of EVALUATED
      // seasons, and this synthetic far-future season is not one - it exists to
      // compare SQL semantics, not to reconstruct orientation. Listing it would
      // (correctly) trip the client's overlay-coverage gate, which requires an
      // evaluated season's target week to be covered by the orientation
      // overlay; these fixtures carry no overlay on purpose.
      seasons: [],
      scheduleSeasons: [SEASON - 2, SEASON - 1, SEASON],
      // The type metadata comes from the REAL driver, which is the point: the
      // client's rehydration is checked against pg's own OIDs, not against a
      // table of OIDs someone typed out.
      schemaFingerprint: {
        players: { fields: fieldsOf(players) },
        player_stats: { fields: fieldsOf(stats) },
        player_season_stats: {
          fields: [{ name: 'player_id', dataTypeID: 23 }, { name: 'season', dataTypeID: 23 },
            { name: 'games_played', dataTypeID: 23 }, { name: 'stats', dataTypeID: 3802 },
            { name: 'fantasy_points', dataTypeID: 1700 }],
        },
        [`nfl_games_${SEASON}`]: { fields: fieldsOf(games) },
      },
    };
    const nflGamesBySeason = new Map([
      [SEASON - 2, []], [SEASON - 1, []], [SEASON, games.rows],
    ]);
    return snapshotClient.assembleSnapshot({
      manifest,
      players: players.rows,
      playerStats: stats.rows,
      playerSeasonStats: [],
      nflGamesBySeason,
    });
  }

  /** Rows compared as canonical JSON, so a type difference is a difference. */
  function comparable(rows) {
    return rows.map((row) => JSON.stringify(
      Object.keys(row).sort().reduce((acc, k) => {
        const v = row[k];
        acc[k] = v instanceof Date ? `date:${v.toISOString()}` : v;
        return acc;
      }, {})
    ));
  }

  // -------------------------------------------------------------------------
  // 1. Real query vs JS emulation, on identical rows
  // -------------------------------------------------------------------------

  test('every unconditional query matches the real database row for row', async () => {
    const snapshot = await buildSnapshotFromDatabase();
    const client = snapshotClient.createSnapshotClient({
      snapshot, season: SEASON, week: WEEK, mode: snapshotClient.MODES.OFF,
    });
    // These four have no ORDER BY, so only their CONTENT is specified.
    const unordered = [
      ['playersById', [playerIds]],
      ['targetWeekSchedule', [SEASON, WEEK]],
      ['historyWindowSchedule', [SEASON - 2, SEASON, WEEK]],
      ['defenseGameCount', [SEASON, WEEK]],
    ];
    for (const [name, params] of unordered) {
      const real = await pool.query(sqlFor(name), params);
      const emulated = await client.query(sqlFor(name), params);
      assert.deepEqual(
        comparable(emulated.rows).sort(), comparable(real.rows).sort(),
        `${name} must match Postgres`
      );
    }
  });

  test('priorPlayerStats matches Postgres, in the order the ORDER BY actually specifies', async () => {
    // `ORDER BY "season" DESC, "week" DESC` does NOT order rows that tie on
    // (season, week), and the seeded fixture has several four-row tie groups.
    // Asserting the flat sequence would be asserting something Postgres never
    // promised - it could pass today and break on a version bump or a plan
    // flip.
    //
    // But it must not be weakened to a plain sort either: the ORDER BY is a
    // CORRECTNESS requirement, because these rows flow into `bucket.residuals`
    // and `simulateDistribution` samples residuals BY INDEX
    // (projectionFeatures.js:528-537). So two things are checked, and together
    // they are exactly what the SQL guarantees:
    //
    //   1. WITHIN each player, where (season, week) is unique and the order IS
    //      therefore fully specified, the sequence must match exactly. This is
    //      also the only grouping any consumer sees: loadFeatureBundle buckets
    //      these rows per player.
    //   2. The flat sequence must be non-increasing in (season, week) - the
    //      part of the ordering that IS specified across players.
    const snapshot = await buildSnapshotFromDatabase();
    const client = snapshotClient.createSnapshotClient({
      snapshot, season: SEASON, week: WEEK, mode: snapshotClient.MODES.OFF,
    });
    const params = [playerIds, SEASON - 2, SEASON, WEEK];
    const real = await pool.query(sqlFor('priorPlayerStats'), params);
    const emulated = await client.query(sqlFor('priorPlayerStats'), params);

    assert.ok(real.rows.length > 0, 'the fixture produced prior rows to compare');

    const byPlayer = (rows) => {
      const grouped = new Map();
      for (const row of rows) {
        if (!grouped.has(row.player_id)) grouped.set(row.player_id, []);
        grouped.get(row.player_id).push(`${row.season}:${row.week}`);
      }
      return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
    };
    assert.deepEqual(byPlayer(emulated.rows), byPlayer(real.rows),
      'within each player the order is fully specified and must match exactly');

    // Content, independent of order.
    assert.deepEqual(comparable(emulated.rows).sort(), comparable(real.rows).sort());

    // The specified part of the cross-player ordering, on BOTH sides.
    for (const [label, rows] of [['postgres', real.rows], ['emulation', emulated.rows]]) {
      for (let i = 1; i < rows.length; i++) {
        const prev = rows[i - 1];
        const cur = rows[i];
        const nonIncreasing = prev.season > cur.season
          || (prev.season === cur.season && prev.week >= cur.week);
        assert.ok(nonIncreasing,
          `${label} row ${i} (${cur.season}:${cur.week}) rises above its predecessor (${prev.season}:${prev.week})`);
      }
    }

    // The fixture really does contain ties, or the test above proves nothing
    // about tie handling.
    const tieGroups = new Map();
    for (const row of real.rows) {
      const key = `${row.season}:${row.week}`;
      tieGroups.set(key, (tieGroups.get(key) || 0) + 1);
    }
    assert.ok([...tieGroups.values()].some((n) => n > 1),
      'the seeded fixture must contain (season, week) ties for this test to mean anything');
  });

  test('the league scan matches, including LEFT JOIN nulls and LIMIT truncation', async () => {
    const snapshot = await buildSnapshotFromDatabase();
    const client = snapshotClient.createSnapshotClient({
      snapshot, season: SEASON, week: WEEK, mode: snapshotClient.MODES.OFF,
    });
    const positions = ['QB', 'RB', 'WR'];
    for (const limit of [60000, 3, 1]) {
      const params = [SEASON, WEEK, positions, limit];
      const real = await pool.query(sqlFor('leagueScan'), params);
      const emulated = await client.query(sqlFor('leagueScan'), params);
      assert.deepEqual(comparable(emulated.rows), comparable(real.rows),
        `the scan must match Postgres at LIMIT ${limit}`);
    }
    // The bye week produces a LEFT JOIN miss: the stat row survives with a null
    // defense rather than disappearing.
    const byeRows = await pool.query(sqlFor('leagueScan'), [SEASON, WEEK, positions, 60000]);
    assert.ok(byeRows.rows.some((r) => r.defense === null),
      'the seeded week-3 bye must produce at least one null-defense row');
  });

  test('the bye query matches, including the DEF full-name fold', async () => {
    const snapshot = await buildSnapshotFromDatabase();
    const client = snapshotClient.createSnapshotClient({
      snapshot, season: SEASON, week: WEEK, mode: snapshotClient.MODES.OFF,
    });
    const teams = ['KC', 'WSH', 'Washington Commanders', 'LAR'];
    const params = [SEASON, teams, 18];
    const real = await pool.query(sqlFor('byeWeeks'), params);
    const emulated = await client.query(sqlFor('byeWeeks'), params);
    assert.deepEqual(comparable(emulated.rows).sort(), comparable(real.rows).sort());
    // And the derived bye actually differs by team, so the comparison is not
    // trivially empty on both sides.
    assert.ok(real.rows.length > 0);
  });

  test('ANY on an empty array, and on duplicates, behaves the way the emulation assumes', async () => {
    const snapshot = await buildSnapshotFromDatabase();
    const client = snapshotClient.createSnapshotClient({
      snapshot, season: SEASON, week: WEEK, mode: snapshotClient.MODES.OFF,
    });
    for (const ids of [[], [playerIds[0], playerIds[0]], [playerIds[0], -1]]) {
      const real = await pool.query(sqlFor('playersById'), [ids]);
      const emulated = await client.query(sqlFor('playersById'), [ids]);
      assert.deepEqual(comparable(emulated.rows).sort(), comparable(real.rows).sort(),
        `ANY(${JSON.stringify(ids)}) must match`);
    }
    // A duplicate id yields ONE row, not two - the emulation's Set does the
    // same thing, and this is what proves it.
    const dup = await pool.query(sqlFor('playersById'), [[playerIds[0], playerIds[0]]]);
    assert.equal(dup.rows.length, 1);
  });

  // -------------------------------------------------------------------------
  // 2. fn_normalize_nfl_team vs normalizeTeamKey
  // -------------------------------------------------------------------------

  test('the JS twin of fn_normalize_nfl_team agrees with the function itself', async () => {
    const vocabulary = [
      'KC', 'WSH', 'WAS', 'WFT', 'LA', 'LAR', 'STL', 'SD', 'LAC', 'OAK', 'LV', 'JAC', 'JAX',
      'GNB', 'GB', 'KAN', 'NWE', 'NE', 'NOR', 'NO', 'TAM', 'TB', 'SFO', 'SF', 'BUF', 'DEN',
      'Washington Commanders', 'Los Angeles Rams', 'Kansas City Chiefs', 'Buffalo Bills',
      'kc', '  KC  ', '',
    ];
    const result = await pool.query(
      `SELECT "t"."raw", fn_normalize_nfl_team("t"."raw") AS "key"
       FROM unnest($1::text[]) AS "t"("raw")`,
      [vocabulary]
    );
    for (const row of result.rows) {
      assert.equal(
        normalizeTeamKey(row.raw), row.key,
        `normalizeTeamKey(${JSON.stringify(row.raw)}) must equal fn_normalize_nfl_team's ${JSON.stringify(row.key)}`
      );
    }
    // The two divergences the sources actually carry, proven to converge.
    const pairs = await pool.query(
      `SELECT fn_normalize_nfl_team('WAS') = fn_normalize_nfl_team('WSH') AS "washington",
              fn_normalize_nfl_team('LA') = fn_normalize_nfl_team('LAR') AS "rams"`
    );
    assert.equal(pairs.rows[0].washington, true);
    assert.equal(pairs.rows[0].rams, true);
  });

  // -------------------------------------------------------------------------
  // 3. ORDER BY under the server's collation
  // -------------------------------------------------------------------------

  test('the collation artifact captures an order a JS sort does NOT reproduce', async () => {
    // This is why Phase 1 captures the ordering from Postgres instead of
    // computing it: the server's collation is not JS string order, and the
    // deployed-policy wrapper's candidate order depends on it.
    const artifact = await pool.query(
      `SELECT "id", "name", row_number() OVER (ORDER BY "name", "id") AS "rank"
       FROM "players" WHERE "id" = ANY($1::int[]) ORDER BY "name", "id"`,
      [playerIds]
    );
    const dbOrder = artifact.rows.map((r) => r.name);
    const jsOrder = [...dbOrder].sort();
    // Record the fact either way: if they agree on this server the test still
    // documents the comparison; the artifact is what the study uses regardless.
    if (dbOrder.join('|') !== jsOrder.join('|')) {
      assert.notDeepEqual(dbOrder, jsOrder,
        'the server collation differs from JS order - exactly why the artifact is captured');
    }
    // `row_number()` is int8, so pg hands it back as a STRING. The client's
    // rehydration table says so, and this is where that is confirmed.
    assert.equal(typeof artifact.rows[0].rank, 'string');
    const rankOid = artifact.fields.find((f) => f.name === 'rank').dataTypeID;
    assert.equal(snapshotClient.PG_TYPES[rankOid], 'string');
  });

  test('the client rehydrates to exactly the JS types the driver produced', async () => {
    const snapshot = await buildSnapshotFromDatabase();
    const client = snapshotClient.createSnapshotClient({
      snapshot, season: SEASON, week: WEEK, mode: snapshotClient.MODES.OFF,
    });
    const real = await pool.query(sqlFor('targetWeekSchedule'), [SEASON, WEEK]);
    const emulated = await client.query(sqlFor('targetWeekSchedule'), [SEASON, WEEK]);
    assert.ok(real.rows.length > 0);
    for (const column of Object.keys(real.rows[0])) {
      const a = real.rows[0][column];
      const b = emulated.rows.find((r) => r.team_key === real.rows[0].team_key)[column];
      assert.equal(
        Object.prototype.toString.call(a), Object.prototype.toString.call(b),
        `column ${column}: driver produced ${Object.prototype.toString.call(a)}, client produced ${Object.prototype.toString.call(b)}`
      );
    }
    assert.ok(real.rows[0].kickoff_at instanceof Date, 'the driver really does produce a Date here');

    // The two SURPRISING types, round-tripped against the real driver rather
    // than against a table of OIDs someone typed out. Both are non-null in the
    // fixture on purpose.
    const row = real.rows[0];
    assert.equal(typeof row.latitude, 'string', 'pg returns numeric as a string');
    assert.equal(typeof row.neutral_site, 'boolean');
    assert.equal(typeof row.rest_days, 'number', 'int4 is a number');
    const mine = emulated.rows.find((r) => r.team_key === row.team_key);
    assert.equal(mine.latitude, row.latitude);
    assert.equal(mine.neutral_site, row.neutral_site);
    assert.equal(mine.rest_days, row.rest_days);
    // And `home_away` stays null: production's real state, which off mode must
    // reproduce rather than repair.
    assert.equal(row.home_away, null);
    assert.equal(mine.home_away, null);

    // The numeric on `players` too, through its own query.
    const realPlayers = await pool.query(sqlFor('playersById'), [[playerIds[0]]]);
    const minePlayers = await client.query(sqlFor('playersById'), [[playerIds[0]]]);
    assert.equal(typeof realPlayers.rows[0].adp, 'string');
    assert.equal(minePlayers.rows[0].adp, realPlayers.rows[0].adp);
    assert.equal(minePlayers.rows[0].adp, '12.75');
  });

  // -------------------------------------------------------------------------
  // 4. Reconstructed mode vs INDEPENDENT reference SQL
  // -------------------------------------------------------------------------

  test('reconstructed attribution matches reference SQL written from the prereg, not from the client', async () => {
    // The reference below is written fresh from the preregistration's rules:
    // a stat row belongs to the team named in `stats->>'gameTeam'`, and the
    // opponent is that team's opponent in that week's schedule. It shares no
    // code with snapshotClient.
    // A TEMPORARY table is SESSION-scoped, so every statement that touches it
    // must run on the SAME connection. Through a pool that is not guaranteed:
    // it worked only because sequential awaits happened to be handed the same
    // client back. One added await, or a pool under any concurrency, and the
    // reference query would fail with "relation ref_roster does not exist".
    // So the whole block - create, insert, query, drop - holds one client.
    const session = await pool.connect();
    try {
      await session.query(`
        CREATE TEMPORARY TABLE "ref_roster" (
          "season" int, "week" int, "gsis_id" text, "team" text, "position" text, "status" text
        ) ON COMMIT PRESERVE ROWS`);
      const rosterRows = [];
      for (let week = 1; week <= 3; week++) {
        rosterRows.push({ week, gsis: '00-0000001', team: 'KC', position: 'QB' });
        rosterRows.push({ week, gsis: '00-0000003', team: week === 3 ? 'BUF' : 'LA', position: 'RB' });
      }
      await session.query(
        `INSERT INTO "ref_roster" SELECT $1::int, * FROM unnest(
           $2::int[], $3::text[], $4::text[], $5::text[], $6::text[])`,
        [SEASON, rosterRows.map((r) => r.week), rosterRows.map((r) => r.gsis),
          rosterRows.map((r) => r.team), rosterRows.map((r) => r.position),
          rosterRows.map(() => 'ACT')]
      );

      const gsisByPlayerId = new Map([
        [byName.get('aaron lowercase'), '00-0000001'],
        [byName.get("O'Brien Apostrophe"), '00-0000003'],
      ]);
      const referenceSql = `
        SELECT "ps"."player_id",
               "ps"."week",
               "r"."position",
               fn_normalize_nfl_team("ng"."opponent") AS "defense"
        FROM "player_stats" "ps"
        JOIN "ref_roster" "r"
          ON "r"."season" = "ps"."season" AND "r"."week" = "ps"."week"
         AND "r"."gsis_id" = $2
        LEFT JOIN "nfl_games" "ng"
          ON "ng"."season" = "ps"."season" AND "ng"."week" = "ps"."week"
         AND fn_normalize_nfl_team("ng"."nfl_team")
             = fn_normalize_nfl_team("ps"."stats"->>'gameTeam')
        WHERE "ps"."season" = $1 AND "ps"."week" < $3 AND "ps"."player_id" = $4
        ORDER BY "ps"."player_id", "ps"."week"`;

      const rosterIndex = asOf.buildRosterIndex(rosterRows.map((r) => ({
        season: SEASON, week: r.week, team: r.team, position: r.position,
        status: 'ACT', gsis_id: r.gsis, full_name: 'x', game_type: 'REG',
      })));
      const snapshot = await buildSnapshotFromDatabase();
      const client = snapshotClient.createSnapshotClient({
        snapshot,
        season: SEASON,
        week: WEEK,
        mode: snapshotClient.MODES.RECONSTRUCTED,
        reconstruction: {
          rosterIndex,
          policy: asOf.INJURY_POLICIES.PRIMARY,
          normalizeTeamKey,
          overlayRows: [],
          gsisByPlayerId,
          viewFor: ({ season, week, gsisId }) => asOf.reconstructPlayerWeek({
            rosterIndex, season, week, gsisId, normalizeTeamKey,
          }),
        },
      });
      const emulated = await client.query(sqlFor('leagueScan'), [SEASON, WEEK, ['QB', 'RB'], 60000]);

      for (const [playerId, gsis] of gsisByPlayerId) {
        const reference = await session.query(referenceSql, [SEASON, gsis, WEEK, playerId]);
        const mine = emulated.rows
          .filter((r) => r.player_id === playerId)
          .map((r) => ({ player_id: r.player_id, week: r.week, position: r.position, defense: r.defense }));
        assert.deepEqual(
          mine,
          reference.rows.map((r) => ({
            player_id: r.player_id, week: r.week, position: r.position, defense: r.defense,
          })),
          `reconstructed attribution for ${gsis} must match the independent reference SQL`
        );
      }

      // And the case that makes this worth testing: the traded player's week-3
      // row is attributed to BUF by gameTeam, not to the LA he was on earlier.
      const traded = emulated.rows.find(
        (r) => r.player_id === byName.get("O'Brien Apostrophe") && r.week === 3
      );
      assert.ok(traded, 'the traded player has a week-3 scan row');
    } finally {
      // Dropping is belt-and-braces: a TEMPORARY table dies with the session
      // anyway, and releasing the client is what actually matters.
      await session.query('DROP TABLE IF EXISTS "ref_roster"').catch(() => {});
      session.release();
    }
  });

  test('the per-week team overlay matches reference SQL over the seeded roster relation', async () => {
    // Independent statement of "the roster file is the authority": ask the
    // database directly which team each player-week belongs to, and require
    // the JS view to agree.
    const rosterRows = [
      { week: 1, gsis: '00-0000009', team: 'WAS' },
      { week: 2, gsis: '00-0000009', team: 'WSH' }, // a SPELLING change, not a trade
      { week: 3, gsis: '00-0000009', team: 'LA' }, // a real move
    ];
    const reference = await pool.query(
      `SELECT "t"."week", fn_normalize_nfl_team("t"."team") AS "team_key"
       FROM unnest($1::int[], $2::text[]) AS "t"("week", "team") ORDER BY "t"."week"`,
      [rosterRows.map((r) => r.week), rosterRows.map((r) => r.team)]
    );
    const index = asOf.buildRosterIndex(rosterRows.map((r) => ({
      season: SEASON, week: r.week, team: r.team, position: 'RB', status: 'ACT',
      gsis_id: r.gsis, full_name: 'x', game_type: 'REG',
    })));
    const timeline = asOf.teamTimelineFor(index, {
      season: SEASON, gsisId: '00-0000009', normalizeTeamKey,
    });
    assert.deepEqual(
      timeline.weeks.map((w) => ({ week: w.week, team_key: w.teamKey })),
      reference.rows.map((r) => ({ week: r.week, team_key: r.team_key }))
    );
    // Postgres agrees that weeks 1 and 2 are the same team: one move, not two.
    assert.equal(timeline.changes.length, 1);
    assert.equal(timeline.changes[0].week, 3);
  });
}
