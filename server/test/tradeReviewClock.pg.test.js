/**
 * Disposable-Postgres test for the review window's clock (spec #2681, ticket #2698).
 *
 * The defect: vetoTrade compared review_ends_at with the app's clock while
 * processDueTrades compared it with the database's now(). Near the boundary a
 * veto and the due run could disagree about the same trade. The fix moves the
 * veto onto the database's clock: loadTrade reads review_closed (review_ends_at
 * <= now()), the predicate processDueTrades selects by.
 *
 * The claim, against real Postgres, one second either side of the boundary:
 *
 *   A trade whose review_ends_at is one second BEFORE now() is past review. A
 *   veto is refused ("the review window has closed") and records no vote, and
 *   processDueTrades executes the trade.
 *
 *   A trade whose review_ends_at is one second AFTER now() is still in review. A
 *   veto is recorded, and processDueTrades leaves the trade alone.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service), gated the same
 * way as tradeCapacityRace.pg.test.js: PG_TESTS=1 (or TRADE_REVIEW_CLOCK_PG_TESTS=1)
 * must be set, and every DATABASE_URL* variable must be ABSENT, so a stray local
 * run can never touch the shared production database.
 *
 * Discovery is by glob (scripts/run-pg-tests.js runs every server/test/*.pg.test.js).
 * It seeds and deletes its own league and users, and its players explicitly.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.TRADE_REVIEW_CLOCK_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('trade review clock PG test (skipped: set PG_TESTS=1 or TRADE_REVIEW_CLOCK_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('trade review clock PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} — these tests must only ever see a disposable PG* database`);
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
  const pool = new pg.Pool({ ...connection, max: 2 });

  // The real code under test. trade.service connects through server/modules/pool.
  const tradeService = require('../services/trade.service');
  const modulePool = require('../modules/pool');
  const {
    createDraftRoomBroadcast,
    setDraftRoomBroadcast,
  } = require('../modules/draftRoomBroadcast');

  // A league of its own: 2101 is not spoken for by the other PG suites' seasons.
  const SEASON = 2101;
  const CURRENT_WEEK = 1;

  let priorBroadcast = null;
  let leagueId = null;
  let ownerCId = null;
  let teamA = null;
  let teamB = null;
  let closedTradeId = null;
  let openTradeId = null;
  const seededUserIds = [];
  const seededPlayerIds = [];

  async function tradeStatus(tradeId) {
    const result = await pool.query(`SELECT "status" FROM "trades" WHERE "id" = $1`, [tradeId]);
    return result.rows[0].status;
  }

  test.before(async () => {
    // executeTrade fires a post-commit room broadcast; register a recording no-op.
    priorBroadcast = setDraftRoomBroadcast(
      createDraftRoomBroadcast({ to: () => ({ emit: () => {} }) }, 'test')
    );

    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('trc_owner_a', 'trc-owner-a@example.invalid', 'x'),
              ('trc_owner_b', 'trc-owner-b@example.invalid', 'x'),
              ('trc_owner_c', 'trc-owner-c@example.invalid', 'x')
       RETURNING "id"`
    );
    for (const row of users.rows) seededUserIds.push(row.id);
    const ownerAId = users.rows[0].id;
    const ownerBId = users.rows[1].id;
    ownerCId = users.rows[2].id;

    // Vetoes on (2 votes), draft complete (the trade window is open at all, #2550),
    // no deadline, and a roster limit wide enough that the due run can execute.
    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "trade_veto_votes", "trade_review_hours", "draft_status")
       VALUES ('PG Trade Review Clock', $1, 'trc001', $2, $3, 6, 0, 2, 24, 'complete')
       RETURNING "id"`,
      [ownerAId, SEASON, CURRENT_WEEK]
    );
    leagueId = league.rows[0].id;

    const teams = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'PG Clock Receiver'), ($1, $3, 'PG Clock Sender'), ($1, $4, 'PG Clock Voter')
       RETURNING "id", "name"`,
      [leagueId, ownerAId, ownerBId, ownerCId]
    );
    teamA = teams.rows.find((t) => t.name === 'PG Clock Receiver').id;
    teamB = teams.rows.find((t) => t.name === 'PG Clock Sender').id;

    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('PG Clock Closed', 'WR', 'TCB'), ('PG Clock Open', 'WR', 'TCB')
       RETURNING "id", "name"`
    );
    for (const row of players.rows) seededPlayerIds.push(row.id);
    const closedPlayer = players.rows.find((p) => p.name === 'PG Clock Closed').id;
    const openPlayer = players.rows.find((p) => p.name === 'PG Clock Open').id;

    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES
         ($1, $2, $3), ($1, $2, $4)`,
      [leagueId, teamB, closedPlayer, openPlayer]
    );

    // Two accepted trades, each moving one of Team B's players to Team A. The
    // windows are one second either side of the database's now().
    const madeTrades = await pool.query(
      `INSERT INTO "trades" ("league_id", "proposing_team_id", "receiving_team_id", "status", "review_ends_at")
       VALUES ($1, $2, $3, 'accepted', now() - interval '1 second'),
              ($1, $2, $3, 'accepted', now() + interval '1 second')
       RETURNING "id", "review_ends_at"`,
      [leagueId, teamB, teamA]
    );
    closedTradeId = madeTrades.rows[0].id;
    openTradeId = madeTrades.rows[1].id;

    await pool.query(
      `INSERT INTO "trade_items" ("trade_id", "player_id", "from_team_id", "to_team_id")
       VALUES ($1, $2, $3, $4), ($5, $6, $3, $4)`,
      [closedTradeId, closedPlayer, teamB, teamA, openTradeId, openPlayer]
    );
  });

  test.after(async () => {
    if (leagueId != null) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = $1`, [leagueId]);
    }
    if (seededPlayerIds.length) {
      await pool.query(`DELETE FROM "players" WHERE "id" = ANY($1::int[])`, [seededPlayerIds]);
    }
    if (seededUserIds.length) {
      await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [seededUserIds]);
    }
    setDraftRoomBroadcast(priorBroadcast);
    await pool.end();
    await modulePool.end();
  });

  // One ordered test: the open window is one second, and the due run executes the
  // closed trade, so both vetoes come first and the due run last.
  test('the veto and the due run agree one second either side of review_ends_at', async () => {
    await assert.rejects(
      tradeService.vetoTrade({ tradeId: closedTradeId, userId: ownerCId }),
      { statusCode: 409, message: 'the review window has closed' },
      'a veto past review_ends_at is refused by the database clock'
    );

    // Set the open window right before its veto, so the one second is spent on the
    // veto and the due run only, not on the setup above.
    await pool.query(`UPDATE "trades" SET "review_ends_at" = now() + interval '1 second' WHERE "id" = $1`, [openTradeId]);
    const outcome = await tradeService.vetoTrade({ tradeId: openTradeId, userId: ownerCId });
    assert.deepEqual(outcome, { tradeId: openTradeId, votes: 1, votesNeeded: 2, status: 'accepted' });

    const outcomes = await tradeService.processDueTrades();
    const closed = outcomes.find((o) => o.tradeId === closedTradeId);
    assert.ok(closed, 'the trade past its window is due, so the due run reaches it');
    assert.equal(closed.status, 'executed');
    assert.equal(await tradeStatus(closedTradeId), 'executed');

    assert.equal(
      outcomes.find((o) => o.tradeId === openTradeId),
      undefined,
      'a trade still in review is not due, so the due run does not touch it'
    );
    assert.equal(await tradeStatus(openTradeId), 'accepted');
  });
}
