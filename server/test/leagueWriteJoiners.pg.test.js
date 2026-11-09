'use strict';

/**
 * Disposable-Postgres test for the writes that joined the League write (ADR 0070):
 * a Trade proposal, schedule generation (generateMatchups) and pick'em settings
 * (putSettings). None took the League row lock before; each now does, so each waits
 * while another League write holds the row and completes once that write commits.
 * On integration d81859a6 all three completed while the row was held. Only a real
 * Postgres can show a lock wait, so the fake pool cannot stand in for this file.
 *
 * Gated like leagueWrite.pg.test.js: PG_TESTS=1 (or LEAGUE_WRITE_PG_TESTS=1) must be
 * set, and every DATABASE_URL* variable must be ABSENT, so a stray local run never
 * touches the shared production database. It self-skips on a developer machine and
 * EXECUTES in CI's migration-smoke job.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.LEAGUE_WRITE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('league write joiners PG test (skipped: set PG_TESTS=1 or LEAGUE_WRITE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('league write joiners PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
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
  // The test's own reads. The writes under test connect through server/modules/pool,
  // which reads the same PG* variables.
  const pool = new pg.Pool({ ...connection, max: 2 });
  const modulePool = require('../modules/pool');
  const { leagueWrite } = require('../modules/leagueWrite');
  const { proposeTrade } = require('../services/trade.service');
  const { generateMatchups } = require('../services/matchupScoring.service');
  const { putSettings } = require('../services/pickem.service');

  // Arbitrary: nothing here reads season-scoped rows beyond the matchups this file writes.
  const SEASON = 2091;

  let leagueId = null;
  let ownerId = null;
  let otherOwnerId = null;
  let myTeamId = null;
  let otherTeamId = null;
  let myPlayerId = null;
  let otherPlayerId = null;

  /** Wait until `n` backends are blocked on a lock, so the next step runs only once the last one is parked. */
  async function waitForBlocked(n, what) {
    const deadline = Date.now() + 10000;
    for (;;) {
      const result = await pool.query(
        `SELECT COUNT(*)::int AS n FROM "pg_stat_activity"
          WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`
      );
      if (result.rows[0].n >= n) return;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${n} blocked backend(s): ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  const gate = () => {
    let open;
    const promise = new Promise((resolve) => {
      open = resolve;
    });
    return { promise, open };
  };

  /**
   * Hold the League row with one League write, start `writer`, and report whether
   * it completed while the holder still held the row. Then release and let both finish.
   */
  async function runAgainstHeldLeague(label, writer) {
    const held = gate();
    const release = gate();
    const holder = leagueWrite({ leagueId, label: `${label}-holder` }, async () => {
      held.open();
      await release.promise;
    });
    await held.promise;

    let done = false;
    const running = Promise.resolve()
      .then(writer)
      .then((value) => {
        done = true;
        return value;
      });
    // Release in finally: if the lock is missing nothing parks, and the holder must
    // still close, or modulePool.end() in test.after waits on it forever.
    try {
      await waitForBlocked(1, `${label} parked behind the League write`);
      assert.equal(done, false, `${label} has not completed while another League write holds the row`);
    } finally {
      release.open();
    }
    await holder;
    const value = await running;
    assert.equal(done, true, `${label} completes once the League write commits`);
    return value;
  }

  test.before(async () => {
    const owners = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('lw_joiner_owner', 'lw-joiner-owner@example.invalid', 'x'),
              ('lw_joiner_other', 'lw-joiner-other@example.invalid', 'x')
       RETURNING "id"`
    );
    ownerId = owners.rows[0].id;
    otherOwnerId = owners.rows[1].id;

    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status")
       VALUES ('PG League Joiners', $1, 'lwjoin1', $2, 1, 10, 0, 24, 'complete')
       RETURNING "id"`,
      [ownerId, SEASON]
    );
    leagueId = league.rows[0].id;

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, 'PG Joiner Team', 1), ($1, $3, 'PG Joiner Other', 2)
       RETURNING "id", "owner_id"`,
      [leagueId, ownerId, otherOwnerId]
    );
    myTeamId = teams.rows.find((t) => t.owner_id === ownerId).id;
    otherTeamId = teams.rows.find((t) => t.owner_id === otherOwnerId).id;

    // One player on each roster, so a trade moves something in each direction.
    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Joiner Mine', 'RB', 'LWJ'), ('PG Joiner Theirs', 'WR', 'LWJ')
       RETURNING "id"`
    );
    myPlayerId = players.rows[0].id;
    otherPlayerId = players.rows[1].id;
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id")
       VALUES ($1, $2, $3), ($1, $4, $5)`,
      [leagueId, myTeamId, myPlayerId, otherTeamId, otherPlayerId]
    );
  });

  test.after(async () => {
    if (leagueId != null) await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    await pool.query(`DELETE FROM "players" WHERE "id" = ANY($1::int[])`, [[myPlayerId, otherPlayerId].filter((id) => id != null)]);
    await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [[ownerId, otherOwnerId].filter((id) => id != null)]);
    await pool.end();
    await modulePool.end();
  });

  test('a Trade proposal waits while another League write holds the League row, then completes', async () => {
    const trade = await runAgainstHeldLeague('lw-joiner-trade', () =>
      proposeTrade({
        leagueId,
        userId: ownerId,
        receivingTeamId: otherTeamId,
        playerIds: [myPlayerId, otherPlayerId],
      })
    );
    assert.ok(trade && trade.id, 'the proposal returns the trade row');
  });

  test('schedule generation waits while another League write holds the League row, then completes', async () => {
    const result = await runAgainstHeldLeague('lw-joiner-matchups', () =>
      generateMatchups({ leagueId, season: SEASON, week: 1 })
    );
    assert.equal(result.created, 1, 'two teams make one round-robin pairing in week 1');
  });

  test('pick\'em settings wait while another League write holds the League row, then complete', async () => {
    await runAgainstHeldLeague('lw-joiner-pickem', () => putSettings({ leagueId, enabled: true }));
    const settings = await pool.query(
      `SELECT "enabled" FROM "pickem_settings" WHERE "league_id" = $1`,
      [leagueId]
    );
    assert.equal(settings.rows[0].enabled, true, 'the settings write landed after the lock released');
  });
}
