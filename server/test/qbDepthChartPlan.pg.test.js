/**
 * Disposable-Postgres test for the QB depth chart read's query plan, the cause
 * of the slow Players page and Decision card.
 *
 * `player_depth_chart` gains a day of rows per Sync run and this read only asks
 * about the last 3 days, so between autoanalyze runs the planner has no
 * statistics for the dates it is asked about and estimates 1 row. Written as
 * `"team_code" IN (subquery)`, that estimate planned a nested-loop semi-join
 * that re-scanned the date range once per outer row: ~600ms against
 * production's 86k rows, 12 to 13 times per Decision card. A query-matching
 * fake cannot express this, because the claim is about the plan Postgres picks.
 *
 * The claim: with statistics blind to the window, the read visits each window
 * row a bounded number of times, and it still answers only for the requested
 * players' teams.
 *
 * Gated exactly like the other pg tests: PG_TESTS=1 or QB_DEPTH_PLAN_PG_TESTS=1,
 * and every DATABASE_URL* variable ABSENT, so a stray local run can never touch
 * the shared production database. Seeds and deletes its own far-future dates.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.QB_DEPTH_PLAN_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('QB depth plan PG test (skipped: set PG_TESTS=1 or QB_DEPTH_PLAN_PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('QB depth plan PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const projection = require('../services/projection.service');

  const pool = new pg.Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 2,
  });

  const NOW = new Date('2091-06-15T12:00:00Z');
  const TEAMS = ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB'];
  const QBS_PER_TEAM = 3;
  const OTHERS_PER_TEAM = 12;
  const WINDOW_DAYS = 4; // NOW's date and the 3 before it, the read's own bound
  const WINDOW_ROWS = TEAMS.length * (QBS_PER_TEAM + OTHERS_PER_TEAM) * WINDOW_DAYS;
  const FIXTURE_NAME = 'QB depth plan fixture';

  let roster;

  const seedDays = (from, to) => pool.query(
    `INSERT INTO "player_depth_chart" ("player_id", "team_code", "position_group", "rank", "captured_date")
     SELECT u.id, u.team, u.grp, u.rank, d::date
     FROM unnest($1::int[], $2::text[], $3::text[], $4::int[]) AS u(id, team, grp, rank)
     CROSS JOIN generate_series($5::date, $6::date, interval '1 day') AS d`,
    [roster.map((r) => r.id), roster.map((r) => r.team), roster.map((r) => r.group), roster.map((r) => r.rank), from, to],
  );

  test.before(async () => {
    const planned = TEAMS.flatMap((team) => [
      ...Array.from({ length: QBS_PER_TEAM }, (_, i) => ({ team, group: 'QB', position: 'QB', rank: i + 1 })),
      ...Array.from({ length: OTHERS_PER_TEAM }, (_, i) => ({ team, group: 'WR', position: 'WR', rank: i + 1 })),
    ]);
    const inserted = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       SELECT $1 || ' ' || n, p, t FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS u(p, t, n)
       RETURNING "id"`,
      [FIXTURE_NAME, planned.map((p) => p.position), planned.map((p) => p.team)],
    );
    roster = planned.map((p, i) => ({ ...p, id: inserted.rows[i].id }));

    // The state the table drifts into between autoanalyze runs: statistics
    // that know every older date and none of the window's.
    await pool.query('ALTER TABLE "player_depth_chart" SET (autovacuum_enabled = false)');
    await seedDays('2091-04-01', '2091-06-11');
    await pool.query('ANALYZE "player_depth_chart"');
    await seedDays('2091-06-12', '2091-06-15');
  });

  test.after(async () => {
    await pool.query('DELETE FROM "players" WHERE "name" LIKE $1', [`${FIXTURE_NAME}%`]);
    await pool.query('ALTER TABLE "player_depth_chart" RESET (autovacuum_enabled)');
    await pool.end();
  });

  // Rows every scan of the table touched in total, repeated scans included.
  function depthRowsVisited(node) {
    const own = node['Relation Name'] === 'player_depth_chart'
      ? node['Actual Loops'] * (node['Actual Rows'] + (node['Rows Removed by Filter'] || 0))
      : 0;
    return (node.Plans || []).reduce((total, child) => total + depthRowsVisited(child), own);
  }

  // Runs the read in a transaction that is rolled back, and hands `check` the
  // verdict and the statement the read sent.
  async function withRecordedRead({ playerIds, seed }, check) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL max_parallel_workers_per_gather = 0');
      if (seed) await seed(client);
      const reads = [];
      const recording = {
        query: (text, params) => {
          if (text.includes('player_depth_chart')) reads.push({ text, params });
          return client.query(text, params);
        },
      };

      const backups = await projection.loadBackupQuarterbackIds({ client: recording, playerIds, now: NOW });

      assert.equal(reads.length, 1);
      await check({ client, read: reads[0], backups });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  const ascending = (ids) => [...ids].sort((a, b) => a - b);
  const starterOf = (team) => roster.find((r) => r.team === team && r.group === 'QB' && r.rank === 1);
  const backupsOf = (teams) => roster.filter((r) => teams.includes(r.team) && r.group === 'QB' && r.rank > 1).map((r) => r.id);

  test('with statistics blind to its window, the QB depth read does not re-scan the table per row', async () => {
    // A Players page asks about many players at once; two teams stay unrequested.
    const requested = TEAMS.slice(2);
    await withRecordedRead({ playerIds: requested.map((team) => starterOf(team).id) }, async ({ client, read, backups }) => {
      const explained = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${read.text}`, read.params);
      const visited = depthRowsVisited(explained.rows[0]['QUERY PLAN'][0].Plan);
      assert.ok(
        visited <= WINDOW_ROWS * 3,
        `visited ${visited} depth rows for a ${WINDOW_ROWS}-row window: the plan is re-scanning the table per row`,
      );
      assert.deepEqual(ascending(backups), ascending(backupsOf(requested)));
    });
  });

  const INPUT_SHAPES = [
    { shape: 'no players', playerIds: () => [], teams: [] },
    { shape: 'one starter', playerIds: () => [starterOf('BUF').id], teams: ['BUF'] },
    {
      shape: 'a player charted at another position',
      playerIds: () => [roster.find((r) => r.team === 'BUF' && r.group === 'WR').id],
      teams: [],
    },
    {
      shape: 'a starter charted only before the window',
      playerIds: () => [starterOf('BUF').id],
      seed: (client) => client.query(
        `DELETE FROM "player_depth_chart" WHERE "player_id" = $1 AND "captured_date" >= '2091-06-12'`,
        [starterOf('BUF').id],
      ),
      teams: [],
    },
    {
      shape: 'a starter with a NULL team row beside a real one',
      playerIds: () => [starterOf('BUF').id],
      seed: (client) => client.query(
        `INSERT INTO "player_depth_chart" ("player_id", "team_code", "position_group", "rank", "captured_date")
         VALUES ($1, NULL, 'QB', 1, '2091-06-16')`,
        [starterOf('BUF').id],
      ),
      teams: ['BUF'],
    },
  ];

  for (const { shape, playerIds, seed, teams } of INPUT_SHAPES) {
    test(`the QB depth read answers only for the requested teams given ${shape}`, async () => {
      await withRecordedRead({ playerIds: playerIds(), seed }, async ({ client, read, backups }) => {
        // A failed read degrades to "nobody is a Backup", which would pass for
        // the empty answers here, so the statement runs again where it can throw.
        const { rows } = await client.query(read.text, read.params);
        assert.deepEqual([...new Set(rows.map((r) => r.team_code))], teams);
        assert.equal(rows.length, teams.length * QBS_PER_TEAM * WINDOW_DAYS);
        assert.deepEqual(ascending(backups), ascending(backupsOf(teams)));
      });
    });
  }
}
