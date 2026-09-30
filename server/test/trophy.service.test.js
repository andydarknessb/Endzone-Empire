const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const trophySvc = require('../services/trophy.service');
const decisionSvc = require('../services/decision.service');

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

// #1854: the lineup trophies (Perfect Lineup, Captain Hindsight) read each
// team's Hindsight through decision.service.weekHindsightRoster. That read is
// its own seam with its own suites, so this world stubs it per team:
// `hindsight` maps teamId -> the weekHindsightRoster result. A team with no
// entry reads as a normal week (points left on the bench, nothing to move), so
// the weekly-high-score tests above never see a lineup trophy.
const NORMAL_WEEK = { actualPoints: 50, optimalPoints: 55, pointsLeftOnBench: 5, counted: [] };

function awardWorld({
  leagueId, homeScore, awayScore, homeTeamId = 10, awayTeamId = 20, existingTrophies = [],
  bestBall = false, hindsight = {}, newInserts = true, calls: hindsightCalls = [], rosterSlots,
}) {
  const fake = createFakePool([
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({
      rows: [{
        id: leagueId, draft_status: 'complete', season_status: 'in_season', regular_season_weeks: 14,
        best_ball: bestBall,
        ...(rosterSlots ? { roster_slots: rosterSlots } : {}),
      }],
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
    [/^INSERT INTO "trophies"/, () => ({ rows: newInserts ? [{ id: 1 }] : [] })],
    [/^SELECT "owner_id" FROM "teams" WHERE "id" = \$1/, (text, params) => ({
      rows: [{ owner_id: 1000 + Number(params[0]) }],
    })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
  const install = fake.install.bind(fake);
  fake.install = (t) => {
    install(t);
    t.mock.method(decisionSvc, 'weekHindsightRoster', async (args) => {
      hindsightCalls.push(args);
      return hindsight[args.teamId] || NORMAL_WEEK;
    });
    return fake;
  };
  return fake;
}

const row = (playerId, name, position, slot, points) => ({ playerId, name, position, slot, points });
const trophyInserts = (fake, type) =>
  fake.matching(/^INSERT INTO "trophies"/).filter((c) => c.params[4] === type);

// A standard-template week, home 10 against away 20 unless a test says so.
// Team 10 started QB/RB/RB/WR/WR/TE/FLEX/K/DEF; the bench is whatever the test
// hands in.
function startersFor(flexPoints = 5) {
  return [
    row(1, 'Quinn QB', 'QB', 'QB', 20),
    row(2, 'Rex RB', 'RB', 'RB', 15),
    row(3, 'Ray RB', 'RB', 'RB', 12),
    row(4, 'Wes WR', 'WR', 'WR', 14),
    row(5, 'Walt WR', 'WR', 'WR', 11),
    row(6, 'Tom TE', 'TE', 'TE', 8),
    row(7, 'Flex Guy', 'WR', 'FLEX', flexPoints),
    row(8, 'Kip K', 'K', 'K', 7),
    row(9, 'Dee DEF', 'DEF', 'DEF', 6),
  ];
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

// ---- #1854: Perfect Lineup and Captain Hindsight ---------------------------
//
// Two weekly trophies written by the same award pass, from each team's
// Hindsight: Perfect Lineup when nothing was left on the bench, Captain
// Hindsight when a loser or a tie had ONE bench-for-starter (or bench-into-empty
// -slot) move that would have beaten the opponent's score of record. Both use
// Hindsight's population and pricer, so the world stubs weekHindsightRoster.

const L = 7;
const S = 2026;
const W = 5;

test('#1854: a team with nothing left on the bench gets Perfect Lineup with its points; one with points left does not', async (t) => {
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110,
    hindsight: {
      10: { actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0, counted: startersFor() },
      20: { actualPoints: 110, optimalPoints: 118, pointsLeftOnBench: 8, counted: [] },
    },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  const perfect = trophyInserts(fake, 'perfect_lineup');
  assert.equal(perfect.length, 1);
  assert.equal(perfect[0].params[1], 10);
  assert.equal(perfect[0].params[5], 'Perfect Lineup');
  assert.deepEqual(JSON.parse(perfect[0].params[6]), { points: 98 });
  fake.assertClean();
});

test('#1854: both sides of a Matchup can set a perfect lineup', async (t) => {
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110,
    hindsight: {
      10: { actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0, counted: startersFor() },
      20: { actualPoints: 110, optimalPoints: 110, pointsLeftOnBench: 0, counted: startersFor() },
    },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  assert.deepEqual(trophyInserts(fake, 'perfect_lineup').map((c) => c.params[1]).sort(), [10, 20]);
  fake.assertClean();
});

test('#1854: a team with no lineup at all is not a perfect lineup', async (t) => {
  const fake = awardWorld({
    leagueId: L, homeScore: 0, awayScore: 110,
    hindsight: { 10: { actualPoints: 0, optimalPoints: 0, pointsLeftOnBench: 0, counted: [] } },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  assert.equal(trophyInserts(fake, 'perfect_lineup').length, 0);
});

test('#1854: best ball never awards a lineup trophy and never reads Hindsight for one', async (t) => {
  const calls = [];
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110, bestBall: true, calls,
    hindsight: {
      10: { actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0, counted: startersFor() },
    },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  assert.equal(trophyInserts(fake, 'perfect_lineup').length, 0);
  assert.equal(trophyInserts(fake, 'captain_hindsight').length, 0);
  assert.equal(calls.length, 0);
  fake.assertClean();
});

test('#1854: the loser with a winning bench move gets Captain Hindsight naming the largest gain; the winner does not', async (t) => {
  const counted = [
    ...startersFor(5),
    row(21, 'Ben Bench', 'WR', 'BENCH', 30), // over Flex Guy: +25; over Walt WR: +19
    row(22, 'Rob Bench', 'RB', 'BENCH', 18), // over Ray RB: +6
  ];
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110, // team 10 lost by 12
    hindsight: {
      10: { actualPoints: 98, optimalPoints: 123, pointsLeftOnBench: 25, counted },
      20: { actualPoints: 110, optimalPoints: 140, pointsLeftOnBench: 30, counted },
    },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  const captain = trophyInserts(fake, 'captain_hindsight');
  assert.equal(captain.length, 1, 'only the team that lost');
  assert.equal(captain[0].params[1], 10);
  assert.equal(captain[0].params[5], 'Captain Hindsight');
  assert.deepEqual(JSON.parse(captain[0].params[6]), {
    benchPlayerId: 21, benchPlayer: 'Ben Bench', benchPoints: 30,
    starterPlayerId: 7, starter: 'Flex Guy', starterPoints: 5,
    slot: 'FLEX', gain: 25, margin: 12,
  });
  fake.assertClean();
});

test('#1854: a move that only ties the opponent does not qualify, one point above does', async (t) => {
  const tiedOnly = [...startersFor(5), row(21, 'Ben Bench', 'WR', 'BENCH', 17)]; // +12 == margin 12
  const fakeTied = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110,
    hindsight: { 10: { actualPoints: 98, optimalPoints: 110, pointsLeftOnBench: 12, counted: tiedOnly } },
  });
  fakeTied.install(t);
  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });
  assert.equal(trophyInserts(fakeTied, 'captain_hindsight').length, 0);

  const above = [...startersFor(5), row(21, 'Ben Bench', 'WR', 'BENCH', 17.01)];
  const fakeAbove = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110,
    hindsight: { 10: { actualPoints: 98, optimalPoints: 110.01, pointsLeftOnBench: 12.01, counted: above } },
  });
  fakeAbove.install(t);
  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });
  assert.equal(trophyInserts(fakeAbove, 'captain_hindsight').length, 1);
});

test('#1854: a tied Matchup counts: any positive gain wins it, and the margin is zero', async (t) => {
  const counted = [...startersFor(5), row(21, 'Ben Bench', 'WR', 'BENCH', 6)]; // +1
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 98,
    hindsight: { 10: { actualPoints: 98, optimalPoints: 99, pointsLeftOnBench: 1, counted } },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  const captain = trophyInserts(fake, 'captain_hindsight');
  assert.equal(captain.length, 1);
  assert.equal(JSON.parse(captain[0].params[6]).margin, 0);
  assert.equal(JSON.parse(captain[0].params[6]).gain, 1);
});

test('#1854: a bench player filling an empty slot qualifies, with no starter named', async (t) => {
  // Team 10 started no TE: the TE slot sat empty while a TE rode the bench.
  const counted = [
    ...startersFor(5).filter((r) => r.slot !== 'TE'),
    row(23, 'Tina TE', 'TE', 'BENCH', 25),
  ];
  const fake = awardWorld({
    leagueId: L, homeScore: 90, awayScore: 100, // lost by 10; +25 at the TE slot (or FLEX +20)
    hindsight: { 10: { actualPoints: 90, optimalPoints: 115, pointsLeftOnBench: 25, counted } },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  const captain = trophyInserts(fake, 'captain_hindsight');
  assert.equal(captain.length, 1);
  assert.deepEqual(JSON.parse(captain[0].params[6]), {
    benchPlayerId: 23, benchPlayer: 'Tina TE', benchPoints: 25,
    starterPlayerId: null, starter: null, starterPoints: 0,
    slot: 'TE', gain: 25, margin: 10,
  });
});

test('#1854: a bench player is only moved into a slot he is eligible for', async (t) => {
  // A 40-point kicker cannot replace a WR or the FLEX; the K slot's own
  // starter (7) is 33 short of him, but 33 < margin 40, so nothing qualifies.
  const counted = [...startersFor(5), row(24, 'Kick Bench', 'K', 'BENCH', 40)];
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 138,
    hindsight: { 10: { actualPoints: 98, optimalPoints: 131, pointsLeftOnBench: 33, counted } },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  assert.equal(trophyInserts(fake, 'captain_hindsight').length, 0);
});

test('#1854: an IR occupant is never a candidate', async (t) => {
  const counted = [...startersFor(5), row(25, 'Ira IR', 'WR', 'IR', 60)];
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110,
    hindsight: { 10: { actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0, counted } },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  assert.equal(trophyInserts(fake, 'captain_hindsight').length, 0);
});

test('#1854: the league roster template decides eligibility and empty slots', async (t) => {
  // A superflex template: the SFLX seat takes a QB, and sat empty. The bench QB
  // qualifies for it by filling the empty seat.
  const slots = [
    { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'SFLX', label: 'SFLX', count: 1, eligiblePositions: ['QB', 'RB', 'WR'] },
  ];
  const counted = [row(1, 'Quinn QB', 'QB', 'QB', 20), row(2, 'Sam QB', 'QB', 'BENCH', 15)];
  const fake = awardWorld({
    leagueId: L, homeScore: 20, awayScore: 30, rosterSlots: slots,
    hindsight: { 10: { actualPoints: 20, optimalPoints: 35, pointsLeftOnBench: 15, counted } },
  });
  fake.install(t);

  await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  const captain = trophyInserts(fake, 'captain_hindsight');
  assert.equal(captain.length, 1);
  assert.equal(JSON.parse(captain[0].params[6]).slot, 'SFLX');
});

test('#1854: awarding twice is idempotent: an existing lineup trophy is not announced again', async (t) => {
  const counted = [...startersFor(5), row(21, 'Ben Bench', 'WR', 'BENCH', 30)];
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110, newInserts: false,
    hindsight: { 10: { actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0, counted } },
  });
  fake.install(t);

  const awarded = await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  assert.ok(trophyInserts(fake, 'perfect_lineup').length >= 1, 'the insert is attempted (ON CONFLICT DO NOTHING)');
  assert.ok(fake.matching(/^INSERT INTO "trophies"/).every((c) => /ON CONFLICT \("league_id", "season", "week", "team_id", "type"\) DO NOTHING/.test(c.text)));
  assert.deepEqual(awarded, [], 'nothing newly awarded, nothing to notify');
  assert.equal(fake.matching(/^INSERT INTO "notifications"/).length, 0);
});

test('#1854: a Hindsight read that fails skips that team and never rolls back the week', async (t) => {
  const fake = awardWorld({ leagueId: L, homeScore: 98, awayScore: 110 });
  fake.install(t);
  t.mock.method(decisionSvc, 'weekHindsightRoster', async () => { throw new Error('hindsight boom'); });
  t.mock.method(console, 'error', () => {});

  const awarded = await trophySvc.awardWeeklyTrophies({ leagueId: L, season: S, week: W });

  assert.equal(trophyInserts(fake, 'top_scorer').length, 1, 'the weekly high score still lands');
  assert.equal(awarded.some((a) => a.type === 'perfect_lineup'), false);
  fake.assertClean();
});

test('#1854: a stat correction awards, revokes and changes no lineup trophy', async (t) => {
  const calls = [];
  const fake = awardWorld({
    leagueId: L, homeScore: 98, awayScore: 110, calls,
    hindsight: { 10: { actualPoints: 98, optimalPoints: 98, pointsLeftOnBench: 0, counted: startersFor() } },
    existingTrophies: [],
  });
  fake.install(t);

  await trophySvc.reconcileWeeklyHighScoreTrophy({ leagueId: L, season: S, week: W });

  assert.equal(calls.length, 0, 'the reconcile never reads Hindsight');
  assert.equal(trophyInserts(fake, 'perfect_lineup').length, 0);
  assert.equal(trophyInserts(fake, 'captain_hindsight').length, 0);
  const selects = fake.matching(/^SELECT "id", "team_id", "data" FROM "trophies"/);
  assert.ok(selects.every((c) => /"type" = 'top_scorer'/.test(c.text)), 'only the weekly high score row is ever read for change');
  fake.assertClean();
});
