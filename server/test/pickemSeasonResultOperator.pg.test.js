/**
 * Disposable-PostgreSQL coverage for audited Pick'em result recovery and
 * correction (#294). Refuses every DATABASE_URL* variable so this cannot run
 * against the shared application database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PICKEM_SEASON_RESULT_OPERATOR_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('Pick\'em result operator PG tests (skipped: PICKEM_SEASON_RESULT_OPERATOR_PG_TESTS not set)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('Pick\'em result operator PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const {
    recover,
    correct,
    resultOf,
    auditTrailOf,
  } = require('../services/pickemSeasonResult.service');
  const pool = new pg.Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 2,
  });
  const SEASON = 2094;
  let userId;
  let leagueId;
  let teamId;

  const champion = () => ({
    teamId,
    teamName: 'Audited Team',
    avatarUrl: null,
    avatarStaticUrl: null,
    points: 21,
    correct: 17,
    mode: 'straight',
  });

  test.before(async () => {
    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('pickem_operator_pg', 'pickem-operator-pg@example.invalid', 'x')
       RETURNING "id"`
    );
    userId = user.rows[0].id;
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "pickem_only")
       VALUES ('Pickem Operator PG', $1, 'pkoprtpg', true) RETURNING "id"`,
      [userId]
    );
    leagueId = league.rows[0].id;
    const team = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Audited Team') RETURNING "id"`,
      [leagueId, userId]
    );
    teamId = team.rows[0].id;
    await pool.query(
      `INSERT INTO "league_history" ("league_id", "season") VALUES ($1, $2)`,
      [leagueId, SEASON]
    );
  });

  test.after(async () => {
    await pool.query('DROP TRIGGER IF EXISTS "pickem_result_operator_test_fail" ON "pickem_season_result_audits"').catch(() => {});
    await pool.query('DROP FUNCTION IF EXISTS "pickem_result_operator_test_fail"()').catch(() => {});
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (userId) await pool.query('DELETE FROM "users" WHERE "id" = $1', [userId]);
    await pool.end();
  });

  test('recovery and correction are dry-runnable, audited, idempotent, stale-safe, and atomic', async () => {
    const recoveryInput = {
      db: pool,
      leagueId,
      season: SEASON,
      operatorId: userId,
      reason: 'Signed commissioner archive verified',
      source: 'support-case-pg-294',
      proposed: { outcome: 'champions', mode: 'straight', champions: [champion()] },
    };

    const dryRecovery = await recover(recoveryInput);
    assert.equal(dryRecovery.dryRun, true);
    assert.equal((await resultOf({ db: pool, leagueId, season: SEASON })).outcome, 'missing');
    assert.deepEqual(await auditTrailOf({ db: pool, leagueId, season: SEASON }), []);

    const recovery = await recover({ ...recoveryInput, apply: true });
    assert.equal(recovery.applied, true);
    assert.equal(recovery.audit.operation, 'recovery');
    assert.deepEqual(recovery.audit.before, dryRecovery.before);
    assert.deepEqual(recovery.audit.after, recovery.after);
    assert.deepEqual(recovery.after.provenance, {
      source: 'operator_recovery',
      evidenceSource: 'support-case-pg-294',
      operatorId: userId,
    });
    assert.deepEqual(
      (await pool.query(
        `SELECT "pickem_result" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, SEASON]
      )).rows[0].pickem_result,
      recovery.after
    );

    const recoveryRetry = await recover({ ...recoveryInput, apply: true });
    assert.equal(recoveryRetry.applied, false);
    assert.equal(recoveryRetry.idempotent, true);
    assert.equal((await auditTrailOf({ db: pool, leagueId, season: SEASON })).length, 1);

    const missingHistoricalTeamId = 99999999;
    const correctedChampions = [
      { ...champion(), points: 22, correct: 18 },
      {
        teamId: missingHistoricalTeamId,
        teamName: 'Former Historical Team',
        avatarUrl: null,
        avatarStaticUrl: null,
        points: 22,
        correct: 18,
        mode: 'straight',
      },
    ];
    const correctionInput = {
      db: pool,
      leagueId,
      season: SEASON,
      operatorId: userId,
      reason: 'Complete co-champion evidence received',
      source: 'incident-pg-294',
      expected: recovery.after,
      proposed: { outcome: 'champions', mode: 'straight', champions: correctedChampions },
    };
    const dryCorrection = await correct(correctionInput);
    assert.equal(dryCorrection.dryRun, true);
    assert.deepEqual((await resultOf({ db: pool, leagueId, season: SEASON })).champions, [champion()]);

    await assert.rejects(
      correct({
        ...correctionInput,
        expected: { ...recovery.after, champions: [{ ...champion(), points: 999 }] },
      }),
      (error) => error.code === 'PICKEM_SEASON_RESULT_STALE'
    );

    const correction = await correct({ ...correctionInput, apply: true });
    assert.equal(correction.applied, true);
    assert.deepEqual(correction.after.champions, correctedChampions);
    assert.deepEqual(correction.audit.before, recovery.after);
    assert.deepEqual(correction.audit.after, correction.after);
    assert.deepEqual(
      (await pool.query(
        `SELECT "pickem_result" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, SEASON]
      )).rows[0].pickem_result,
      correction.after
    );

    const correctionRetry = await correct({ ...correctionInput, apply: true });
    assert.equal(correctionRetry.idempotent, true);
    assert.equal((await auditTrailOf({ db: pool, leagueId, season: SEASON })).length, 2);

    const trophies = await pool.query(
      `SELECT "team_id", "label" FROM "trophies"
        WHERE "league_id" = $1 AND "season" = $2 AND "type" = 'pickem_champion'
        ORDER BY "id"`,
      [leagueId, SEASON]
    );
    assert.deepEqual(trophies.rows.map((row) => Number(row.team_id)), [teamId]);
    assert.equal(trophies.rows[0].label, `${SEASON} Pick'em Co-Champion`);

    await pool.query(`
      CREATE OR REPLACE FUNCTION "pickem_result_operator_test_fail"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."reason" = 'force audit failure' THEN
          RAISE EXCEPTION 'forced audit failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER "pickem_result_operator_test_fail"
      BEFORE INSERT ON "pickem_season_result_audits"
      FOR EACH ROW EXECUTE FUNCTION "pickem_result_operator_test_fail"()
    `);
    await assert.rejects(
      correct({
        db: pool,
        apply: true,
        leagueId,
        season: SEASON,
        operatorId: userId,
        reason: 'force audit failure',
        source: 'rollback-proof',
        expected: correction.after,
        proposed: { outcome: 'no_champion', mode: 'straight', champions: [] },
      }),
      /forced audit failure/
    );
    await pool.query('DROP TRIGGER "pickem_result_operator_test_fail" ON "pickem_season_result_audits"');
    await pool.query('DROP FUNCTION "pickem_result_operator_test_fail"()');
    assert.deepEqual(await resultOf({ db: pool, leagueId, season: SEASON }), correction.after);
    assert.deepEqual(
      (await pool.query(
        `SELECT "pickem_result" FROM "league_history" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, SEASON]
      )).rows[0].pickem_result,
      correction.after
    );
    assert.equal((await auditTrailOf({ db: pool, leagueId, season: SEASON })).length, 2);
    assert.deepEqual(
      (await pool.query(
        `SELECT "team_id" FROM "trophies"
          WHERE "league_id" = $1 AND "season" = $2 AND "type" = 'pickem_champion'`,
        [leagueId, SEASON]
      )).rows.map((row) => Number(row.team_id)),
      [teamId]
    );
  });

  test('the audit table rejects update, delete, and truncate', async () => {
    await assert.rejects(
      pool.query(
        `UPDATE "pickem_season_result_audits" SET "reason" = 'rewritten'
          WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, SEASON]
      ),
      /append-only/
    );
    await assert.rejects(
      pool.query(
        `DELETE FROM "pickem_season_result_audits" WHERE "league_id" = $1 AND "season" = $2`,
        [leagueId, SEASON]
      ),
      /append-only/
    );
    await assert.rejects(pool.query('TRUNCATE "pickem_season_result_audits"'), /append-only/);
  });
}
