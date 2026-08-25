const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const commissioner = require('../services/commissioner.service');

/**
 * SQL-substring dispatch over a mocked transaction client (the harness used
 * by pickem.service.test.js), recording every statement.
 */
function mockClient(t, handlers) {
  const calls = [];
  const dispatch = (via) => async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ via, text, params });
    for (const [pattern, handler] of handlers) {
      if (pattern.test(text)) return handler(text, params);
    }
    throw new Error(`unexpected query: ${text}`);
  };
  // Pool reads and transaction-client statements are tagged separately so a
  // test can see which side of the transaction boundary a read happened on.
  t.mock.method(pool, 'query', dispatch('pool'));
  t.mock.method(pool, 'connect', async () => ({ query: dispatch('client'), release: () => {} }));
  return calls;
}

const TXN = [
  [/^BEGIN$/, () => ({ rows: [] })],
  [/^COMMIT$/, () => ({ rows: [] })],
  [/^ROLLBACK$/, () => ({ rows: [] })],
];

const statementsMatching = (calls, pattern) => calls.filter((c) => pattern.test(c.text));

test("rolloverSeason archives every declared Pick'em co-champion without consulting trophy authority", async (t) => {
  const league = {
    id: 5, owner_id: 100, is_commissioner: true, pickem_only: true,
    season_status: 'complete', current_season: 2026, current_week: 18, faab_budget: 100,
  };
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league] })],
    [/SELECT "id", "name", "owner_id" FROM "teams" WHERE "league_id"/, () => ({
      rows: [
        { id: 10, name: 'Sunday Ballers', owner_id: 100 },
        { id: 11, name: 'Bob Squad', owner_id: 101 },
      ],
    })],
    // pick'em standings inputs (pickem.service.getStandings on this client)
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    [/"owner_id" AS "user_id"/, () => ({
      rows: [
        { user_id: 100, team_id: 100, team_name: 'Sunday Ballers', avatar_url: null, avatar_static_url: null },
        { user_id: 101, team_id: 101, team_name: 'Bob Squad', avatar_url: null, avatar_static_url: null },
      ],
    })],
    [/FROM "pickem_picks" WHERE "league_id" = \$1 AND "season" = \$2$/, () => ({
      rows: [
        { user_id: 100, week: 18, team_pair: 'BUF|MIA', picked_team: 'MIA', confidence: null },
        { user_id: 101, week: 18, team_pair: 'BUF|MIA', picked_team: 'BUF', confidence: null },
      ],
    })],
    [/FROM "nfl_games"/, () => ({
      rows: [
        { week: 18, nfl_team: 'BUF', opponent: 'MIA', kickoff_at: '2027-01-10T18:00:00.000Z' },
        { week: 18, nfl_team: 'MIA', opponent: 'BUF', kickoff_at: '2027-01-10T18:00:00.000Z' },
      ],
    })],
    [/FROM "live_game_states"/, () => ({
      rows: [{ week: 18, tank01_game_id: 'a', home_team: 'BUF', away_team: 'MIA', game_status: 'final', current_score_home: 24, current_score_away: 17, quarter: null, time_remaining: null }],
    })],
    [/FROM "private"\."game_recaps"/, () => ({ rows: [] })],
    // Completion declared a tie between a current Team and a historical Team
    // that has since been removed. A later recap now puts Bob first, but
    // neither standings nor the surviving trophy may redefine the result.
    [/FROM "pickem_season_results"/, () => ({
      rows: [{
        league_id: 5,
        season: 2026,
        outcome: 'champions',
        scoring_mode: 'straight',
        champions: [
          { teamId: 10, teamName: 'Sunday Ballers', avatarUrl: null, avatarStaticUrl: null, points: 171, correct: 120, mode: 'straight' },
          { teamId: 99, teamName: 'Gridiron Ghosts', avatarUrl: '/ghost.png', avatarStaticUrl: null, points: 171, correct: 120, mode: 'straight' },
        ],
        provenance: { source: 'season_completion' },
        declared_at: '2027-01-11T06:00:00.000Z',
      }],
    })],
    // the awards snapshot: the pickem_champion row completion already wrote
    [/SELECT "team_id", "season", "week", "type", "label", "data", "awarded_at" FROM "trophies"/, () => ({
      rows: [{ team_id: 10, season: 2026, week: 0, type: 'pickem_champion', label: "2026 Pick'em Champion", data: {}, awarded_at: 'x' }],
    })],
    [/INSERT INTO "league_history"/, () => ({ rows: [] })],
    // ADR 0002: roster-shaped writes against a pick'em-only league are bugs.
    [/DELETE FROM "team_players"|DELETE FROM "draft_picks"|DELETE FROM "waiver_players"|UPDATE "waiver_claims"|UPDATE "trades"|UPDATE "teams" SET "faab_remaining"/,
      (text) => { throw new Error(`roster-shaped write against a pick'em-only league: ${text}`); }],
    [/UPDATE "leagues" SET "current_season"/, () => ({ rows: [] })],
    [/INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 100 }, { owner_id: 101 }] })],
    [/INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);

  const result = await commissioner.rolloverSeason({ leagueId: 5, userId: 100 });

  // The deprecated singular pointers retain the first declaration-ordered
  // current Team without pretending the historical co-champion disappeared.
  assert.equal(result.championTeamId, 10);
  assert.equal(result.championUserId, 100);
  assert.equal(result.newSeason, 2027);

  const history = statementsMatching(calls, /INSERT INTO "league_history"/)[0];
  assert.deepEqual(history.params.slice(0, 4), [5, 2026, 10, 100]);
  // The standings snapshot is the pick'em table as it stands at rollover, built
  // from Team identity plus the scoring totals only. It never freezes an
  // account identifier: the archive is served to every member, so a manager's
  // userId/username must not ride into it (#342, #115). The read side keys and
  // names rows by teamId/name; the LEFT-join "Former manager" rendering applies
  // when a Team is later removed.
  const standings = JSON.parse(history.params[4]);
  const ARCHIVED_STANDINGS_KEYS = [
    'teamId', 'name',
    'points', 'correct', 'incorrect', 'pushes', 'pending', 'made', 'weekly', 'rank',
  ].sort();
  for (const row of standings) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ARCHIVED_STANDINGS_KEYS,
      'archived row is Team identity + scoring totals, nothing more'
    );
    for (const forbidden of ['userId', 'username', 'user_id', 'email', 'owner_id', 'teamName', 'avatarUrl', 'avatarStaticUrl']) {
      assert.equal(forbidden in row, false, `archived standings row must not carry ${forbidden}`);
    }
  }
  assert.deepEqual(
    standings.map((row) => [row.points, row.correct, row.rank, row.teamId, row.name]),
    [[1, 1, 1, 11, 'Bob Squad'], [0, 0, 2, 10, 'Sunday Ballers']]
  );
  assert.equal(history.params[5], '[]', 'rosters snapshot is empty for a pick\'em-only league');
  assert.equal(JSON.parse(history.params[6])[0].type, 'pickem_champion');
  assert.deepEqual(JSON.parse(history.params[7]).champions.map((row) => row.teamId), [10, 99]);
  // The season slate (whose recap probe swallows a missing-table error, which
  // would poison an open transaction) is read on the pool, not the client.
  const slateReads = calls.filter((c) => /FROM "nfl_games"|FROM "live_game_states"|game_recaps/.test(c.text));
  assert.ok(slateReads.length >= 3);
  assert.ok(slateReads.every((c) => c.via === 'pool'), 'slate reads stay outside the transaction');

  // No fantasy matchup read, and the singular fantasy champion trophy is
  // neither deleted nor inserted: the pickem_champion rows are the record.
  assert.equal(statementsMatching(calls, /FROM "matchups"/).length, 0);
  assert.equal(statementsMatching(calls, /SELECT "team_players"\."team_id"/).length, 0, 'no roster snapshot read');
  assert.equal(statementsMatching(calls, /DELETE FROM "trophies"/).length, 0);
  assert.equal(statementsMatching(calls, /INSERT INTO "trophies"/).length, 0);
  assert.equal(
    statementsMatching(calls, /SELECT "team_id" FROM "trophies"/).length,
    0,
    'rollover never reads trophy recipients as championship authority'
  );

  const reset = statementsMatching(calls, /UPDATE "leagues" SET "current_season"/)[0];
  assert.deepEqual(reset.params, [2027, 5]);
  assert.match(reset.text, /"current_week" = 1, "season_status" = 'regular'/);
  assert.ok(statementsMatching(calls, /INSERT INTO "transactions"/)[0], 'the rollover is still logged');
  const notice = statementsMatching(calls, /INSERT INTO "notifications"/)[0];
  assert.equal(notice.via, 'client');
  assert.equal(notice.params[3], "A new season has begun! Pick'em opens with the new NFL schedule.");
  assert.equal(statementsMatching(calls, /^COMMIT$/).length, 1);
});

test("rolloverSeason refuses a missing Pick'em result before deriving or mutating anything", async (t) => {
  const league = {
    id: 5, owner_id: 100, is_commissioner: true, pickem_only: true,
    season_status: 'complete', current_season: 2026, current_week: 18, faab_budget: 100,
  };
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league] })],
    [/FROM "pickem_season_results"/, () => ({ rows: [] })],
  ]);

  await assert.rejects(
    () => commissioner.rolloverSeason({ leagueId: 5, userId: 100 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'PICKEM_SEASON_RESULT_MISSING');
      assert.equal(error.leagueId, 5);
      assert.equal(error.season, 2026);
      assert.equal(Object.hasOwn(error, 'candidate'), false);
      return true;
    }
  );
  assert.equal(statementsMatching(calls, /FROM "teams"|FROM "pickem_settings"|FROM "trophies"/).length, 0);
  assert.equal(statementsMatching(calls, /INSERT INTO "league_history"|UPDATE "leagues" SET "current_season"/).length, 0);
  assert.equal(statementsMatching(calls, /^ROLLBACK$/).length, 1);
});

test("rolloverSeason archives an explicit Pick'em no-champion result", async (t) => {
  const league = {
    id: 5, owner_id: 100, is_commissioner: true, pickem_only: true,
    season_status: 'complete', current_season: 2026, current_week: 18, faab_budget: 100,
  };
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league] })],
    [/FROM "pickem_season_results"/, () => ({ rows: [{
      league_id: 5,
      season: 2026,
      outcome: 'no_champion',
      scoring_mode: 'straight',
      champions: [],
      provenance: { source: 'season_completion' },
      declared_at: '2027-01-11T06:00:00.000Z',
    }] })],
    [/SELECT "id", "name", "owner_id" FROM "teams" WHERE "league_id"/, () => ({
      rows: [{ id: 10, name: 'Sunday Ballers', owner_id: 100 }],
    })],
    [/FROM "pickem_settings"/, () => ({ rows: [{ enabled: true, mode: 'straight' }] })],
    [/"owner_id" AS "user_id"/, () => ({
      rows: [{ user_id: 100, team_id: 100, team_name: 'Sunday Ballers', avatar_url: null, avatar_static_url: null }],
    })],
    [/FROM "pickem_picks" WHERE "league_id" = \$1 AND "season" = \$2$/, () => ({ rows: [] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/FROM "live_game_states"/, () => ({ rows: [] })],
    [/FROM "private"\."game_recaps"/, () => ({ rows: [] })],
    [/SELECT "team_id", "season", "week", "type", "label", "data", "awarded_at" FROM "trophies"/, () => ({ rows: [] })],
    [/INSERT INTO "league_history"/, () => ({ rows: [] })],
    [/UPDATE "leagues" SET "current_season"/, () => ({ rows: [] })],
    [/INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 100 }] })],
    [/INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);

  const result = await commissioner.rolloverSeason({ leagueId: 5, userId: 100 });

  assert.equal(result.championTeamId, null);
  assert.equal(result.championUserId, null);
  const history = statementsMatching(calls, /INSERT INTO "league_history"/)[0];
  assert.deepEqual(JSON.parse(history.params[7]), {
    leagueId: 5,
    season: 2026,
    outcome: 'no_champion',
    mode: 'straight',
    champions: [],
    provenance: { source: 'season_completion' },
    declaredAt: '2027-01-11T06:00:00.000Z',
  });
});

test("rolloverSeason refuses keepers for a pick'em-only league before touching anything", async (t) => {
  const league = {
    id: 5, owner_id: 100, is_commissioner: true, pickem_only: true,
    season_status: 'complete', current_season: 2026, current_week: 18, faab_budget: 100,
  };
  const calls = mockClient(t, [
    ...TXN,
    [/FROM "leagues" WHERE "id" = \$1 FOR UPDATE/, () => ({ rows: [league] })],
  ]);
  await assert.rejects(
    () => commissioner.rolloverSeason({ leagueId: 5, userId: 100, keepers: [{ teamId: 10, playerIds: [1] }] }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.match(error.message, /pick'em league/);
      return true;
    }
  );
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
  assert.equal(statementsMatching(calls, /INSERT INTO "league_history"/).length, 0);
});
