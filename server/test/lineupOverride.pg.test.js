/**
 * Disposable-Postgres test for #1856: what only a real unique index can show.
 *
 * `lineup_overrides` allows ONE called row per (league, season, week, team)
 * through a PARTIAL unique index (`WHERE called`), while rows that are not
 * called shots (the automatically captured overrides that will share the
 * table) stay unconstrained by it. A fake pool enforces no constraints, so
 * this asserts the index, the pair key, the outcome check, the cascading
 * foreign keys and the guarded down() against the migrated schema.
 *
 * Gated twice, exactly like the other *.pg.test.js files: PG_TESTS=1 (or the
 * per-file LINEUP_OVERRIDE_PG_TESTS=1) must be set, and every DATABASE_URL*
 * variable must be ABSENT, so a stray local run can never touch shared
 * production. The gate is a strict `=== '1'` string compare. CI's
 * migration-smoke job, which runs every migration to latest and then this
 * suite, is the binding run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LINEUP_OVERRIDE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('lineup-override PG test (skipped: set PG_TESTS=1 or LINEUP_OVERRIDE_PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('lineup-override PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const migration = require('../db/migrations/20260930000001_lineup_overrides');
  const pool = new pg.Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 2,
  });

  const seeded = { users: [], leagues: [], players: [] };
  const stamp = Date.now().toString(36).slice(-6);

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password") VALUES ($1, $2, 'x') RETURNING "id"`,
      [`${username}${stamp}`, `${username}${stamp}@example.invalid`]
    );
    seeded.users.push(res.rows[0].id);
    return res.rows[0].id;
  }
  async function seedLeague(ownerId, code) {
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "max_teams") VALUES ('lo', $1, $2, 12) RETURNING "id"`,
      [ownerId, `${code}${stamp}`.slice(0, 12)]
    );
    seeded.leagues.push(res.rows[0].id);
    return res.rows[0].id;
  }
  async function seedTeam(leagueId, ownerId) {
    const res = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'lo team') RETURNING "id"`,
      [leagueId, ownerId]
    );
    return res.rows[0].id;
  }
  async function seedPlayer(name) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'RB', 'MIN') RETURNING "id"`,
      [name]
    );
    seeded.players.push(res.rows[0].id);
    return res.rows[0].id;
  }

  const insertRow = (row) => pool.query(
    `INSERT INTO "lineup_overrides"
       ("league_id", "team_id", "season", "week", "slot", "starter_player_id", "benched_player_id",
        "starter_point_estimate", "benched_point_estimate", "probability", "verdict", "called", "declared_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, 6, 18, 0.92, 'start', $8, CASE WHEN $8 THEN now() END)
     RETURNING "id"`,
    [row.leagueId, row.teamId, row.season ?? 2026, row.week ?? 6, row.slot ?? 'RB',
      row.starter, row.benched, row.called ?? true]
  );

  async function rejects(promise, code) {
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, error.message);
      return true;
    });
  }

  let world;
  test.before(async () => {
    const owner = await seedUser('lo_owner');
    const leagueId = await seedLeague(owner, 'lo');
    const teamId = await seedTeam(leagueId, owner);
    const otherOwner = await seedUser('lo_other');
    const otherTeamId = await seedTeam(leagueId, otherOwner);
    world = {
      leagueId, teamId, otherTeamId,
      a: await seedPlayer('lo A'), b: await seedPlayer('lo B'), c: await seedPlayer('lo C'), d: await seedPlayer('lo D'),
    };
  });

  test.after(async () => {
    try {
      for (const leagueId of seeded.leagues) {
        await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]); // cascades teams and overrides
      }
      await pool.query(`DELETE FROM "players" WHERE "id" = ANY($1::int[])`, [seeded.players]);
      await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [seeded.users]);
    } finally {
      await pool.end();
    }
  });

  test('the partial unique index allows one called row per team-week', async () => {
    const first = await insertRow({ ...world, starter: world.a, benched: world.b });
    assert.ok(first.rows[0].id);
    // A second called row for the same team-week, even for another pair, is refused.
    await rejects(insertRow({ ...world, starter: world.c, benched: world.d }), '23505');
    // Another week, and another team, each get their own.
    await insertRow({ ...world, week: 7, starter: world.c, benched: world.d });
    await insertRow({ ...world, teamId: world.otherTeamId, starter: world.a, benched: world.b });
  });

  test('rows that are not called shots sit beside the called one', async () => {
    await insertRow({ ...world, slot: 'FLEX', starter: world.a, benched: world.c, called: false });
    await insertRow({ ...world, slot: 'FLEX', starter: world.b, benched: world.d, called: false });
  });

  test('the pair key refuses the same (slot, starter, benched) twice', async () => {
    await rejects(insertRow({ ...world, slot: 'FLEX', starter: world.a, benched: world.c, called: false }), '23505');
  });

  test('outcome is one of pending, hit, miss, void', async () => {
    await rejects(
      pool.query(`UPDATE "lineup_overrides" SET "outcome" = 'maybe' WHERE "team_id" = $1`, [world.teamId]),
      '23514'
    );
    const ok = await pool.query(
      `UPDATE "lineup_overrides" SET "outcome" = 'hit', "starter_points_actual" = 12.5,
              "benched_points_actual" = 9, "resolved_at" = now()
       WHERE "team_id" = $1 AND "week" = 7`,
      [world.teamId]
    );
    assert.equal(ok.rowCount, 1);
  });

  // #1862: the capture's own write, against the real pair key.
  test('writeOverride is idempotent on the pair key, and a pair matching the called row updates it once instead of adding one', async () => {
    const { writeOverride } = require('../services/lineupOverride.service');
    const suggestion = (starter, benched) => ({
      slot: 'RB', current: { playerId: starter, projection: 6 }, suggested: { playerId: benched, projection: 18 },
      probabilityBetter: 0.92, verdict: 'start',
    });
    const write = (starter, benched, capturedAt) => writeOverride(pool, {
      leagueId: world.leagueId, teamId: world.teamId, season: 2026, week: 9, suggestion: suggestion(starter, benched), capturedAt,
    });
    const rows = (called) => pool.query(
      `SELECT "captured_at", "called" FROM "lineup_overrides"
       WHERE "team_id" = $1 AND "week" = 9 AND "called" = $2`,
      [world.teamId, called]
    );
    // A captured pair: written once, never twice.
    await write(world.a, world.c, new Date('2030-01-01T17:03:00.000Z'));
    await write(world.a, world.c, new Date('2030-01-01T17:08:00.000Z'));
    const captured = await rows(false);
    assert.equal(captured.rows.length, 1);
    assert.equal(captured.rows[0].captured_at.toISOString(), '2030-01-01T17:03:00.000Z');
    // The called pair: its capture time moves once, and no second row appears.
    await insertRow({ ...world, week: 9, starter: world.b, benched: world.d, called: true });
    await write(world.b, world.d, new Date('2030-01-01T17:03:00.000Z'));
    await write(world.b, world.d, new Date('2030-01-01T17:08:00.000Z'));
    const called = await rows(true);
    assert.equal(called.rows.length, 1);
    assert.equal(called.rows[0].captured_at.toISOString(), '2030-01-01T17:03:00.000Z');
    assert.equal((await rows(false)).rows.length, 1, 'the called pair added no captured row');
  });

  test('down() refuses while rows exist (ADR 0012) and leaves the table', async () => {
    const knexShim = { raw: (sql) => pool.query(sql), schema: { dropTable: () => assert.fail('must not drop') } };
    await assert.rejects(() => migration.down(knexShim), /refusing to drop lineup_overrides/);
    const still = await pool.query(`SELECT count(*)::int AS n FROM "lineup_overrides" WHERE "team_id" = $1`, [world.teamId]);
    assert.ok(still.rows[0].n > 0);
  });

  test('deleting a team takes its rows with it (cascading foreign keys)', async () => {
    await pool.query(`DELETE FROM "teams" WHERE "id" = $1`, [world.otherTeamId]);
    const left = await pool.query(`SELECT count(*)::int AS n FROM "lineup_overrides" WHERE "team_id" = $1`, [world.otherTeamId]);
    assert.equal(left.rows[0].n, 0);
  });
}
