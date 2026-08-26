/**
 * Disposable-PostgreSQL coverage for discovery.service's SQL (#208): the
 * mocked unit suite (discovery.test.js) only regex-matches the query text,
 * so the correlated `ownerTeamName` subselect added by #181 -- a query that
 * also carries an outer LEFT JOIN "teams", a COUNT(DISTINCT ...) and a
 * GROUP BY -- has never actually run against a database. This exercises
 * `previewLeagueByInviteCode` and the shared Discover-card selector it reuses
 * (`discoverLeagues` / `selectLeagueCards`) for real, against a real schema.
 *
 * Fixture shape, one seed covering every scenario in the issue:
 *   - League A: owned by `alpha`, who holds a Team there ("Alpha A Team"),
 *     plus a second team owned by `beta` -- two teams, so the Discover card's
 *     COUNT(DISTINCT "teams"."id") has something to get wrong.
 *   - League B: owned by `noteam`, who holds NO team anywhere -- the null
 *     `ownerTeamName` case (a legacy or corrupted creator-less league).
 *   - League C: owned by the SAME `alpha` as League A, but with a
 *     DIFFERENT team name ("Alpha C Team"). The correlated subselect matches
 *     on league_id AND owner_id; matching on owner_id alone would leak
 *     League A's team name into League C's preview, which is exactly what
 *     this proves does not happen.
 *
 * Runs ONLY in the CI migration-smoke job (postgres:17 service, #371's
 * directory-wide `npm run test:pg`), gated twice: DISCOVERY_PG_TESTS=1 (or
 * PG_TESTS=1) must be set explicitly, and every DATABASE_URL* variable must
 * be ABSENT -- connections are built from PG* variables only, so a stray
 * local run can never touch the shared production database
 * (server/knexfile.js loads .env; this file deliberately does not).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ENABLED = process.env.PG_TESTS === '1' || process.env.DISCOVERY_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('discovery PG tests (skipped: set PG_TESTS=1 or DISCOVERY_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('discovery PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only see a disposable PG* database`);
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
  const { previewLeagueByInviteCode, discoverLeagues } = require('../services/discovery.service');

  let userIds = {};
  let leagueIds = {};
  let viewerId; // an id with no rows of its own; every "am I involved" column must read false/null for it

  test.before(async () => {
    await knex.migrate.latest();

    const users = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES
         ('pgd_alpha', 'pgd-alpha@example.invalid', 'x'),
         ('pgd_beta', 'pgd-beta@example.invalid', 'x'),
         ('pgd_noteam', 'pgd-noteam@example.invalid', 'x'),
         ('pgd_viewer', 'pgd-viewer@example.invalid', 'x')
       RETURNING "id", "username"`
    );
    const idByUsername = Object.fromEntries(users.rows.map((r) => [r.username, r.id]));
    userIds = {
      alpha: idByUsername.pgd_alpha,
      beta: idByUsername.pgd_beta,
      noteam: idByUsername.pgd_noteam,
    };
    viewerId = idByUsername.pgd_viewer;

    // All three leagues are public and joinable (fantasy, pre-draft) so the
    // Discover-card path lists them without needing joinability fixtures of
    // its own; that rule has its own coverage in leagueJoinability.test.js.
    const leagues = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "is_public")
       VALUES
         ('PG Discovery League A', $1, 'pgd0000a', true),
         ('PG Discovery League B', $2, 'pgd0000b', true),
         ('PG Discovery League C', $1, 'pgd0000c', true)
       RETURNING "id", "invite_code"`,
      [userIds.alpha, userIds.noteam]
    );
    const idByCode = Object.fromEntries(leagues.rows.map((r) => [r.invite_code, r.id]));
    leagueIds = { a: idByCode.pgd0000a, b: idByCode.pgd0000b, c: idByCode.pgd0000c };

    await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name")
       VALUES
         ($1, $2, 'Alpha A Team'),
         ($1, $3, 'Beta A Team'),
         ($4, $2, 'Alpha C Team')`,
      [leagueIds.a, userIds.alpha, userIds.beta, leagueIds.c]
      // League B intentionally gets no team row at all: `noteam` created it
      // but never joined it as a manager, so its creator holds no Team.
    );
  });

  test.after(async () => {
    const ids = Object.values(leagueIds).filter(Boolean);
    if (ids.length) await pool.query(`DELETE FROM "leagues" WHERE "id" = ANY($1::int[])`, [ids]);
    const uids = Object.values(userIds).filter(Boolean);
    if (uids.length) await pool.query(`DELETE FROM "users" WHERE "id" = ANY($1::int[])`, [[...uids, viewerId]]);
    await pool.end();
    await knex.destroy();
  });

  // -------------------------------------------------------------------
  // previewLeagueByInviteCode: the correlated ownerTeamName subselect
  // -------------------------------------------------------------------

  test('previewLeagueByInviteCode: returns the creator\'s Team name and exact team count', async () => {
    const preview = await previewLeagueByInviteCode({ code: 'pgd0000a', userId: viewerId });
    assert.ok(preview, 'league A is found by its invite code');
    assert.equal(preview.ownerTeamName, 'Alpha A Team');
    assert.equal(preview.teamCount, 2, 'both teams in the league are counted');
    assert.equal(preview.alreadyMember, false, 'the viewer holds no team here');
    assert.equal(preview.isPublic, true);
    assert.equal(preview.joinable, true);
    assert.equal(preview.joinReason, null);
  });

  test('previewLeagueByInviteCode: a creator with no Team anywhere answers null, not a fallback', async () => {
    const preview = await previewLeagueByInviteCode({ code: 'pgd0000b', userId: viewerId });
    assert.ok(preview, 'league B is found by its invite code');
    assert.equal(preview.ownerTeamName, null, 'the creator holds no team, so the subselect answers null');
    assert.equal(preview.teamCount, 0);
  });

  test('previewLeagueByInviteCode: the same creator\'s Team in a DIFFERENT league never leaks in', async () => {
    const preview = await previewLeagueByInviteCode({ code: 'pgd0000c', userId: viewerId });
    assert.ok(preview, 'league C is found by its invite code');
    // `alpha` owns both League A and League C, with a DIFFERENT team name in
    // each. Matching the correlated subselect on owner_id alone (dropping its
    // league_id leg) would answer 'Alpha A Team' here; the real query must not.
    assert.equal(preview.ownerTeamName, 'Alpha C Team');
    assert.notEqual(preview.ownerTeamName, 'Alpha A Team');
    assert.equal(preview.teamCount, 1);
  });

  test('previewLeagueByInviteCode: an unknown invite code answers null', async () => {
    const preview = await previewLeagueByInviteCode({ code: 'pgd0000z', userId: viewerId });
    assert.equal(preview, null);
  });

  test('previewLeagueByInviteCode: a member of the league sees alreadyMember true', async () => {
    const preview = await previewLeagueByInviteCode({ code: 'pgd0000a', userId: userIds.beta });
    assert.equal(preview.alreadyMember, true);
    // The card's own team count is unaffected by which team the caller is.
    assert.equal(preview.teamCount, 2);
    assert.equal(preview.ownerTeamName, 'Alpha A Team', 'still the CREATOR\'s team, not the caller\'s');
  });

  // -------------------------------------------------------------------
  // discoverLeagues / selectLeagueCards: the shared Discover-card query
  // -------------------------------------------------------------------

  test('discoverLeagues: team counts are exact and not multiplied by the pickem_settings/join_requests joins', async () => {
    const rows = await discoverLeagues({ userId: viewerId, search: 'PG Discovery League' });
    assert.equal(rows.length, 3, 'all three seeded leagues are public and joinable');

    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.equal(byId[leagueIds.a].teamCount, 2, 'League A really has exactly two teams, not four');
    assert.equal(byId[leagueIds.b].teamCount, 0, 'League B has no teams at all');
    assert.equal(byId[leagueIds.c].teamCount, 1, 'League C has exactly one team');

    // openSlots is derived from that same exact count against max_teams
    // (default 10), so a multiplied count would also show up here.
    assert.equal(byId[leagueIds.a].openSlots, true);
    assert.equal(byId[leagueIds.b].openSlots, true);
  });

  test('discoverLeagues: alreadyMember and myRequestStatus are per-caller, not per-league-total', async () => {
    const asBeta = await discoverLeagues({ userId: userIds.beta, search: 'PG Discovery League' });
    const byIdForBeta = Object.fromEntries(asBeta.map((r) => [r.id, r]));
    assert.equal(byIdForBeta[leagueIds.a].alreadyMember, true, 'beta holds a team in League A');
    // League B has no teams at all, so BOOL_OR aggregates zero boolean rows and
    // answers SQL NULL rather than false -- falsy either way to a caller, and
    // not a behavior this test exists to change (out of scope: the SQL itself).
    assert.ok(!byIdForBeta[leagueIds.b].alreadyMember, 'no teams exist in League B for anyone to already hold');
    assert.equal(byIdForBeta[leagueIds.c].alreadyMember, false, 'beta holds no team in League C');

    const asViewer = await discoverLeagues({ userId: viewerId, search: 'PG Discovery League' });
    const byIdForViewer = Object.fromEntries(asViewer.map((r) => [r.id, r]));
    assert.equal(byIdForViewer[leagueIds.a].alreadyMember, false, 'the viewer holds no team anywhere');
  });
}
