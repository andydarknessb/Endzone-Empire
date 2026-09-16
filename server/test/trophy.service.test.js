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

function awardWorld({
  leagueId, homeScore, awayScore, homeTeamId = 10, awayTeamId = 20, existingTrophies = [],
}) {
  return createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({
      rows: [{ id: leagueId, draft_status: 'complete', season_status: 'in_season', regular_season_weeks: 14 }],
    })],
    // Scoped to 'client' only: a lock issued on the ambient pool instead of
    // the transaction client would land outside the transaction (and, behind
    // a transaction pooler, possibly on a different backend - the #839
    // shape). Scoping the matcher this way means a pool-side lock throws
    // "unexpected query" instead of silently satisfying the assertions below.
    [/^SELECT pg_advisory_xact_lock/, () => ({ rows: [] }), 'client'],
    [/^SELECT \* FROM "matchups" WHERE "league_id" = \$1 AND "season" = \$2 AND "week" = \$3 AND "final" = true/, () => ({
      rows: [{ id: 1, home_team_id: homeTeamId, away_team_id: awayTeamId, home_score: homeScore, away_score: awayScore }],
    })],
    // #1467: awardWeeklyTrophies now resolves the weekly high score through
    // the same helper reconcileWeeklyHighScoreTrophy uses, so a first award
    // also reads (and, on a tied/stale holder, deletes) the week's existing
    // top_scorer rows. Both matchers stay 'client'-scoped for the same
    // reason as the lock above.
    [/^SELECT "id", "team_id", "data" FROM "trophies"/, () => ({ rows: existingTrophies }), 'client'],
    [/^DELETE FROM "trophies"/, () => ({ rows: [] }), 'client'],
    // #1477: a tied incumbent whose stored points have drifted from the
    // week's high is updated in place, not re-inserted or deleted.
    // 'client'-scoped for the same reason the SELECT and DELETE above are.
    [/^UPDATE "trophies"/, () => ({ rows: [] }), 'client'],
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
  assert.equal(lockCalls[0].via, 'client', 'the lock rides the transaction client, not the ambient pool');

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

// ---- #1467: awardWeeklyTrophies and reconcileWeeklyHighScoreTrophy share
// one selection for the weekly high score ---------------------------------
//
// Before this ticket, awardWeeklyTrophies picked a tie's holder by scan order
// (first side seen) and never read the week's existing top_scorer rows, while
// reconcileWeeklyHighScoreTrophy kept a tied incumbent and otherwise picked
// the lowest team_id. The two could disagree once a correction reconciled a
// week before the deferred award ran for it. Both now resolve through the
// same helper: a tied incumbent is kept (no insert, no delete of itself), and
// a fresh tie is broken by lowest team_id, matching the reconcile exactly.

test('#1467: awardWeeklyTrophies keeps a tied incumbent instead of inserting a second holder', async (t) => {
  const leagueId = 7;
  const season = 2026;
  const week = 5;
  const fake = awardWorld({
    leagueId, homeTeamId: 20, awayTeamId: 10, homeScore: 100, awayScore: 100,
    existingTrophies: [{ id: 5, team_id: 10, data: { points: 100 } }],
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId, season, week });

  assert.equal(fake.matching(/^INSERT INTO "trophies"/).length, 0, 'the tied incumbent is not re-awarded');
  assert.equal(fake.matching(/^DELETE FROM "trophies"/).length, 0, 'the tied incumbent is not deleted');
  assert.equal(fake.matching(/^UPDATE "trophies"/).length, 0, 'unchanged points issue no UPDATE');

  fake.assertClean();
});

test("#1477: awardWeeklyTrophies updates a tied incumbent's stored points in place under the same lock", async (t) => {
  const leagueId = 7;
  const season = 2026;
  const week = 5;
  const fake = awardWorld({
    leagueId, homeTeamId: 20, awayTeamId: 10, homeScore: 100, awayScore: 100,
    existingTrophies: [{ id: 5, team_id: 10, data: { points: 90 } }],
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId, season, week });

  const updates = fake.matching(/^UPDATE "trophies"/);
  assert.equal(updates.length, 1, 'exactly one UPDATE for the tied incumbent');
  assert.equal(updates[0].params[0], 5);
  assert.equal(JSON.parse(updates[0].params[1]).points, 100);
  assert.equal(fake.matching(/^INSERT INTO "trophies"/).length, 0, 'the tied incumbent is not re-awarded');
  assert.equal(fake.matching(/^DELETE FROM "trophies"/).length, 0, 'the tied incumbent is not deleted');

  fake.assertClean();
});

test('#1467: awardWeeklyTrophies breaks a fresh tie by lowest team_id, matching the reconcile', async (t) => {
  const leagueId = 7;
  const season = 2026;
  const week = 5;
  const fake = awardWorld({
    leagueId, homeTeamId: 20, awayTeamId: 10, homeScore: 100, awayScore: 100,
    existingTrophies: [],
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId, season, week });

  const inserts = fake.matching(/^INSERT INTO "trophies"/);
  assert.equal(inserts.length, 1, 'exactly one trophy inserted');
  assert.equal(inserts[0].params[4], 'top_scorer');
  assert.equal(inserts[0].params[1], 10, 'the lower team_id of the tied pair wins');

  fake.assertClean();
});

test('#1467: awardWeeklyTrophies deletes a stale (not-tied) prior holder under the same lock, before awarding the new leader', async (t) => {
  const leagueId = 7;
  const season = 2026;
  const week = 5;
  // Team 30 held last week's number but is not one of this week's two tied
  // teams (10, 20): resolveWeeklyHighScoreTrophy must treat it as stale.
  const fake = awardWorld({
    leagueId, homeTeamId: 20, awayTeamId: 10, homeScore: 100, awayScore: 100,
    existingTrophies: [{ id: 9, team_id: 30, data: { points: 90 } }],
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId, season, week });

  const lockIdx = fake.calls.findIndex((c) => /pg_advisory_xact_lock/.test(c.text));
  const deleteIdx = fake.calls.findIndex((c) => /^DELETE FROM "trophies"/.test(c.text));
  const insertIdx = fake.calls.findIndex(
    (c) => /^INSERT INTO "trophies"/.test(c.text) && c.params[4] === 'top_scorer'
  );

  assert.ok(deleteIdx >= 0, 'the stale row was deleted');
  assert.deepEqual(fake.calls[deleteIdx].params, [9], 'only the stale team_id-30 row was targeted');
  assert.ok(insertIdx >= 0, 'the new leader was awarded');
  assert.equal(fake.calls[insertIdx].params[1], 10, 'the lower team_id of the tied pair wins');
  assert.ok(lockIdx < deleteIdx, 'the lock is taken before the stale-row DELETE');
  assert.ok(lockIdx < insertIdx, 'the lock is taken before the trophy INSERT');

  fake.assertClean();
});
