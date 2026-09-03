/**
 * Disposable-Postgres test for the repeated waiver-results email (NanaGoat's
 * "66 emails from 1 transaction" report, 2026-09-03).
 *
 * Two things only a real Postgres can prove, because a matcher fake has no
 * microsecond clock and no WHERE clause:
 *
 * 1. digest.sendWaiverResultsDigest emails a resolved claim ONCE. The
 *    per-league watermark is a JS Date (millisecond precision) while
 *    waiver_claims.processed_at is timestamptz (microsecond precision), so
 *    `processed_at > $watermark` must not re-select the very claim the
 *    watermark was advanced to.
 * 2. waiver.service.processAllDueWaivers stops listing a league once its
 *    post-draft blanket window has expired and been processed with nothing
 *    pending. A league whose waivers_clear_at sits in the past must not be
 *    "due" on every scheduler tick forever, because every such tick re-runs
 *    the digest.
 *
 * Gated exactly like the other *.pg.test.js files: PG_TESTS=1 (or
 * WAIVER_DIGEST_PG_TESTS=1) must be set and every DATABASE_URL* variable must
 * be ABSENT, so a stray local run can never touch the shared production
 * database. Seeds and deletes its own users, league, player and claims.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.WAIVER_DIGEST_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

if (!ENABLED) {
  test('waiver digest repeat PG tests (skipped: set PG_TESTS=1 or WAIVER_DIGEST_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('waiver digest repeat PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  // Capture emails instead of sending them. digest.service destructures
  // deliverEmail at require time, so the stub has to be in place before the
  // service is first required.
  const sentEmails = [];
  const accountPath = require.resolve('../services/account.service');
  const realAccount = require(accountPath);
  require.cache[accountPath].exports = {
    ...realAccount,
    deliverEmail: async (message) => {
      sentEmails.push(message);
      return { delivered: 'stub' };
    },
  };
  const pool = require('../modules/pool');
  const digest = require('../services/digest.service');
  const waiver = require('../services/waiver.service');
  // processWaivers refreshes roster availability through the Draft room
  // broadcast (#745), which throws when nothing is registered for the process.
  const { registerRecordingBroadcast } = require('./helpers/recordingBroadcast');
  registerRecordingBroadcast();

  let ownerId = null;
  let leagueId = null;
  let teamId = null;
  let playerId = null;

  test.before(async () => {
    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('waiver_digest_pg_owner', 'waiver_digest_pg_owner@example.invalid', 'x') RETURNING "id"`
    );
    ownerId = user.rows[0].id;
    // The post-draft blanket window expired an hour ago: exactly MinneApple's
    // shape on 2026-09-02 (waivers_clear_at = 03:05Z, claims processed 03:09Z).
    const league = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "current_season", "current_week",
                              "waivers_clear_at")
       VALUES ('Waiver Digest PG', $1, 'wvdigestpg', 2026, 1, now() - interval '1 hour')
       RETURNING "id"`,
      [ownerId]
    );
    leagueId = league.rows[0].id;
    const team = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Nanagoat PG') RETURNING "id"`,
      [leagueId, ownerId]
    );
    teamId = team.rows[0].id;
    const player = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('Waiver Digest PG Player', 'RB', 'DEN') RETURNING "id"`
    );
    playerId = player.rows[0].id;
  });

  test.after(async () => {
    if (leagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [leagueId]);
    if (playerId) await pool.query('DELETE FROM "players" WHERE "id" = $1', [playerId]);
    if (ownerId) await pool.query('DELETE FROM "users" WHERE "id" = $1', [ownerId]);
    await pool.end();
  });

  test('a won claim with a microsecond processed_at is emailed exactly once across repeated digests', async () => {
    // Force a sub-millisecond remainder so the run is deterministic rather than
    // 999-in-1000: the watermark truncates to .xxx000, the row holds .xxx500.
    await pool.query(
      `INSERT INTO "waiver_claims" ("league_id", "team_id", "player_id", "status", "processed_at")
       VALUES ($1, $2, $3, 'won',
               date_trunc('milliseconds', now()) + interval '500 microseconds')`,
      [leagueId, teamId, playerId]
    );

    sentEmails.length = 0;
    const first = await digest.sendWaiverResultsDigest({ leagueId });
    assert.equal(first.sent, 1, 'first digest emails the freshly resolved claim');
    assert.equal(sentEmails.length, 1);
    assert.match(sentEmails[0].text, /WON: Waiver Digest PG Player/);

    // The scheduler calls this again on the next tick. Nothing new resolved, so
    // nothing may be re-sent. This is the assertion that mirrors the report.
    const repeats = [];
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      repeats.push((await digest.sendWaiverResultsDigest({ leagueId })).sent);
    }
    assert.deepEqual(repeats, [0, 0, 0], 'later digests must not re-email the same claim');
    assert.equal(sentEmails.length, 1, `expected 1 email total, got ${sentEmails.length}`);
  });

  test('a league whose blanket window expired stops being "due" once processed with nothing pending', async () => {
    // First pass: the expired window is legitimately due; processing finds no
    // pending claims and clears the window's leftovers.
    const firstPass = await waiver.processAllDueWaivers();
    assert.ok(
      firstPass.some((o) => o.leagueId === leagueId),
      'expired blanket window is processed on the first tick'
    );

    // Second pass, five minutes later in production: nothing changed, so the
    // league must not be listed again (every listing re-runs the email digest).
    const secondPass = await waiver.processAllDueWaivers();
    assert.ok(
      !secondPass.some((o) => o.leagueId === leagueId),
      'league with an already-expired, already-processed window must not be due on every tick'
    );
  });

  test('a still-open blanket window survives a manual processing run', async () => {
    // A commissioner may trigger processing while the post-draft window is
    // still open. The guard on `<= now()` is what keeps that window alive; the
    // fake-pool suites can only prove the statement was issued, not that the
    // guard bites, so it is proved here against the real clock.
    await pool.query(
      `UPDATE "leagues" SET "waivers_clear_at" = now() + interval '1 hour' WHERE "id" = $1`,
      [leagueId]
    );
    await waiver.processWaivers({ leagueId });
    const after = await pool.query(
      `SELECT "waivers_clear_at" FROM "leagues" WHERE "id" = $1`,
      [leagueId]
    );
    assert.ok(after.rows[0].waivers_clear_at, 'an open window is never spent early');
  });
}
