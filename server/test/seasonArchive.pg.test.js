/**
 * Disposable-PostgreSQL coverage for seasonArchive() (#1211): one read that
 * decides champions and outcome for every archived season, joining
 * league_history to leagues, teams, trophies (week 0 only) and
 * league_analytics (draft_grades) instead of the route looping a query per
 * season. Refuses DATABASE_URL* so it can never touch the shared database.
 *
 * seasonArchive.service.js requires the shared `server/modules/pool` module
 * directly (as every other service does), so this file does too rather than
 * opening a second connection: with DATABASE_URL* unset (enforced below),
 * that module falls back to the same PGHOST/PGPORT/PGDATABASE/PGUSER/
 * PGPASSWORD variables this file uses, so it is the same disposable
 * database.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.SEASON_ARCHIVE_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((key) => process.env[key]);

if (!ENABLED) {
  test('season archive PG tests (skipped: set PG_TESTS=1 or SEASON_ARCHIVE_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('season archive PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only see a disposable PG* database`);
  });
} else {
  const pool = require('../modules/pool');
  const { seasonArchive } = require('../services/seasonArchive.service');
  const { getLeagueTrophies } = require('../services/trophy.service');

  const FANTASY_SEASON_WITH_CHAMPION = 2081;
  const FANTASY_SEASON_NO_CHAMPION = 2082;
  const PICKEM_SEASON = 2083;

  let userId;
  let fantasyLeagueId;
  let pickemLeagueId;
  let champTeamId;
  let otherTeamId;
  let pickemTeamAId;
  let pickemTeamBId;

  test.before(async () => {
    const user = await pool.query(
      `INSERT INTO "users" ("username", "email", "password")
       VALUES ('season_archive_pg', 'season-archive-pg@example.invalid', 'x')
       RETURNING "id"`
    );
    userId = user.rows[0].id;

    const fantasyLeague = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "pickem_only")
       VALUES ('Season Archive Fantasy PG', $1, 'seasarchfpg', false) RETURNING "id"`,
      [userId]
    );
    fantasyLeagueId = fantasyLeague.rows[0].id;

    const pickemLeague = await pool.query(
      `INSERT INTO "leagues" ("name", "owner_id", "invite_code", "pickem_only")
       VALUES ('Season Archive Pickem PG', $1, 'seasarchppg', true) RETURNING "id"`,
      [userId]
    );
    pickemLeagueId = pickemLeague.rows[0].id;

    const champTeam = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Fantasy Champs') RETURNING "id"`,
      [fantasyLeagueId, userId]
    );
    champTeamId = champTeam.rows[0].id;
    const otherTeam = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Fantasy Runners-Up') RETURNING "id"`,
      [fantasyLeagueId, userId]
    );
    otherTeamId = otherTeam.rows[0].id;
    const pickemTeamA = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Pickem Aces') RETURNING "id"`,
      [pickemLeagueId, userId]
    );
    pickemTeamAId = pickemTeamA.rows[0].id;
    const pickemTeamB = await pool.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name") VALUES ($1, $2, 'Pickem Barons') RETURNING "id"`,
      [pickemLeagueId, userId]
    );
    pickemTeamBId = pickemTeamB.rows[0].id;

    await pool.query(
      `INSERT INTO "league_history" ("league_id", "season", "standings", "rosters", "awards", "champion_team_id")
       VALUES ($1, $2, $3, '[]', '[]', $4)`,
      [
        fantasyLeagueId,
        FANTASY_SEASON_WITH_CHAMPION,
        JSON.stringify([
          { teamId: champTeamId, name: 'Fantasy Champs', wins: 12, losses: 2, ties: 0, pf: 1500, pa: 1200, winPct: 0.857, streak: 'W3', rank: 1 },
          { teamId: otherTeamId, name: 'Fantasy Runners-Up', wins: 10, losses: 4, ties: 0, pf: 1400, pa: 1300, winPct: 0.714, streak: 'L1', rank: 2 },
        ]),
        champTeamId,
      ]
    );
    await pool.query(
      `INSERT INTO "league_history" ("league_id", "season", "standings", "rosters", "awards", "champion_team_id")
       VALUES ($1, $2, '[]', '[]', '[]', NULL)`,
      [fantasyLeagueId, FANTASY_SEASON_NO_CHAMPION]
    );
    await pool.query(
      `INSERT INTO "league_history" ("league_id", "season", "standings", "rosters", "awards", "pickem_result")
       VALUES ($1, $2, '[]', '[]', '[]', $3)`,
      [
        pickemLeagueId,
        PICKEM_SEASON,
        JSON.stringify({
          outcome: 'champions',
          mode: 'straight',
          champions: [
            { teamId: pickemTeamAId, teamName: 'Pickem Aces', avatarUrl: '/aces.png', avatarStaticUrl: null, points: 171, correct: 120, mode: 'straight' },
            { teamId: pickemTeamBId, teamName: 'Pickem Barons', avatarUrl: null, avatarStaticUrl: '/barons.png', points: 171, correct: 120, mode: 'straight' },
          ],
          provenance: { source: 'season_completion' },
          declaredAt: '2082-01-11T06:00:00.000Z',
        }),
      ]
    );

    // Two week-0 season trophies for the champion season (newest-first order
    // is the assertion below), a week!=0 trophy that must be filtered out,
    // and a week-0 trophy on the OTHER season that must not leak across
    // seasons.
    await pool.query(
      `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data", "awarded_at")
       VALUES ($1, $2, $3, 0, 'league_champion', 'League Champion', '{}', '2082-01-05T00:00:00Z')`,
      [fantasyLeagueId, champTeamId, FANTASY_SEASON_WITH_CHAMPION]
    );
    await pool.query(
      `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data", "awarded_at")
       VALUES ($1, $2, $3, 0, 'best_record', 'Best Record', '{}', '2082-01-06T00:00:00Z')`,
      [fantasyLeagueId, champTeamId, FANTASY_SEASON_WITH_CHAMPION]
    );
    await pool.query(
      `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data", "awarded_at")
       VALUES ($1, $2, $3, 7, 'weekly_high_score', 'Week 7 High Score', '{}', '2081-10-20T00:00:00Z')`,
      [fantasyLeagueId, champTeamId, FANTASY_SEASON_WITH_CHAMPION]
    );
    await pool.query(
      `INSERT INTO "trophies" ("league_id", "team_id", "season", "week", "type", "label", "data", "awarded_at")
       VALUES ($1, $2, $3, 0, 'league_champion', 'League Champion', '{}', '2081-01-05T00:00:00Z')`,
      [fantasyLeagueId, otherTeamId, FANTASY_SEASON_NO_CHAMPION - 1]
    );

    await pool.query(
      `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
       VALUES ($1, $2, 0, 'draft_grades', $3)`,
      [fantasyLeagueId, FANTASY_SEASON_WITH_CHAMPION, JSON.stringify({ grades: [{ teamId: champTeamId, name: 'Fantasy Champs', grade: 'A' }] })]
    );
  });

  test.after(async () => {
    if (fantasyLeagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [fantasyLeagueId]);
    if (pickemLeagueId) await pool.query('DELETE FROM "leagues" WHERE "id" = $1', [pickemLeagueId]);
    if (userId) await pool.query('DELETE FROM "users" WHERE "id" = $1', [userId]);
    await pool.end();
  });

  function countQueries() {
    const original = pool.query.bind(pool);
    let count = 0;
    pool.query = (...args) => {
      count += 1;
      return original(...args);
    };
    return {
      count: () => count,
      restore: () => { pool.query = original; },
    };
  }

  test('a fantasy League: one query decides champion/no_champion outcome and carries the frozen trophies and draft grades', async () => {
    const spy = countQueries();
    let seasons;
    try {
      seasons = await seasonArchive({ leagueId: fantasyLeagueId });
    } finally {
      spy.restore();
    }
    assert.equal(spy.count(), 1, 'seasonArchive must run exactly one query');

    const withChampion = seasons.find((s) => s.season === FANTASY_SEASON_WITH_CHAMPION);
    const noChampion = seasons.find((s) => s.season === FANTASY_SEASON_NO_CHAMPION);

    assert.equal(withChampion.outcome, 'champion');
    assert.deepEqual(withChampion.champions, [
      { teamId: champTeamId, name: 'Fantasy Champs', avatarUrl: null, avatarStaticUrl: null },
    ]);
    assert.equal(noChampion.outcome, 'no_champion');
    assert.deepEqual(noChampion.champions, []);

    // Must-not-change trophy shape: trophies row columns + team_name, week 0
    // only, newest awarded_at first — identical to a direct getLeagueTrophies
    // call. Both sides go through node-pg's normal timestamptz -> Date
    // parsing (array_agg over typed columns, never json_agg), so they are
    // directly deep-equal with no reformatting on either side.
    const directTrophies = (await getLeagueTrophies({ leagueId: fantasyLeagueId, season: FANTASY_SEASON_WITH_CHAMPION }))
      .filter((t) => t.week === 0);
    assert.deepEqual(withChampion.trophies, directTrophies);
    assert.equal(withChampion.trophies.length, 2, 'the week-7 trophy is filtered out');
    assert.deepEqual(withChampion.trophies.map((t) => t.type), ['best_record', 'league_champion'], 'newest awarded_at first');
    assert.ok(withChampion.trophies[0].awarded_at instanceof Date);

    assert.deepEqual(noChampion.trophies, [], 'a season with no trophies gets [], not null, and nothing leaks in from another season');

    // draftGrades is `data -> 'grades'` (the array itself), matching what the
    // pre-ticket route served (`gradesResult.rows[0].data.grades`) and what
    // LeagueHistory.jsx's `Array.isArray(season.draftGrades)` expects - not
    // the `{ grades: [...] }` wrapper `league_analytics.data` stores.
    assert.deepEqual(withChampion.draftGrades, [{ teamId: champTeamId, name: 'Fantasy Champs', grade: 'A' }]);
    assert.equal(noChampion.draftGrades, null);
  });

  test("a pick'em League: co-champions and outcome come from the declared pickem_result, one query", async () => {
    const spy = countQueries();
    let seasons;
    try {
      seasons = await seasonArchive({ leagueId: pickemLeagueId });
    } finally {
      spy.restore();
    }
    assert.equal(spy.count(), 1, 'seasonArchive must run exactly one query');

    assert.equal(seasons.length, 1);
    const [season] = seasons;
    assert.equal(season.season, PICKEM_SEASON);
    assert.equal(season.outcome, 'champions');
    assert.deepEqual(season.champions, [
      { teamId: pickemTeamAId, name: 'Pickem Aces', avatarUrl: '/aces.png', avatarStaticUrl: null },
      { teamId: pickemTeamBId, name: 'Pickem Barons', avatarUrl: null, avatarStaticUrl: '/barons.png' },
    ]);
    assert.deepEqual(season.trophies, []);
    assert.equal(season.draftGrades, null);
  });
}
