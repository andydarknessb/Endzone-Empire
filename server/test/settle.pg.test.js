/**
 * Disposable-Postgres test for the Settle module (ADR 0070, spec #2681, ticket #2693).
 *
 * One case per outcome of the three entry points: settleWeek (Advance week's Settle
 * pass), correctWeek (a Stat correction) and rescoreLive (the Commissioner's live
 * re-score). Each entry point is one League write, so the League row is locked first
 * and the announcement, the lineup seed and the follow-up run only after the commit.
 * The two-connection case shows a Stat correction waits for a League write another
 * connection holds, with no deadlock. A fake pool cannot show that; only two real
 * connections can.
 *
 * shortcut: the announcement and the Settle follow-up are stubbed (they reach the
 * draft-room broadcast and the analytics writers), so each case asserts the call
 * and its order, not what the stubs would have written. Upgrade when those steps
 * have their own disposable-Postgres coverage.
 *
 * Red-tell: a caller that scores or finalizes on an unlocked read, or a rescore that
 * refuses a final week before the League lock, turns the two-connection case red
 * (it no longer waits) or the final-week case red (the refusal is not 409).
 *
 * Runs ONLY where a disposable Postgres is available, gated twice: PG_TESTS=1 (or
 * SETTLE_PG_TESTS=1) must be exactly '1', and every DATABASE_URL* variable must be
 * ABSENT, so a stray local run never touches the shared production database. Mirrors
 * leagueLockMode.pg.test.js. CI's migration-smoke job runs it through
 * scripts/run-pg-tests.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.SETTLE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);
// The target must be a named, loopback database: never a remote host, never the default name.
const PG_HOST = process.env.PGHOST || '127.0.0.1';
const badTarget = !['127.0.0.1', 'localhost', '::1'].includes(PG_HOST)
  ? `PGHOST=${PG_HOST} is not loopback`
  : (!process.env.PGDATABASE ? 'PGDATABASE is unset' : null);

if (!ENABLED) {
  test('settle PG test (skipped: set PG_TESTS=1 or SETTLE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('settle PG test refuses to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else if (badTarget) {
  test('settle PG test refuses a target that is not a named loopback database', () => {
    assert.fail(`${badTarget} - these tests must only ever see a disposable loopback PG* database`);
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
  // The fixtures and the holder connection; the code under test uses server/modules/pool.
  const pool = new pg.Pool({ ...connection, max: 4 });
  const modulePool = require('../modules/pool');
  const settle = require('../services/settle.service');
  const matchupScoring = require('../services/matchupScoring.service');
  const settleFollowUpSvc = require('../services/settleFollowUp.service');

  // Arbitrary seasons and invite codes: no other *.pg.test.js seeds these.
  const FIRST_SEASON = 2301;
  let nextSeason = FIRST_SEASON;
  let codeSeq = 0;
  let ownerId = null;
  let playerId = null;
  const leagueIds = [];

  test.before(async () => {
    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('settle_pg_owner', 'settle-pg-owner@example.invalid', 'x')
       RETURNING "id"`
    );
    ownerId = users.rows[0].id;
    const players = await pool.query(
      `INSERT INTO "players" ("name", "position", "nfl_team")
       VALUES ('Settle PG Player', 'RB', 'STL') RETURNING "id"`
    );
    playerId = players.rows[0].id;
  });

  test.after(async () => {
    if (leagueIds.length) {
      await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [leagueIds]);
    }
    // The players table is global; the league CASCADE does not reach it.
    if (playerId != null) await pool.query(`DELETE FROM "players" WHERE "id" = $1`, [playerId]);
    if (ownerId != null) await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [ownerId]);
    await pool.end();
    await modulePool.end();
  });

  /**
   * One League in its regular season, `week` current, two Teams. The home Team
   * rosters the shared player. Matchups: `week` (scored by the case, stored at
   * homeScore/awayScore, final as given) and an open matchup for `week + 1`.
   */
  async function seedLeague({ week = 1, final = false, homeScore = 999, awayScore = 999, draftStatus = 'complete' } = {}) {
    const season = nextSeason++;
    codeSeq += 1;
    const league = await pool.query(
      `INSERT INTO "leagues"
         ("name", "owner_id", "invite_code", "current_season", "current_week",
          "roster_limit", "ir_slots", "waiver_period_hours", "draft_status",
          "season_status", "regular_season_weeks")
       VALUES ('PG Settle League', $1, $2, $3, $4, 10, 0, 24, $5, 'regular', 14)
       RETURNING "id"`,
      [ownerId, `stl${String(codeSeq).padStart(3, '0')}`, season, week, draftStatus]
    );
    const leagueId = league.rows[0].id;
    leagueIds.push(leagueId);

    const homeTeam = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Settle Home') RETURNING "id"`,
      [leagueId, ownerId]
    );
    const awayTeam = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES ($1, $2, 'Settle Away') RETURNING "id"`,
      [leagueId, ownerId]
    );
    const homeId = homeTeam.rows[0].id;
    const awayId = awayTeam.rows[0].id;
    await pool.query(
      `INSERT INTO "team_players" ("league_id", "team_id", "player_id") VALUES ($1, $2, $3)`,
      [leagueId, homeId, playerId]
    );

    const scored = await pool.query(
      `INSERT INTO "matchups"
         ("league_id", "season", "week", "home_team_id", "away_team_id",
          "home_score", "away_score", "final", "is_playoff")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
       RETURNING "id"`,
      [leagueId, season, week, homeId, awayId, homeScore, awayScore, final]
    );
    await pool.query(
      `INSERT INTO "matchups"
         ("league_id", "season", "week", "home_team_id", "away_team_id",
          "home_score", "away_score", "final", "is_playoff")
       VALUES ($1, $2, $3, $4, $5, 0, 0, false, false)`,
      [leagueId, season, week + 1, homeId, awayId]
    );
    return { leagueId, season, homeId, awayId, matchupId: scored.rows[0].id };
  }

  async function matchupOf(matchupId) {
    const { rows } = await pool.query(
      `SELECT "home_score", "away_score", "final" FROM "matchups" WHERE "id" = $1`,
      [matchupId]
    );
    return rows[0];
  }

  async function countRows(sql, params) {
    const { rows } = await pool.query(sql, params);
    return rows[0].n;
  }

  // The announcement and the Settle follow-up are stubbed: each case asserts the call
  // and its order. settle reads both through the module objects at call time, so the
  // stubs take.
  function stubAfterCommit(t, { announce = async () => {} } = {}) {
    const announceMock = t.mock.method(matchupScoring, 'announceScored', announce);
    const followUpMock = t.mock.method(settleFollowUpSvc, 'settleFollowUp', async () => {});
    return { announceMock, followUpMock };
  }

  // Wait until a backend is blocked on a lock, so the next step runs once the write has reached its lock.
  async function waitForBlocked() {
    const deadline = Date.now() + 10000;
    for (;;) {
      const n = await countRows(
        `SELECT COUNT(*)::int AS n FROM "pg_stat_activity"
          WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'`,
        []
      );
      if (n >= 1) return;
      if (Date.now() > deadline) throw new Error('timed out waiting for a blocked backend');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  // ---- settleWeek: Advance week's Settle pass ----

  test('an Advance scores the week as played, finalizes it and seeds next week lineups', async (t) => {
    const lg = await seedLeague();
    const { announceMock, followUpMock } = stubAfterCommit(t);

    const result = await settle.settleWeek({ leagueId: lg.leagueId, expectedWeek: 1 });

    assert.equal(result.advance.advancedTo, 2);
    assert.equal(result.advance.seasonStatus, 'regular');
    assert.ok(result.scored, 'the week is scored');
    const week = await matchupOf(lg.matchupId);
    assert.equal(week.final, true, 'the week is finalized');
    assert.notEqual(Number(week.home_score), 999, 'the stored score is replaced by the score of record');
    assert.equal(
      await countRows(
        `SELECT COUNT(*)::int AS n FROM "lineup_entries" WHERE "league_id" = $1 AND "week" = 2`,
        [lg.leagueId]
      ) >= 1,
      true,
      'next week lineups are seeded'
    );
    assert.equal(announceMock.mock.calls.length, 1, 'the scores are announced once');
    await result.followUp;
    assert.equal(followUpMock.mock.calls.length, 1);
    assert.equal(followUpMock.mock.calls[0].arguments[0].mode, 'advance');
  });

  test('an Advance is refused for an unfinished draft, before anything is scored', async (t) => {
    const lg = await seedLeague({ draftStatus: 'active' });
    const { announceMock, followUpMock } = stubAfterCommit(t);

    await assert.rejects(
      settle.settleWeek({ leagueId: lg.leagueId, expectedWeek: 1 }),
      (error) => error.statusCode === 409
    );
    const week = await matchupOf(lg.matchupId);
    assert.equal(week.final, false, 'the week is not finalized');
    assert.equal(Number(week.home_score), 999, 'nothing is scored');
    assert.equal(announceMock.mock.calls.length, 0);
    assert.equal(followUpMock.mock.calls.length, 0);
  });

  test('an Advance is refused for a stale expected week, with nothing scored', async (t) => {
    const lg = await seedLeague({ week: 2 });
    const { announceMock, followUpMock } = stubAfterCommit(t);

    await assert.rejects(
      settle.settleWeek({ leagueId: lg.leagueId, expectedWeek: 1 }),
      (error) => error.statusCode === 409 && /already advanced/.test(error.message)
    );
    const week = await matchupOf(lg.matchupId);
    assert.equal(week.final, false, 'the stale week is not finalized');
    assert.equal(Number(week.home_score), 999, 'nothing is scored');
    assert.equal(announceMock.mock.calls.length, 0);
    assert.equal(followUpMock.mock.calls.length, 0);
  });

  test('an Advance without a week refuses a replay that read the week before the first Advance committed', async (t) => {
    const lg = await seedLeague();
    stubAfterCommit(t);
    const holder = await pool.connect();
    try {
      // The holder stands in for the first Advance's League write: it moves current_week on
      // and holds the League lock until COMMIT.
      await holder.query('BEGIN');
      await holder.query('SELECT * FROM "leagues" WHERE "id" = $1 FOR NO KEY UPDATE', [lg.leagueId]);
      await holder.query('UPDATE "leagues" SET "current_week" = 2 WHERE "id" = $1', [lg.leagueId]);

      // The replay's pre-lock read sees the committed week 1, then waits on the lock.
      const pending = settle.settleWeek({ leagueId: lg.leagueId }).then(() => null, (error) => error);
      await waitForBlocked();
      await holder.query('COMMIT');

      const error = await pending;
      assert.equal(error && error.statusCode, 409, 'the replay is refused under the lock');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
    const week = await matchupOf(lg.matchupId);
    assert.equal(week.final, false, 'nothing is finalized');
    assert.equal(Number(week.home_score), 999, 'nothing is scored');
  });

  test('an Advance whose announcement throws still seeds lineups and starts the follow-up', async (t) => {
    const lg = await seedLeague();
    const { followUpMock } = stubAfterCommit(t, {
      announce: async () => { throw new Error('announcement failed'); },
    });

    const result = await settle.settleWeek({ leagueId: lg.leagueId, expectedWeek: 1 });

    assert.equal(result.advance.advancedTo, 2, 'the call resolves');
    assert.equal(
      await countRows(
        `SELECT COUNT(*)::int AS n FROM "lineup_entries" WHERE "league_id" = $1 AND "week" = 2`,
        [lg.leagueId]
      ) >= 1,
      true,
      'the lineup seed still ran'
    );
    await result.followUp;
    assert.equal(followUpMock.mock.calls.length, 1, 'the follow-up still started');
  });

  // ---- correctWeek: a Stat correction ----

  test('a Stat correction that changes a final week logs it and starts the follow-up', async (t) => {
    const lg = await seedLeague({ final: true });
    const { announceMock, followUpMock } = stubAfterCommit(t);

    const outcome = await settle.correctWeek({ leagueId: lg.leagueId, season: lg.season, week: 1 });

    assert.equal(outcome.changes.length, 1, 'the score change is reported');
    assert.equal(
      await countRows(
        `SELECT COUNT(*)::int AS n FROM "transactions" WHERE "league_id" = $1 AND "type" = 'stat_correction'`,
        [lg.leagueId]
      ),
      1,
      'the change is logged'
    );
    assert.equal(announceMock.mock.calls.length, 1);
    assert.equal(followUpMock.mock.calls.length, 1);
    assert.equal(followUpMock.mock.calls[0].arguments[0].mode, 'correction');
  });

  test('a Stat correction that changes nothing logs nothing and starts no follow-up', async (t) => {
    const lg = await seedLeague({ final: true, homeScore: 0, awayScore: 0 });
    const { followUpMock } = stubAfterCommit(t);

    const outcome = await settle.correctWeek({ leagueId: lg.leagueId, season: lg.season, week: 1 });

    assert.equal(outcome.changes.length, 0);
    assert.equal(
      await countRows(
        `SELECT COUNT(*)::int AS n FROM "transactions" WHERE "league_id" = $1 AND "type" = 'stat_correction'`,
        [lg.leagueId]
      ),
      0,
      'no change is logged'
    );
    assert.equal(followUpMock.mock.calls.length, 0);
  });

  test('a Stat correction whose announcement throws still resolves and starts the follow-up', async (t) => {
    const lg = await seedLeague({ final: true });
    const { followUpMock } = stubAfterCommit(t, {
      announce: async () => { throw new Error('announcement failed'); },
    });

    const outcome = await settle.correctWeek({ leagueId: lg.leagueId, season: lg.season, week: 1 });

    assert.equal(outcome.changes.length, 1, 'the call resolves with the change');
    assert.equal(followUpMock.mock.calls.length, 1, 'the follow-up still started');
    assert.equal(followUpMock.mock.calls[0].arguments[0].mode, 'correction');
  });

  test('a Stat correction waits for a League write another connection holds, with no deadlock', async (t) => {
    const lg = await seedLeague({ final: true });
    stubAfterCommit(t);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT * FROM "leagues" WHERE "id" = $1 FOR NO KEY UPDATE', [lg.leagueId]);

      let finished = false;
      const pending = settle.correctWeek({ leagueId: lg.leagueId, season: lg.season, week: 1 })
        .then((outcome) => { finished = true; return outcome; });
      await waitForBlocked();
      assert.equal(finished, false, 'the correction waits while the holder keeps the League row');

      await holder.query('COMMIT');
      const outcome = await pending;
      assert.equal(outcome.changes.length, 1, 'the correction completes once the holder commits');
    } finally {
      await holder.query('ROLLBACK').catch(() => {});
      holder.release();
    }
  });

  // ---- rescoreLive: the Commissioner's live re-score ----

  test('a live re-score of an open week scores it and leaves it open', async (t) => {
    const lg = await seedLeague({ final: false });
    const { announceMock } = stubAfterCommit(t);

    const result = await settle.rescoreLive({ leagueId: lg.leagueId, season: lg.season, week: 1 });

    assert.ok(result.scored, 'the week is re-scored');
    const week = await matchupOf(lg.matchupId);
    assert.equal(week.final, false, 'the week stays open');
    assert.notEqual(Number(week.home_score), 999, 'the stored score is replaced');
    assert.equal(announceMock.mock.calls.length, 1);
  });

  test('a live re-score of a final week is refused with 409 and writes nothing', async (t) => {
    const lg = await seedLeague({ final: true });
    const { announceMock } = stubAfterCommit(t);

    await assert.rejects(
      settle.rescoreLive({ leagueId: lg.leagueId, season: lg.season, week: 1 }),
      (error) => error.statusCode === 409 && /is final/.test(error.message)
    );
    const week = await matchupOf(lg.matchupId);
    assert.equal(Number(week.home_score), 999, 'the final score is untouched');
    assert.equal(announceMock.mock.calls.length, 0);
  });

  test('a live re-score whose announcement throws still resolves with the score', async (t) => {
    const lg = await seedLeague({ final: false });
    stubAfterCommit(t, { announce: async () => { throw new Error('announcement failed'); } });

    const result = await settle.rescoreLive({ leagueId: lg.leagueId, season: lg.season, week: 1 });

    assert.ok(result.scored, 'the call resolves with the score');
    const week = await matchupOf(lg.matchupId);
    assert.notEqual(Number(week.home_score), 999, 'the score is committed');
  });
}
