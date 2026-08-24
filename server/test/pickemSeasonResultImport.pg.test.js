/**
 * Disposable-PostgreSQL coverage for importing observable legacy Pick'em
 * season results (#293). The migration is rolled back so fixtures are seeded
 * against the exact pre-import schema, then reapplied and observed only
 * through the immutable result boundary.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENABLED = process.env.PICKEM_SEASON_RESULT_IMPORT_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('Pick\'em legacy-result import PG tests (skipped: PICKEM_SEASON_RESULT_IMPORT_PG_TESTS not set)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('Pick\'em legacy-result import PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const { resultOf } = require('../services/pickemSeasonResult.service');
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
  const MIGRATION_NAME = '20260824000002_import_legacy_pickem_season_results.js';
  const SEASON = 2081;
  let userIds = [];
  let leagueIds = [];
  let archiveTeamIds = [];
  let liveTeamIds = [];
  let ambiguousTeamIds = [];
  let contradictoryTeamIds = [];
  let conflictTeamIds = [];
  let incompleteTeamId;

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (applied) await knex.migrate.down({ name: MIGRATION_NAME });

    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES
         ('legacy_archive_a', 'legacy-archive-a@example.invalid', 'x'),
         ('legacy_archive_b', 'legacy-archive-b@example.invalid', 'x'),
         ('legacy_live_conflict', 'legacy-live-conflict@example.invalid', 'x'),
         ('legacy_live_a', 'legacy-live-a@example.invalid', 'x'),
         ('legacy_live_b', 'legacy-live-b@example.invalid', 'x')
       RETURNING "id"`
    );
    userIds = users.rows.map((row) => row.id);
    const leagues = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "pickem_only")
       VALUES
         ('Legacy Archive League', $1, 'pkimp001', true),
         ('Legacy Live League', $2, 'pkimp002', true),
         ('Legacy Partial League', $1, 'pkimp003', true),
         ('Legacy Zero League', $2, 'pkimp004', true),
         ('Legacy Contradiction League', $1, 'pkimp005', true),
         ('Existing Result League', $2, 'pkimp006', true),
         ('Legacy Incomplete League', $1, 'pkimp007', true)
       RETURNING "id"`,
      [userIds[0], userIds[3]]
    );
    leagueIds = leagues.rows.map((row) => row.id);
    const archiveTeams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES
         ($1, $2, 'Current Alpha'),
         ($1, $3, 'Current Bravo'),
         ($1, $4, 'Current Conflict')
      RETURNING "id"`,
      [leagueIds[0], ...userIds.slice(0, 3)]
    );
    archiveTeamIds = archiveTeams.rows.map((row) => row.id);
    const liveTeams = await pool.query(
      `INSERT INTO "teams"
         ("league_id", "owner_id", "name", "avatar_url", "avatar_static_url")
       VALUES
         ($1, $2, 'Live Alpha', 'https://cdn.example/live-alpha.png', NULL),
         ($1, $3, 'Live Bravo', NULL, 'https://cdn.example/live-bravo.png')
       RETURNING "id"`,
      [leagueIds[1], ...userIds.slice(3, 5)]
    );
    liveTeamIds = liveTeams.rows.map((row) => row.id);
    const ambiguousTeams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Partial Alpha'), ($1, $3, 'Partial Bravo')
       RETURNING "id"`,
      [leagueIds[2], userIds[0], userIds[1]]
    );
    ambiguousTeamIds = ambiguousTeams.rows.map((row) => row.id);
    await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Zero Evidence Team')`,
      [leagueIds[3], userIds[3]]
    );
    const contradictoryTeams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Contradiction Alpha'), ($1, $3, 'Contradiction Bravo')
       RETURNING "id"`,
      [leagueIds[4], userIds[0], userIds[1]]
    );
    contradictoryTeamIds = contradictoryTeams.rows.map((row) => row.id);
    const conflictTeams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Declared First'), ($1, $3, 'Legacy Challenger')
       RETURNING "id"`,
      [leagueIds[5], userIds[3], userIds[4]]
    );
    conflictTeamIds = conflictTeams.rows.map((row) => row.id);
    const incompleteTeam = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Incomplete Evidence Team')
       RETURNING "id"`,
      [leagueIds[6], userIds[0]]
    );
    incompleteTeamId = incompleteTeam.rows[0].id;

    await pool.query(
      `INSERT INTO "league_history"
         ("league_id", "season", "champion_team_id", "champion_user_id", "standings", "rosters", "awards")
       VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6)`,
      [
        leagueIds[0],
        SEASON,
        archiveTeamIds[0],
        userIds[0],
        JSON.stringify([
          {
            teamId: archiveTeamIds[0], teamName: 'Archived Alpha',
            avatarUrl: 'https://cdn.example/archived-alpha.png', avatarStaticUrl: null,
          },
          {
            teamId: archiveTeamIds[1], teamName: 'Archived Bravo',
            avatarUrl: null, avatarStaticUrl: 'https://cdn.example/archived-bravo.png',
          },
        ]),
        JSON.stringify([
          {
            team_id: archiveTeamIds[0], season: SEASON, week: 0, type: 'pickem_champion',
            label: `${SEASON} Pick'em Co-Champion`,
            data: { points: 42, correct: 16, mode: 'confidence' },
            awarded_at: '2082-01-10T04:00:00.000Z',
          },
          {
            team_id: archiveTeamIds[1], season: SEASON, week: 0, type: 'pickem_champion',
            label: `${SEASON} Pick'em Co-Champion`,
            data: { points: 42, correct: 16, mode: 'confidence' },
            awarded_at: '2082-01-10T04:00:01.000Z',
          },
        ]),
      ]
    );

    await pool.query(
      `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data")
       VALUES ($1, $2, $3, 0, 'pickem_champion', $4, $5)`,
      [
        leagueIds[0],
        archiveTeamIds[2],
        SEASON,
        `${SEASON} Pick'em Champion`,
        JSON.stringify({ points: 99, correct: 18, mode: 'straight' }),
      ]
    );

    await pool.query(
      `INSERT INTO "league_history"
         ("league_id", "season", "standings", "rosters", "awards")
       VALUES ($1, $2, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [leagueIds[1], SEASON]
    );
    for (const teamId of liveTeamIds) {
      await pool.query(
        `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data")
         VALUES ($1, $2, $3, 0, 'pickem_champion', $4, $5)`,
        [
          leagueIds[1], teamId, SEASON, `${SEASON} Pick'em Co-Champion`,
          JSON.stringify({ points: 12, correct: 12, mode: 'straight' }),
        ]
      );
    }

    await pool.query(
      `INSERT INTO "league_history"
       ("league_id", "season", "champion_team_id", "champion_user_id", "standings", "rosters", "awards")
       VALUES
         ($1, $2, $3, $4, $5, '[]'::jsonb, $6),
         ($7, $2, NULL, NULL, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb),
         ($8, $2, $9, $4, $10, '[]'::jsonb, $11)`,
      [
        leagueIds[2], SEASON, ambiguousTeamIds[0], userIds[0],
        JSON.stringify([
          { teamId: ambiguousTeamIds[0], teamName: 'Partial Alpha', avatarUrl: null, avatarStaticUrl: null },
          { teamId: ambiguousTeamIds[1], teamName: 'Partial Bravo', avatarUrl: null, avatarStaticUrl: null },
        ]),
        JSON.stringify([{
          team_id: ambiguousTeamIds[0], season: SEASON, week: 0, type: 'pickem_champion',
          label: `${SEASON} Pick'em Co-Champion`,
          data: { points: 9, correct: 9, mode: 'straight' },
          awarded_at: '2082-01-10T04:00:00.000Z',
        }]),
        leagueIds[3], leagueIds[4], contradictoryTeamIds[0],
        JSON.stringify([
          { teamId: contradictoryTeamIds[0], teamName: 'Contradiction Alpha', avatarUrl: null, avatarStaticUrl: null },
          { teamId: contradictoryTeamIds[1], teamName: 'Contradiction Bravo', avatarUrl: null, avatarStaticUrl: null },
        ]),
        JSON.stringify([
          {
            team_id: contradictoryTeamIds[0], season: SEASON, week: 0, type: 'pickem_champion',
            label: `${SEASON} Pick'em Co-Champion`,
            data: { points: 8, correct: 8, mode: 'straight' },
            awarded_at: '2082-01-10T04:00:00.000Z',
          },
          {
            team_id: contradictoryTeamIds[1], season: SEASON, week: 0, type: 'pickem_champion',
            label: `${SEASON} Pick'em Co-Champion`,
            data: { points: 7, correct: 7, mode: 'straight' },
            awarded_at: '2082-01-10T04:00:01.000Z',
          },
        ]),
      ]
    );

    for (const teamId of ambiguousTeamIds) {
      await pool.query(
        `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data")
         VALUES ($1, $2, $3, 0, 'pickem_champion', $4, $5)`,
        [
          leagueIds[2], teamId, SEASON, `${SEASON} Pick'em Co-Champion`,
          JSON.stringify({ points: 9, correct: 9, mode: 'straight' }),
        ]
      );
    }
    await pool.query(
      `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data")
       VALUES ($1, $2, $3, 0, 'pickem_champion', $4, $5)`,
      [
        leagueIds[5], conflictTeamIds[1], SEASON, `${SEASON} Pick'em Champion`,
        JSON.stringify({ points: 15, correct: 15, mode: 'straight' }),
      ]
    );
    await pool.query(
      `INSERT INTO "pickem_season_results"
         ("league_id", "season", "outcome", "scoring_mode", "champions", "declared_at")
       VALUES ($1, $2, 'champions', 'straight', $3, '2082-01-09T04:00:00.000Z')`,
      [
        leagueIds[5],
        SEASON,
        JSON.stringify([{
          teamId: conflictTeamIds[0], teamName: 'Declared First',
          avatarUrl: null, avatarStaticUrl: null,
          points: 1, correct: 1, mode: 'straight',
        }]),
      ]
    );
    await pool.query(
      `INSERT INTO "league_history"
         ("league_id", "season", "champion_team_id", "champion_user_id", "standings", "rosters", "awards")
       VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6)`,
      [
        leagueIds[6], SEASON, incompleteTeamId, userIds[0],
        JSON.stringify([{
          teamId: incompleteTeamId, teamName: 'Incomplete Evidence Team',
          avatarUrl: null, avatarStaticUrl: null,
        }]),
        JSON.stringify([{
          team_id: [incompleteTeamId], season: SEASON, week: 0, type: 'pickem_champion',
          label: `${SEASON} Pick'em Champion`,
          data: { points: false, correct: 6, mode: 'straight' },
          awarded_at: '2082-01-10T04:00:00.000Z',
        }]),
      ]
    );
  });

  test.after(async () => {
    try {
      if (leagueIds.length > 0) {
        await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [leagueIds]);
      }
      if (userIds.length > 0) await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [userIds]);
      const migrationPath = path.join(__dirname, '..', 'db', 'migrations', MIGRATION_NAME);
      const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
      if (fs.existsSync(migrationPath) && !applied) await knex.migrate.up({ name: MIGRATION_NAME });
    } finally {
      await pool.end();
      await knex.destroy();
    }
  });

  test('the migration imports only complete observable legacy results and preserves conflicts', async () => {
    await knex.migrate.up({ name: MIGRATION_NAME });

    const result = await resultOf({ db: pool, leagueId: leagueIds[0], season: SEASON });

    assert.equal(result.outcome, 'champions');
    assert.equal(result.mode, 'confidence');
    assert.deepEqual(result.champions, [
      {
        teamId: archiveTeamIds[0], teamName: 'Archived Alpha',
        avatarUrl: 'https://cdn.example/archived-alpha.png', avatarStaticUrl: null,
        points: 42, correct: 16, mode: 'confidence',
      },
      {
        teamId: archiveTeamIds[1], teamName: 'Archived Bravo',
        avatarUrl: null, avatarStaticUrl: 'https://cdn.example/archived-bravo.png',
        points: 42, correct: 16, mode: 'confidence',
      },
    ]);
    assert.equal(result.provenance.source, 'legacy_league_history_awards');
    assert.ok(Number.isInteger(result.provenance.leagueHistoryId));

    const live = await resultOf({ db: pool, leagueId: leagueIds[1], season: SEASON });
    assert.equal(live.outcome, 'champions');
    assert.equal(live.mode, 'straight');
    assert.deepEqual(live.champions, [
      {
        teamId: liveTeamIds[0], teamName: 'Live Alpha',
        avatarUrl: 'https://cdn.example/live-alpha.png', avatarStaticUrl: null,
        points: 12, correct: 12, mode: 'straight',
      },
      {
        teamId: liveTeamIds[1], teamName: 'Live Bravo',
        avatarUrl: null, avatarStaticUrl: 'https://cdn.example/live-bravo.png',
        points: 12, correct: 12, mode: 'straight',
      },
    ]);
    assert.equal(live.provenance.source, 'legacy_live_trophies');
    assert.equal(live.provenance.trophyIds.length, 2);

    for (const index of [2, 3, 4, 6]) {
      const missing = await resultOf({ db: pool, leagueId: leagueIds[index], season: SEASON });
      assert.equal(missing.outcome, 'missing');
      assert.equal(missing.provenance, null);
    }

    const existing = await resultOf({ db: pool, leagueId: leagueIds[5], season: SEASON });
    assert.deepEqual(existing.champions.map((champion) => champion.teamId), [conflictTeamIds[0]]);
    assert.deepEqual(existing.provenance, { source: 'season_completion' });

    const beforeRetry = await pool.query(
      `SELECT "league_id", "season", "outcome", "scoring_mode", "champions", "provenance", "declared_at"
         FROM "pickem_season_results" ORDER BY "league_id", "season"`
    );
    const migration = require('../db/migrations/20260824000002_import_legacy_pickem_season_results');
    await migration.importLegacyPickemSeasonResults(knex);
    await migration.importLegacyPickemSeasonResults(knex);
    const afterRetry = await pool.query(
      `SELECT "league_id", "season", "outcome", "scoring_mode", "champions", "provenance", "declared_at"
         FROM "pickem_season_results" ORDER BY "league_id", "season"`
    );
    assert.deepEqual(afterRetry.rows, beforeRetry.rows);
  });
}
