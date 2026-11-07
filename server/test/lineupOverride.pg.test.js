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
      await require('../modules/pool').end(); // the service's own pool, opened by the declaration cases
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

  // #2688: a Called shot declared behind a lineup save waits for the Team row lock
  // the save holds, then refuses against the lineup that save committed.
  // `save` is the slot the save commits for the starter and for the benched player.
  // `tag` keeps this call's usernames, invite code and player names unique in the shared DB.
  async function refusedBehindSave(tag, save) {
    const { declareCalledShot } = require('../services/lineupOverride.service');
    const owner = await seedUser(`lo_${tag}`);
    const leagueId = await seedLeague(owner, tag);
    await pool.query(`UPDATE "leagues" SET "current_season" = 2026, "current_week" = 6 WHERE "id" = $1`, [leagueId]);
    const teamId = await seedTeam(leagueId, owner);
    const starter = await seedPlayer(`${tag} starter`);
    const benched = await seedPlayer(`${tag} benched`);
    await pool.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
       VALUES ($1, $2, $3, 2026, 6, 'RB'), ($1, $2, $4, 2026, 6, 'BENCH')`,
      [leagueId, teamId, starter, benched]
    );
    const loadAdvice = async () => ({ season: 2026, week: 6, suggestions: [{
      slot: 'RB', current: { playerId: starter, projection: 6 }, suggested: { playerId: benched, projection: 18 },
      probabilityBetter: 0.92, verdict: 'start',
    }] });

    const a = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query(`SELECT "id" FROM "teams" WHERE "id" = $1 FOR UPDATE`, [teamId]);
      await a.query(`UPDATE "lineup_entries" SET "slot" = $3 WHERE "team_id" = $1 AND "player_id" = $2`, [teamId, starter, save.starter]);
      await a.query(`UPDATE "lineup_entries" SET "slot" = $3 WHERE "team_id" = $1 AND "player_id" = $2`, [teamId, benched, save.benched]);

      const declaring = declareCalledShot({ leagueId, userId: owner, week: 6, starterId: starter, benchedId: benched, loadAdvice });
      declaring.catch(() => {});
      let settled = false;
      declaring.then(() => { settled = true; }, () => { settled = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(settled, false, 'the declaration waits on the Team row lock while the save is open');

      await a.query('COMMIT');
      await assert.rejects(declaring, (error) => error.statusCode === 409);
      const pending = await pool.query(
        `SELECT count(*)::int AS n FROM "lineup_overrides"
         WHERE "team_id" = $1 AND "week" = 6 AND "called" AND "outcome" = 'pending'`,
        [teamId]
      );
      assert.equal(pending.rows[0].n, 0);
    } finally {
      await a.query('ROLLBACK').catch(() => {}); // a no-op once committed
      a.release();
    }
  }

  test('a Called shot declared behind a save that benches its starter waits for the Team row lock, then refuses 409 and stores nothing', async () => {
    await refusedBehindSave('lkbench', { starter: 'BENCH', benched: 'BENCH' });
  });

  test('a Called shot declared behind a save that starts its benched player waits for the Team row lock, then refuses 409 and stores nothing', async () => {
    await refusedBehindSave('lkstart', { starter: 'RB', benched: 'RB' });
  });

  // #2688: a declaration takes the League row's key share before the Team row lock,
  // so a League-locking writer that holds the League row is waited for while the
  // declaration holds no Team lock: another client can still lock the Team row.
  async function waitForLockWait() {
    for (let i = 0; i < 200; i += 1) {
      const waiting = await pool.query(
        `SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`
      );
      if (waiting.rows.length > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.fail('the declaration never parked on a lock');
  }

  test('a Called shot declaration takes the League key share before the Team row lock, so a League-locking writer cannot deadlock it', async () => {
    const { declareCalledShot } = require('../services/lineupOverride.service');
    const owner = await seedUser('lo_order');
    const leagueId = await seedLeague(owner, 'lo2');
    await pool.query(`UPDATE "leagues" SET "current_season" = 2026, "current_week" = 6 WHERE "id" = $1`, [leagueId]);
    const teamId = await seedTeam(leagueId, owner);
    const starter = await seedPlayer('lo2 starter');
    const benched = await seedPlayer('lo2 benched');
    await pool.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot")
       VALUES ($1, $2, $3, 2026, 6, 'RB'), ($1, $2, $4, 2026, 6, 'BENCH')`,
      [leagueId, teamId, starter, benched]
    );
    const loadAdvice = async () => ({ season: 2026, week: 6, suggestions: [{
      slot: 'RB', current: { playerId: starter, projection: 6 }, suggested: { playerId: benched, projection: 18 },
      probabilityBetter: 0.92, verdict: 'start',
    }] });

    const writer = await pool.connect(); // a drop or waiver run: the League row first, then the Team
    try {
      await writer.query('BEGIN');
      await writer.query(`SELECT "id" FROM "leagues" WHERE "id" = $1 FOR UPDATE`, [leagueId]);
      const declaring = declareCalledShot({ leagueId, userId: owner, week: 6, starterId: starter, benchedId: benched, loadAdvice });
      declaring.catch(() => {});
      await waitForLockWait();

      const probe = await pool.connect();
      try {
        await probe.query('BEGIN');
        const locked = await probe.query(`SELECT "id" FROM "teams" WHERE "id" = $1 FOR UPDATE NOWAIT`, [teamId]);
        assert.equal(locked.rows.length, 1);
        await probe.query('ROLLBACK');
      } finally {
        probe.release();
      }

      await writer.query('COMMIT');
      const shot = await declaring;
      assert.equal(shot.status, 'pending');
    } finally {
      await writer.query('ROLLBACK').catch(() => {}); // a no-op once committed
      writer.release();
    }
  });
}
