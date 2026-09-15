const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const trophySvc = require('../services/trophy.service');

// ---- #1453: awardWeeklyTrophies takes the same advisory lock the
// post-correction reconcile writes under -------------------------------
//
// reconcileWeeklyHighScoreTrophy (#1411) opens its own transaction and takes
// lockTwoKeyXact(client, leagueId, season*100+week) as its FIRST statement,
// before it reads matchups and rewrites the top_scorer row. awardWeeklyTrophies
// took no lock at all: an advance-week award that read the pre-correction
// scores could still insert its holder after a concurrent reconcile deleted
// that row, since the unique key (league_id, season, week, team_id, type)
// does not stop a second team holding the same week. The fix (formal-002
// ruling on #1453) is to take the same lock, same helper, same key
// expression, as the first statement inside awardWeeklyTrophies' own
// withTransaction callback - before the matchups SELECT, not merely before
// the INSERT, so the award reads the week's scores under the same lock the
// reconcile writes under.

function awardWorld({ leagueId, homeScore, awayScore, homeTeamId = 10, awayTeamId = 20 }) {
  return createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({
      rows: [{ id: leagueId, draft_status: 'complete', season_status: 'in_season', regular_season_weeks: 14 }],
    })],
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [] })],
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2 AND "week" = \$3 AND "final" = true/, () => ({
      rows: [{ id: 1, home_team_id: homeTeamId, away_team_id: awayTeamId, home_score: homeScore, away_score: awayScore }],
    })],
    [/^INSERT INTO "trophies"/, () => ({ rows: [{ id: 1 }] })],
    [/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: [{ owner_id: 1000 + Number(params[0]) }],
    })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

test('#1453: awardWeeklyTrophies takes the trophy advisory lock before reading matchups or inserting the trophy', async (t) => {
  const leagueId = 7;
  const season = 2026;
  const week = 5;
  const fake = awardWorld({ leagueId, homeScore: 100, awayScore: 80 });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId, season, week });

  const lockCalls = fake.matching(/pg_advisory_xact_lock/);
  assert.equal(lockCalls.length, 1, 'exactly one advisory lock call');
  assert.deepEqual(lockCalls[0].params, [leagueId, (season * 100) + week]);

  const lockIdx = fake.calls.indexOf(lockCalls[0]);
  const matchupsIdx = fake.calls.findIndex((c) => /FROM "matchups"/.test(c.text));
  const insertTrophyIdx = fake.calls.findIndex(
    (c) => /^INSERT INTO "trophies"/.test(c.text) && c.params[4] === 'top_scorer'
  );

  assert.ok(matchupsIdx >= 0, 'the matchups read happened');
  assert.ok(insertTrophyIdx >= 0, 'the top_scorer trophy was inserted');
  assert.ok(lockIdx < matchupsIdx, 'the lock is taken before the matchups SELECT');
  assert.ok(lockIdx < insertTrophyIdx, 'the lock is taken before the trophy INSERT');

  fake.assertClean();
});
