/**
 * League create against real Postgres (#2746): the invite code the route generates
 * fits `leagues.invite_code`, and a lineup entry accepts a 20-character slot name.
 * Reverting the widening migration (20261109000003) turns this red.
 *
 * Gated like draftBoardVersion.pg.test.js: PG_TESTS=1 (or LEAGUE_CREATE_PG_TESTS=1)
 * must be set and every DATABASE_URL* variable absent. It self-skips on a developer
 * machine and EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LEAGUE_CREATE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('league create PG test (skipped: set PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('league create PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
  });
} else {
  const express = require('express');
  const request = require('supertest');
  const pool = require('../modules/pool');
  const { signToken } = require('../modules/auth');

  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'league-create-pg-test-secret';
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });
  const LONG_SLOT = 'A'.repeat(20);

  // Every row this file creates, removed in test.after (a serial pg run shares one database).
  const createdLeagues = [];
  const createdPlayers = [];
  const createdUsers = [];
  let app;

  test.before(async () => {
    await knex.migrate.latest();
    app = express();
    app.use(express.json());
    app.use('/api/league', require('../routes/league.router'));
  });

  test.after(async () => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    for (const id of createdLeagues) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [id]);
    for (const id of createdPlayers) await pool.query('DELETE FROM "players" WHERE "id" = $1', [id]);
    for (const id of createdUsers) await pool.query('DELETE FROM "users" WHERE "id" = $1', [id]);
    await knex.destroy();
    await pool.end();
  });

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password") VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    createdUsers.push(res.rows[0].id);
    return res.rows[0].id;
  }

  async function createLeague(username) {
    const userId = await seedUser(username);
    const res = await request(app)
      .post('/api/league')
      .set('Authorization', `Bearer ${signToken({ id: userId, username })}`)
      .send({ name: `${username} League`, teamName: `${username} Team` });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    createdLeagues.push(res.body.id);
    return res.body;
  }

  test('POST /api/league answers 201 with a 16-hexadecimal invite code (#2746)', async () => {
    const league = await createLeague('league-create-code');
    assert.match(league.invite_code, /^[0-9a-f]{16}$/);
  });

  test('a lineup entry accepts a 20-character slot name (#2746)', async () => {
    const league = await createLeague('league-create-slot');
    const team = await pool.query('SELECT "id" FROM "teams" WHERE "league_id" = $1', [league.id]);
    const player = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ('Slot Test', 'RB', 'KC') RETURNING "id"`
    );
    createdPlayers.push(player.rows[0].id);

    await pool.query(
      `INSERT INTO "lineup_entries" ("league_id", "team_id", "player_id", "season", "week", "slot", "ir_attested")
       VALUES ($1, $2, $3, 2026, 1, $4, false)`,
      [league.id, team.rows[0].id, player.rows[0].id, LONG_SLOT]
    );
    const stored = await pool.query('SELECT "slot" FROM "lineup_entries" WHERE "league_id" = $1', [league.id]);
    assert.equal(stored.rows[0].slot, LONG_SLOT);
  });
}
