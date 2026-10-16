/**
 * Disposable-Postgres test for the Pick'em save lock (#2334, ADR 0067 wave 2): what only two real
 * transactions can show.
 *
 * Confidence picks save on tap, so two overlapping saves for one member and week are ordinary. The
 * rank-uniqueness check reads the rows the member already holds, and under READ COMMITTED two
 * transactions each read the other's rank as free and both write it. `upsertPicks` serializes a
 * member's saves for a week with `pg_advisory_xact_lock`; this fires two of them at once for two
 * different games with the same rank and asserts exactly one lands. A fake pool cannot: it has no
 * second connection to race.
 *
 * Gated twice, exactly like the other *.pg.test.js files: PG_TESTS=1 (or the per-file
 * PICKEM_UPSERT_LOCK_PG_TESTS=1) must be set, and every DATABASE_URL* variable must be ABSENT, so a
 * stray local run can never touch shared production. The gate is a strict `=== '1'` string compare.
 * CI's migration-smoke job, which runs every migration to latest and then this suite, is the
 * binding run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.PICKEM_UPSERT_LOCK_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('Pick\'em upsert lock PG test (skipped: set PG_TESTS=1 or PICKEM_UPSERT_LOCK_PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('Pick\'em upsert lock PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
  });
} else {
  // The service reads the same PG* variables through modules/pool.
  const pool = require('../modules/pool');
  const pickem = require('../services/pickem.service');

  const SEASON = 2097;
  const WEEK = 3;
  const stamp = Date.now().toString(36).slice(-6);
  const KICKOFF = '2097-09-14T17:00:00.000Z';
  const seeded = { users: [], leagues: [] };

  async function seedUser(name) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password") VALUES ($1, $2, 'x') RETURNING "id"`,
      [`${name}${stamp}`, `${name}${stamp}@example.invalid`]
    );
    seeded.users.push(res.rows[0].id);
    return res.rows[0].id;
  }

  test.before(async () => {
    // Two games on the week's slate, kicking off long after the test runs.
    for (const [team, opponent] of [['DAL', 'WAS'], ['WAS', 'DAL'], ['KC', 'DEN'], ['DEN', 'KC']]) {
      await pool.query(
        `INSERT INTO "nfl_games" ("season", "week", "nfl_team", "opponent", "kickoff_at")
         VALUES ($1, $2, $3, $4, $5)`,
        [SEASON, WEEK, team, opponent, KICKOFF]
      );
    }
  });

  test.after(async () => {
    await pool.query('DELETE FROM "pickem_picks" WHERE "season" = $1', [SEASON]);
    await pool.query('DELETE FROM "nfl_games" WHERE "season" = $1', [SEASON]);
    for (const leagueId of seeded.leagues) {
      await pool.query('DELETE FROM "pickem_settings" WHERE "league_id" = $1', [leagueId]);
      await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    }
    for (const userId of seeded.users) await pool.query('DELETE FROM "users" WHERE "id" = $1', [userId]);
    await pool.end();
  });

  test('a save waits behind another transaction holding the member-week lock, then lands', async () => {
    const userId = await seedUser('pickemlockw');
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "max_teams") VALUES ('lockw', $1, $2, 12) RETURNING "id"`,
      [userId, `pw${stamp}`.slice(0, 12)]
    );
    const leagueId = league.rows[0].id;
    seeded.leagues.push(leagueId);
    await pool.query(
      `INSERT INTO "pickem_settings" ("league_id", "enabled", "mode") VALUES ($1, true, 'straight')`,
      [leagueId]
    );

    // A second connection holds exactly the lock a save for this member and week takes.
    const holder = await pool.connect();
    let released = false;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pickem:${leagueId}:${userId}:${SEASON}:${WEEK}`]);
      let done = false;
      const saving = pickem.upsertPicks({
        leagueId, userId, season: SEASON, week: WEEK, now: new Date('2097-09-01T00:00:00.000Z'),
        picks: [{ gameKey: 'DAL|WAS', pickedTeam: 'DAL' }],
      }).then((result) => { done = true; return result; });

      // It is parked on the advisory lock, observable in pg_locks, and has written nothing.
      let waiting = 0;
      for (let attempt = 0; attempt < 40 && waiting === 0; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 50));
        // eslint-disable-next-line no-await-in-loop
        const res = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`);
        waiting = res.rows[0].n;
      }
      assert.equal(waiting, 1, 'the save is waiting on the advisory lock');
      assert.equal(done, false);
      const before = await pool.query('SELECT 1 FROM "pickem_picks" WHERE "league_id" = $1', [leagueId]);
      assert.equal(before.rows.length, 0);

      await holder.query('COMMIT');
      released = true;
      const result = await saving;
      assert.equal(result.saved, 1);
    } finally {
      if (!released) await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  });

  // Not a race detector on its own (two fast transactions often serialize by timing alone): the test
  // above is the one that fails without the lock. This is the end-to-end shape the lock exists for.
  test('two overlapping saves of the same rank for one member and week: exactly one lands', async () => {
    const userId = await seedUser('pickemlock');
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "max_teams") VALUES ('lock', $1, $2, 12) RETURNING "id"`,
      [userId, `pl${stamp}`.slice(0, 12)]
    );
    const leagueId = league.rows[0].id;
    seeded.leagues.push(leagueId);
    await pool.query(
      `INSERT INTO "pickem_settings" ("league_id", "enabled", "mode") VALUES ($1, true, 'confidence')`,
      [leagueId]
    );

    const save = (gameKey, pickedTeam) => pickem.upsertPicks({
      leagueId, userId, season: SEASON, week: WEEK, now: new Date('2097-09-01T00:00:00.000Z'),
      picks: [{ gameKey, pickedTeam, confidence: 1 }],
    }).then(() => 'saved', (error) => error.code);

    const outcomes = await Promise.all([save('DAL|WAS', 'DAL'), save('DEN|KC', 'KC')]);
    assert.deepEqual([...outcomes].sort(), ['PICKEM_BAD_CONFIDENCE', 'saved']);

    const held = await pool.query(
      `SELECT "team_pair", "confidence" FROM "pickem_picks" WHERE "league_id" = $1 AND "user_id" = $2`,
      [leagueId, userId]
    );
    assert.equal(held.rows.length, 1, 'one game holds rank 1, not two');
  });

  test('the lock is per member: another member saving the same rank is not blocked or refused', async () => {
    const owner = await seedUser('pickemlockb');
    const other = await seedUser('pickemlockc');
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "max_teams") VALUES ('lock2', $1, $2, 12) RETURNING "id"`,
      [owner, `pm${stamp}`.slice(0, 12)]
    );
    const leagueId = league.rows[0].id;
    seeded.leagues.push(leagueId);
    await pool.query(
      `INSERT INTO "pickem_settings" ("league_id", "enabled", "mode") VALUES ($1, true, 'confidence')`,
      [leagueId]
    );
    const save = (userId, gameKey, pickedTeam) => pickem.upsertPicks({
      leagueId, userId, season: SEASON, week: WEEK, now: new Date('2097-09-01T00:00:00.000Z'),
      picks: [{ gameKey, pickedTeam, confidence: 1 }],
    }).then(() => 'saved', (error) => error.code);
    assert.deepEqual(await Promise.all([save(owner, 'DAL|WAS', 'DAL'), save(other, 'DAL|WAS', 'WAS')]), ['saved', 'saved']);
  });
}
