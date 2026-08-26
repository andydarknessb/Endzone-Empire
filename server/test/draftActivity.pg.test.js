/**
 * Disposable-Postgres test for the Draft-activity feed (#435, ADR 0012).
 *
 * Every claim here is about the DATABASE, and a matcher fake cannot express any
 * of them: the fast suites do not run triggers, and the whole point of #435 is
 * that Draft activity and League chat SHARE one per-league sequence a real
 * Postgres allocates. So it gets a real Postgres.
 *
 * Claims, in build order:
 *
 * 1. SHARED SEQUENCE. A chat insert and an appendPickActivity insert for one
 *    league draw from the SAME `league_feed_sequences` counter, so their
 *    positions interleave into one contiguous run (chat 1, pick 2, chat 3,
 *    pick 4), and a second league's run is independent.
 * 2. COMBINED READ. listCombinedDraftFeed interleaves both kinds by feed_seq,
 *    oldest-first, shaping each by type, and pages older by a feed_seq cursor.
 *    A Pick entry carries the snapshotted Team, player, position, NFL team,
 *    round, overall Pick number and its autopick flag (#435 AC2, AC3).
 * 3. BLOCKING. A blocked author's CHAT drops from a viewer's combined read, but
 *    that author's authoritative Draft ACTIVITY stays visible (user story 83).
 * 4. UNIQUE POSITION. The unique (league_id, feed_seq) index rejects a second
 *    activity row that claims a position already handed out.
 * 5. GUARDED ROLLBACK. down() refuses while the table holds rows (ADR 0012's
 *    append-only history), and the table survives the refusal.
 *
 * Gated twice, exactly like leagueChatFeed.pg.test.js: DRAFT_ACTIVITY_PG_TESTS=1
 * (or the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable
 * must be ABSENT, so a stray local run can never touch shared production.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { appendPickActivity, DRAFT_ACTIVITY, PICK } = require('../services/draftActivity');
const { listCombinedDraftFeed, LEAGUE_CHAT } = require('../services/leagueFeed');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DRAFT_ACTIVITY_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('draft activity PG tests (skipped: set PG_TESTS=1 or DRAFT_ACTIVITY_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('draft activity PG tests refuse to run with DATABASE_URL* set', () => {
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
  const pool = new pg.Pool({ ...connection, max: 2 });
  const knex = require('knex')({
    client: 'pg',
    connection,
    migrations: { directory: path.join(__dirname, '..', 'db', 'migrations') },
  });

  const MIGRATION_NAME = '20260826000003_draft_activity.js';
  const migration = require('../db/migrations/20260826000003_draft_activity');

  let leagueA = null;
  let leagueB = null;
  let ownerA = null;
  let ownerB = null;
  let teamA = null;
  let teamB = null;
  let playerId = null;

  async function seedUser(username) {
    const res = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ($1, $2, 'x') RETURNING "id"`,
      [username, `${username}@example.invalid`]
    );
    return res.rows[0].id;
  }
  async function seedLeague(name, ownerId, code) {
    const res = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code")
       VALUES ($1, $2, $3) RETURNING "id"`,
      [name, ownerId, code]
    );
    return res.rows[0].id;
  }
  async function seedTeam(leagueId, ownerId, name) {
    const res = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, $3) RETURNING "id"`,
      [leagueId, ownerId, name]
    );
    return res.rows[0].id;
  }
  async function seedPlayer(name, position, nflTeam) {
    const res = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team") VALUES ($1, $2, $3) RETURNING "id"`,
      [name, position, nflTeam]
    );
    return res.rows[0].id;
  }
  // A live chat insert: names no feed_seq, so the trigger allocates it.
  async function liveChat(leagueId, userId, message) {
    const res = await pool.query(
      `INSERT INTO "chat_messages" ("league_id", "user_id", "message")
       VALUES ($1, $2, $3) RETURNING "id", "feed_seq"`,
      [leagueId, userId, message]
    );
    return res.rows[0];
  }
  // A pick activity through the real service against the disposable pool.
  function pickActivity(leagueId, team, player, round, pickNumber, auto = false) {
    return appendPickActivity(pool, { leagueId, team, player, round, pickNumber, auto });
  }

  test.before(async () => {
    const applied = await knex('knex_migrations').where({ name: MIGRATION_NAME }).first();
    if (!applied) await knex.migrate.up({ name: MIGRATION_NAME });

    ownerA = await seedUser('draft_activity_pg_a');
    ownerB = await seedUser('draft_activity_pg_b');
    leagueA = await seedLeague('Draft Activity PG A', ownerA, 'draftactpga');
    leagueB = await seedLeague('Draft Activity PG B', ownerB, 'draftactpgb');
    teamA = await seedTeam(leagueA, ownerA, 'Alpha');
    teamB = await seedTeam(leagueA, ownerB, 'Bravo');
    playerId = await seedPlayer('Pat Mahomes', 'QB', 'KC');
  });

  test.after(async () => {
    // CASCADE from leagues removes chat_messages and draft_activity rows, so the
    // append-only guard sees an empty table when migration-smoke rolls back.
    if (leagueA) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueA]);
    if (leagueB) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueB]);
    if (playerId) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerId]);
    if (ownerA) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerA]);
    if (ownerB) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerB]);
    await pool.end();
    await knex.destroy();
  });

  test('chat and Pick activity share one per-league sequence and interleave', async () => {
    const c1 = await liveChat(leagueA, ownerA, 'good luck');
    const a1 = await pickActivity(leagueA, { id: teamA, name: 'Alpha' }, { id: playerId, name: 'Pat Mahomes', position: 'QB', nfl_team: 'KC' }, 1, 1, false);
    const c2 = await liveChat(leagueA, ownerB, 'lets go');
    const a2 = await pickActivity(leagueA, { id: teamB, name: 'Bravo' }, { id: playerId, name: 'Pat Mahomes', position: 'QB', nfl_team: 'KC' }, 1, 2, true);

    // One contiguous run across BOTH tables, allocated in insert order.
    assert.deepEqual(
      [Number(c1.feed_seq), a1.seq, Number(c2.feed_seq), a2.seq],
      [1, 2, 3, 4],
      'a chat and an activity insert draw from the same per-league counter'
    );

    // League B's run is independent: its first entry is seq 1, not 5.
    const b1 = await liveChat(leagueB, ownerB, 'other league');
    assert.equal(Number(b1.feed_seq), 1, 'the counter is per league');
  });

  test('combined read interleaves both kinds oldest-first and snapshots the Pick', async () => {
    const feed = await listCombinedDraftFeed(pool, { leagueId: leagueA, viewerId: ownerA });
    assert.deepEqual(feed.map((e) => e.seq), [1, 2, 3, 4], 'ordered by the shared feed_seq');
    assert.deepEqual(feed.map((e) => e.type), [LEAGUE_CHAT, DRAFT_ACTIVITY, LEAGUE_CHAT, DRAFT_ACTIVITY]);

    const pick = feed[1];
    assert.equal(pick.kind, PICK);
    assert.equal(pick.teamId, teamA);
    assert.equal(pick.teamName, 'Alpha');
    assert.deepEqual(pick.player, { id: playerId, name: 'Pat Mahomes', position: 'QB', nflTeam: 'KC' });
    assert.equal(pick.round, 1);
    assert.equal(pick.pickNumber, 1);
    assert.equal(pick.isAutopick, false);
    assert.ok(pick.created_at, 'the event carries its own timestamp');

    // The autopick was labeled only because the write said so (#435 AC3).
    assert.equal(feed[3].isAutopick, true);
  });

  test('the combined read pages older entries by a feed_seq cursor', async () => {
    const older = await listCombinedDraftFeed(pool, { leagueId: leagueA, viewerId: ownerA, before: 3 });
    assert.deepEqual(older.map((e) => e.seq), [1, 2], 'before=3 returns the two entries just older than seq 3');
  });

  test('blocking hides the blocked author chat but keeps their Draft activity', async () => {
    // ownerA blocks ownerB. B authored chat seq 3 and pick activity seq 4.
    await pool.query(
      `INSERT INTO "user_blocks" ("blocker_id", "blocked_id") VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ownerA, ownerB]
    );
    const feed = await listCombinedDraftFeed(pool, { leagueId: leagueA, viewerId: ownerA });
    const seqs = feed.map((e) => e.seq);
    assert.ok(!seqs.includes(3), 'the blocked author\'s chat is hidden');
    assert.ok(seqs.includes(4), 'the blocked author\'s authoritative Draft activity stays visible');
    // Cleanup so the block does not leak into later assertions.
    await pool.query('DELETE FROM "user_blocks" WHERE "blocker_id" = $1 AND "blocked_id" = $2', [ownerA, ownerB]);
  });

  test('the unique (league_id, feed_seq) index rejects a duplicate position', async () => {
    await assert.rejects(
      () =>
        pool.query(
          `INSERT INTO "draft_activity"
             ("league_id", "kind", "team_id", "team_name", "player_name", "round", "pick_number", "feed_seq")
           VALUES ($1, 'pick', $2, 'Alpha', 'Dup', 1, 9, 1)`,
          [leagueA, teamA]
        ),
      /duplicate key|unique/i,
      'a row explicitly claiming seq 1 collides with the chat that already holds it'
    );
  });

  test('down() refuses to drop the table while it holds append-only history', async () => {
    await assert.rejects(() => migration.down(knex), /append-only|refusing/i);
    // The refusal happened BEFORE any drop: the table is still there.
    const still = await pool.query(
      `SELECT to_regclass('public.draft_activity') AS present`
    );
    assert.ok(still.rows[0].present, 'the table survives the refused rollback');
  });
}
