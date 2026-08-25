/**
 * Disposable-Postgres coverage for the immutable Pick'em season result (#292).
 * It proves the real schema constraints, service idempotency/conflict rule,
 * and that deleting trophy or Team rows cannot change result readback.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PICKEM_SEASON_RESULT_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('Pick\'em season result PG tests (skipped: PICKEM_SEASON_RESULT_PG_TESTS not set)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('Pick\'em season result PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const { declare, resultOf } = require('../services/pickemSeasonResult.service');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const pool = new pg.Pool({ ...connection, max: 2 });
  const SEASON = 2088;
  let userId;
  let leagueId;
  let teamId;

  const standings = () => [{
    rank: 1,
    userId,
    username: 'pickem_result_pg',
    teamId,
    teamName: 'Historical Team',
    avatarUrl: 'https://cdn.example/team.png',
    avatarStaticUrl: null,
    points: 17,
    correct: 14,
  }];

  async function inTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  test.before(async () => {
    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('pickem_result_pg', 'pickem-result-pg@example.invalid', 'x') RETURNING "id"`
    );
    userId = user.rows[0].id;
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "pickem_only")
       VALUES ('Pickem Result PG', $1, 'pkrsltpg', true) RETURNING "id"`,
      [userId]
    );
    leagueId = league.rows[0].id;
    const team = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Historical Team') RETURNING "id"`,
      [leagueId, userId]
    );
    teamId = team.rows[0].id;
  });

  test.after(async () => {
    if (leagueId) await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    if (userId) await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [userId]);
    await pool.end();
  });

  test('declaration is durable, idempotent, conflict-safe, and independent of trophies and membership', async () => {
    const first = await inTransaction((db) => declare({
      db, leagueId, season: SEASON, standings: standings(), mode: 'straight',
    }));
    assert.equal(first.outcome, 'champions');
    assert.deepEqual(first.champions.map((champion) => champion.teamId), [teamId]);
    assert.equal(first.awarded.length, 1);

    const retry = await inTransaction((db) => declare({
      db, leagueId, season: SEASON, standings: standings(), mode: 'straight',
    }));
    assert.deepEqual(retry.awarded, []);

    await assert.rejects(
      inTransaction((db) => declare({
        db,
        leagueId,
        season: SEASON,
        standings: [{ ...standings()[0], points: 18, correct: 15 }],
        mode: 'straight',
      })),
      (error) => error.code === 'PICKEM_SEASON_RESULT_CONFLICT'
    );

    await pool.query(
      `DELETE FROM "trophies"
        WHERE "league_id" = $1 AND "season" = $2 AND "type" = 'pickem_champion'`,
      [leagueId, SEASON]
    );
    await pool.query(`DELETE FROM "teams" WHERE "id" = $1`, [teamId]);

    const preserved = await resultOf({ db: pool, leagueId, season: SEASON });
    assert.equal(preserved.outcome, 'champions');
    assert.deepEqual(preserved.champions, first.champions);
  });

  test('the schema enforces explicit outcome and champion-array invariants', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO "pickem_season_results"
           ("league_id", "season", "outcome", "scoring_mode", "champions")
         VALUES ($1, $2, 'champions', 'straight', '[]'::jsonb)`,
        [leagueId, SEASON + 1]
      ),
      /pickem_season_results_outcome_matches_champions/
    );
    await assert.rejects(
      pool.query(
        `INSERT INTO "pickem_season_results"
           ("league_id", "season", "outcome", "scoring_mode", "champions")
         VALUES ($1, $2, 'no_champion', 'straight', '{}'::jsonb)`,
        [leagueId, SEASON + 2]
      ),
      /pickem_season_results_champions_array/
    );
  });
}
