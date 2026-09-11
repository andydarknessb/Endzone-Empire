/**
 * Disposable-Postgres test for #1214: GET /api/league/:id's roster_count was
 * players x matchups played, not a roster size.
 *
 * server/routes/league.router.js's teams[] query used to LEFT JOIN both
 * "team_players" and "matchups" onto the same "teams" row, then take
 * COUNT("team_players"."id") over the joined product. Every matchup row a
 * team plays multiplies its counted roster rows, so a Team with 15 rostered
 * players and 3 Matchups read roster_count 45 (verified on production 2026-09-10,
 * league 137: four 15-man rosters with 14 Matchups each read 210). A
 * "total_points" column existed for the same reason, summing the same
 * fanned-out product; it had no consumer under src/ and was the wrong number
 * by rule regardless (Record is computed once, from finalized regular-season
 * Matchups, by season.getStandings) - see server/routes/league.router.js's
 * comment at the fixed query.
 *
 * server/test/leagueDetail.test.js cannot see this: fakePool answers the
 * teams query with a fixture, never real SQL, so a real join and its fan-out
 * are invisible to it no matter how the query is written. Only a real
 * Postgres GROUP BY over real joined rows demonstrates the bug and the fix.
 *
 * Gated twice, exactly like the other *.pg.test.js files: PG_TESTS=1 (or the
 * per-file LEAGUE_DETAIL_PG_TESTS=1) must be set, and every DATABASE_URL*
 * variable must be ABSENT, so a stray local run can never touch shared
 * production - server/modules/pool (which the router itself uses) and this
 * file's own seeding pool both build their connection from PG* variables only
 * when no DATABASE_URL is set. Discovery is by glob: scripts/run-pg-tests.js
 * runs every server/test/*.pg.test.js, so naming this file *.pg.test.js is
 * the whole of the wiring; CI's migration-smoke job is the binding run.
 *
 * Red-tell: reinstate the "matchups" LEFT JOIN and the total_points SUM in
 * server/routes/league.router.js's teams query, and the 15-player,
 * 3-matchup team below reads roster_count 45 instead of 15, and total_points
 * reappears in the response - both assertions below then fail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LEAGUE_DETAIL_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('league detail PG test (skipped: set PG_TESTS=1 or LEAGUE_DETAIL_PG_TESTS=1; CI migration-smoke runs it)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('league detail PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - this test must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const connection = {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
  };
  const pool = new pg.Pool({ ...connection, max: 5 });

  // JWT_SECRET must be set before ../modules/auth is required (getSecret()
  // reads it eagerly at sign time), mirroring leagueDetail.test.js.
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'league-detail-pg-test-secret';
  test.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  // The real route, wired exactly as server.js wires it. It reaches Postgres
  // through server/modules/pool, which - like `pool` above - builds its
  // connection from these same PG* variables once DATABASE_URL* is confirmed
  // absent, so both point at the one disposable database.
  const { signToken } = require('../modules/auth');
  const leagueRouter = require('../routes/league.router');
  const app = express();
  app.use(express.json());
  app.use('/api/league', leagueRouter);

  // A season of its own so a seeded Matchup can never collide with another
  // suite's fixture; scoped further by this test's own league_id regardless.
  const SEASON = 2097;

  const seeded = { users: [], leagues: [], players: [] };

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    seeded.users.push(res.rows[0].id);
    return res.rows[0].id;
  }

  async function seedLeague(ownerId, inviteCode) {
    // draft_status 'active' (not the default 'pending') so the route skips
    // its market-status branch entirely - unrelated to this bug and would
    // otherwise need its own player/data-sync-run fixtures.
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "draft_status")
       VALUES ('League Detail PG League', $1, $2, 'active') RETURNING "id"`,
      [ownerId, inviteCode]
    );
    seeded.leagues.push(res.rows[0].id);
    return res.rows[0].id;
  }

  async function seedTeam(leagueId, ownerId, name, draftPosition) {
    const res = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, $4) RETURNING "id"`,
      [leagueId, ownerId, name, draftPosition]
    );
    return res.rows[0].id;
  }

  async function seedPlayer(name) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, 'WR', 'MIN') RETURNING "id"`,
      [name]
    );
    seeded.players.push(res.rows[0].id);
    return res.rows[0].id;
  }

  async function rosterPlayer(leagueId, teamId, playerId) {
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, teamId, playerId]
    );
  }

  async function seedMatchup(leagueId, week, homeTeamId, awayTeamId) {
    await pool.query(
      `INSERT INTO "matchups" ("league_id", "season", "week", "home_team_id", "away_team_id", "home_score", "away_score")
       VALUES ($1, $2, $3, $4, $5, 21, 14)`,
      [leagueId, SEASON, week, homeTeamId, awayTeamId]
    );
  }

  test.after(async () => {
    // Deleting the league CASCADEs its teams, team_players and matchups
    // (each FKs "league_id" -> "leagues"."id" ON DELETE CASCADE); players and
    // users are global tables and need their own explicit deletes.
    try {
      for (const leagueId of seeded.leagues) {
        await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
      }
      for (const playerId of seeded.players) {
        await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [playerId]);
      }
      for (const userId of seeded.users) {
        await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [userId]);
      }
    } finally {
      await pool.end();
    }
  });

  test('GET league detail counts a roster once, never fanned out by Matchups, and drops total_points', async () => {
    const stamp = Date.now().toString(36);
    const viewer = await seedUser(`ld_viewer_${stamp}`);
    const opponent = await seedUser(`ld_opponent_${stamp}`);
    const emptyOwner = await seedUser(`ld_empty_${stamp}`);

    const leagueId = await seedLeague(viewer, `LD${stamp}`.slice(0, 12));

    const rosteredTeam = await seedTeam(leagueId, viewer, "Viewer's Team", 1);
    const opponentTeam = await seedTeam(leagueId, opponent, "Opponent's Team", 2);
    const emptyTeam = await seedTeam(leagueId, emptyOwner, 'Empty Team', 3);

    // 15 rostered players on rosteredTeam - the exact roster size from the
    // production report (league 137).
    for (let i = 0; i < 15; i += 1) {
      const playerId = await seedPlayer(`LD Player ${stamp} ${i}`);
      await rosterPlayer(leagueId, rosteredTeam, playerId);
    }

    // 3 Matchups against the same opponent, across 3 weeks. Before the fix,
    // each of these multiplies rosteredTeam's counted roster rows by one:
    // 15 roster rows x 3 Matchup rows = 45.
    await seedMatchup(leagueId, 1, rosteredTeam, opponentTeam);
    await seedMatchup(leagueId, 2, rosteredTeam, opponentTeam);
    await seedMatchup(leagueId, 3, rosteredTeam, opponentTeam);

    const token = signToken({ id: viewer, username: `ld_viewer_${stamp}` });
    const response = await request(app)
      .get(`/api/league/${leagueId}`)
      .set('Authorization', `Bearer ${token}`);

    assert.equal(response.status, 200, JSON.stringify(response.body));

    const byId = new Map(response.body.teams.map((team) => [team.id, team]));
    assert.equal(
      byId.get(rosteredTeam).roster_count, 15,
      'a 15-man roster with 3 Matchups must read 15, not 45 (players x Matchups)'
    );
    // A correlated count over zero matching rows must read 0, never null -
    // the other red-tell the issue calls out.
    assert.equal(byId.get(emptyTeam).roster_count, 0, 'a Team with no roster reads 0, not null');

    for (const team of response.body.teams) {
      assert.equal('total_points' in team, false, 'total_points has no consumer and is the wrong number by rule; it must be gone entirely');
    }
  });
}
