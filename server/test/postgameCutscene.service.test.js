const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const postgameCutscene = require('../services/postgameCutscene.service');

/**
 * postgameCutscene.service (ADR 0052): the due list and the seen write.
 * Every case is a small world of rows behind the fake pool seam; the fake
 * answers what the matchers say and the service is judged on what it does
 * with the answers.
 */

const DAY = 24 * 3600 * 1000;
const NOW = new Date('2026-10-06T14:00:00.000Z'); // Tuesday morning after week 4

// Week 5 opens Thursday night; its last game is Monday night.
const W5_FIRST = '2026-10-09T00:20:00.000Z';
const W5_LAST = '2026-10-13T00:15:00.000Z';
// Week 4's last game, for the season-complete case.
const W4_LAST = '2026-10-06T00:15:00.000Z';

const game = (week, nflTeam, kickoffAt) => ({ season: 2026, week, nfl_team: nflTeam, kickoff_at: kickoffAt });

const team = (id, name, extra = {}) => ({
  id, league_id: 71, name, owner_id: 1000 + id, username: `manager${id}`, email: `m${id}@example.test`, ...extra,
});

// Four final weeks. Team 248 (the viewer, user 7) is 3-1: W W L W.
const matchup = (id, week, home, away, hs, as, extra = {}) => ({
  id, league_id: 71, season: 2026, week, home_team_id: home, away_team_id: away,
  home_score: hs, away_score: as, final: true, is_playoff: false, ...extra,
});
const baseMatchups = () => [
  matchup(901, 1, 248, 500, '114.00', '100.00'),
  matchup(902, 2, 488, 248, '90.00', '100.00'),
  matchup(903, 3, 500, 248, '120.00', '100.00'),
  matchup(904, 4, 248, 488, '114.50', '98.20'),
];

const baseWorld = () => ({
  prefs: [],
  leagues: [{
    id: 71, name: 'Winsconsota', current_season: 2026, current_week: 5,
    my_team_id: 248, my_team_name: "Cory's Crunchers",
  }],
  teams: [team(248, "Cory's Crunchers"), team(488, 'Ham Lake Hitmen'), team(500, 'Third Wheels')],
  avatars: [{ id: 248, avatar_url: null, avatar_static_url: null }, { id: 488, avatar_url: null, avatar_static_url: null }],
  matchups: baseMatchups(),
  seen: [{ matchup_id: 901 }, { matchup_id: 902 }, { matchup_id: 903 }], // only week 4 is unseen
  nflGames: [
    game(1, 'KC', '2026-09-13T17:00:00.000Z'), game(1, 'GB', '2026-09-15T00:15:00.000Z'),
    game(2, 'KC', '2026-09-20T17:00:00.000Z'), game(2, 'GB', '2026-09-22T00:15:00.000Z'),
    game(3, 'KC', '2026-09-27T17:00:00.000Z'), game(3, 'GB', '2026-09-29T00:15:00.000Z'),
    game(4, 'KC', '2026-10-04T17:00:00.000Z'), game(4, 'GB', W4_LAST),
    game(5, 'KC', W5_FIRST), game(5, 'GB', W5_LAST),
  ],
});

function fakeFor(world) {
  return createFakePool([
    [/FROM "notification_prefs"/, () => ({ rows: world.prefs })],
    [/AS "my_team_id"/, () => ({ rows: world.leagues })],
    [/"avatar_static_url" FROM "teams"/, () => ({ rows: world.avatars })],
    [/^SELECT "teams"."id", "teams"."league_id", "teams"."name" FROM "teams"/, () => ({ rows: world.teams })],
    [/FROM "matchups" JOIN "leagues"/, () => ({ rows: world.matchups })],
    [/FROM "matchups" WHERE "id"/, (text, params) => ({ rows: world.matchups.filter((m) => m.id === params[0]) })],
    [/FROM "postgame_cutscene_views"/, () => ({ rows: world.seen })],
    [/FROM "nfl_games"/, () => ({ rows: world.nflGames })],
    [/FROM "trophies"/, () => ({ rows: world.trophies || [] })],
    [/FROM "league_analytics"/, () => ({ rows: world.narratives || [] })],
    [/FROM "lineup_overrides"/, () => ({ rows: world.calledShots || [] })],
    [/^INSERT INTO "postgame_cutscene_views"/, () => ({ rows: [], rowCount: 1 })],
  ]);
}

const listDue = (world, now = NOW) => {
  const db = fakeFor(world);
  return postgameCutscene.listDue({ userId: 7, now, db }).then((cutscenes) => ({ cutscenes, db }));
};

test('a final, unseen Matchup is due, shaped exactly as the wire contract', async () => {
  const { cutscenes } = await listDue(baseWorld());
  assert.deepEqual(cutscenes, [{
    matchupId: 904,
    leagueId: 71,
    leagueName: 'Winsconsota',
    season: 2026,
    week: 4,
    playoff: false,
    outcome: 'win',
    me: { teamId: 248, name: "Cory's Crunchers", avatarUrl: null, avatarStaticUrl: null, score: 114.5 },
    opponent: { teamId: 488, name: 'Ham Lake Hitmen', avatarUrl: null, avatarStaticUrl: null, score: 98.2 },
    record: { wins: 3, losses: 1, ties: 0 },
    standing: { rank: 1, of: 3 },
    awards: [],
    narrative: null,
  }]);
});

test('the stored postgame Narrative of the Matchup rides the payload', async () => {
  const world = baseWorld();
  const postgame = { narrative: 'The Crunchers got there.', source: 'claude' };
  world.narratives = [
    { league_id: 71, season: 2026, week: 4, data: { matchups: { 904: { preview: { narrative: 'Before.' }, postgame } } } },
    { league_id: 71, season: 2026, week: 3, data: { matchups: { 904: { postgame: { narrative: 'Another week.' } } } } },
  ];
  const { cutscenes } = await listDue(world);
  assert.equal(cutscenes[0].narrative, postgame.narrative);
});

// ADR 0052 amendment (#1863): the awards ride the payload, read from the frozen
// trophy rows and the team's resolved called row for the Matchup's own week.
const trophy = (teamId, week, type, data = {}, extra = {}) => ({
  league_id: 71, team_id: teamId, season: 2026, week, type, data, ...extra,
});
const calledRow = (teamId, week, outcome, extra = {}) => ({
  league_id: 71, team_id: teamId, season: 2026, week, outcome,
  starter_name: 'Kelce', benched_name: 'Hill', starter_points_actual: '18.40', benched_points_actual: '9.10', ...extra,
});

test('awards list the called shot, Perfect Lineup and Captain Hindsight for the week, in that order', async () => {
  const world = baseWorld();
  world.trophies = [
    trophy(248, 4, 'captain_hindsight', { benchPlayer: 'Pacheco', gain: 7.5 }),
    trophy(248, 4, 'perfect_lineup', { points: 131.2 }),
    trophy(248, 4, 'called_shot'), // the hit is read from the called row, never twice
  ];
  world.calledShots = [calledRow(248, 4, 'hit')];
  const { cutscenes } = await listDue(world);
  assert.deepEqual(cutscenes[0].awards, [
    { type: 'called_shot', label: 'CALLED SHOT: HIT', detail: 'KELCE OVER HILL, 18.4 TO 9.1' },
    { type: 'perfect_lineup', label: 'PERFECT LINEUP', detail: '131.2 PTS' },
    { type: 'captain_hindsight', label: 'CAPTAIN HINDSIGHT', detail: 'PACHECO WAS +7.5' },
  ]);
});

test('a missed called shot is an award too', async () => {
  const world = baseWorld();
  world.calledShots = [calledRow(248, 4, 'miss', { starter_points_actual: '4.00', benched_points_actual: '12.50' })];
  const { cutscenes } = await listDue(world);
  assert.deepEqual(cutscenes[0].awards, [
    { type: 'called_shot', label: 'CALLED SHOT: MISS', detail: 'KELCE OVER HILL, 4 TO 12.5' },
  ]);
});

test("awards are the viewer's own team and the Matchup's own week only", async () => {
  const world = baseWorld();
  world.trophies = [
    trophy(488, 4, 'perfect_lineup', { points: 100 }), // the opponent's
    trophy(248, 3, 'perfect_lineup', { points: 100 }), // another week
    trophy(248, 4, 'perfect_lineup', { points: 100 }, { season: 2025 }), // another season
    trophy(248, 4, 'top_scorer'), // not an award of this card
  ];
  world.calledShots = [calledRow(488, 4, 'hit'), calledRow(248, 3, 'hit')];
  const { cutscenes } = await listDue(world);
  assert.deepEqual(cutscenes[0].awards, []);
});

test('an award read that fails leaves the cutscene without a card, not without a result', async () => {
  const world = baseWorld();
  const db = fakeFor(world);
  const query = db.query.bind(db);
  db.query = (sql, params) => (/"trophies"/.test(sql) ? Promise.reject(new Error('boom')) : query(sql, params));
  const cutscenes = await postgameCutscene.listDue({ userId: 7, now: NOW, db });
  assert.equal(cutscenes.length, 1);
  assert.deepEqual(cutscenes[0].awards, []);
});

test('the viewer on the away side is still "me" and a lower score is a loss', async () => {
  const world = baseWorld();
  world.matchups[3] = matchup(904, 4, 488, 248, '120.00', '98.20');
  const { cutscenes } = await listDue(world);
  assert.equal(cutscenes[0].outcome, 'loss');
  assert.equal(cutscenes[0].me.teamId, 248);
  assert.equal(cutscenes[0].me.score, 98.2);
  assert.equal(cutscenes[0].opponent.teamId, 488);
  assert.deepEqual(cutscenes[0].record, { wins: 2, losses: 2, ties: 0 });
});

test('the avatars ride on the team, not the account', async () => {
  const world = baseWorld();
  world.avatars = [
    { id: 248, avatar_url: 'https://cdn.test/me.gif', avatar_static_url: 'https://cdn.test/me.png' },
    { id: 488, avatar_url: null, avatar_static_url: 'https://cdn.test/opp.png' },
  ];
  const { cutscenes } = await listDue(world);
  assert.deepEqual(
    [cutscenes[0].me.avatarUrl, cutscenes[0].me.avatarStaticUrl, cutscenes[0].opponent.avatarUrl, cutscenes[0].opponent.avatarStaticUrl],
    ['https://cdn.test/me.gif', 'https://cdn.test/me.png', null, 'https://cdn.test/opp.png']
  );
});

test('a Matchup that is not final is not due', async () => {
  const world = baseWorld();
  world.matchups[3] = matchup(904, 4, 248, 488, '80.00', '70.00', { final: false });
  assert.deepEqual((await listDue(world)).cutscenes, []);
});

test('a Matchup between other Teams is not the viewer\'s', async () => {
  const world = baseWorld();
  world.matchups.push(matchup(905, 4, 488, 500, '101.00', '99.00'));
  const { cutscenes } = await listDue(world);
  assert.deepEqual(cutscenes.map((c) => c.matchupId), [904]);
});

test('a Matchup already seen is not due again', async () => {
  const world = baseWorld();
  world.seen.push({ matchup_id: 904 });
  assert.deepEqual((await listDue(world)).cutscenes, []);
});

test('a later stat correction changes the score shown but never re-opens a seen Matchup', async () => {
  const world = baseWorld();
  world.seen.push({ matchup_id: 904 });
  world.matchups[3] = matchup(904, 4, 248, 488, '90.00', '98.20'); // corrected into a loss
  assert.deepEqual((await listDue(world)).cutscenes, []);
});

test('an advance after week N+1\'s first Kickoff but before last still shows the cutscene', async () => {
  const middle = new Date((new Date(W5_FIRST).getTime() + new Date(W5_LAST).getTime()) / 2);
  const { cutscenes } = await listDue(baseWorld(), middle);
  assert.equal(cutscenes.length, 1);
  assert.equal(cutscenes[0].week, 4);
});

test('it expires at the last Kickoff of the league\'s current week (inclusive)', async () => {
  const before = new Date(new Date(W5_LAST).getTime() - 1);
  assert.equal((await listDue(baseWorld(), before)).cutscenes.length, 1);
  assert.deepEqual((await listDue(baseWorld(), new Date(W5_LAST))).cutscenes, []);
  assert.deepEqual((await listDue(baseWorld(), new Date(new Date(W5_LAST).getTime() + DAY))).cutscenes, []);
});

test("when the schedule has no week after the Matchup's it expires 7 days after that week's last Kickoff", async () => {
  const world = baseWorld();
  world.nflGames = world.nflGames.filter((g) => g.week !== 5);
  const expiry = new Date(W4_LAST).getTime() + 7 * DAY;
  assert.equal((await listDue(world, new Date(expiry - 1))).cutscenes.length, 1);
  assert.deepEqual((await listDue(world, new Date(expiry))).cutscenes, []);
});

test('a Matchup two weeks behind current_week is not due after the next week\'s last Kickoff (nothing carries over)', async () => {
  const world = baseWorld();
  world.leagues[0].current_week = 6; // week 4's result is a week old; week 5 has finished
  world.seen = []; // weeks 1-4 all final and unseen
  world.nflGames.push(game(6, 'KC', '2026-10-16T00:20:00.000Z'), game(6, 'GB', '2026-10-20T00:15:00.000Z'));
  const afterWeek5LastKickoff = new Date(new Date(W5_LAST).getTime() + DAY);
  assert.deepEqual((await listDue(world, afterWeek5LastKickoff)).cutscenes, []);
});

test('with weeks 1-3 unseen, only the result that just happened is due before the next Kickoff', async () => {
  const world = baseWorld();
  world.seen = [];
  assert.deepEqual((await listDue(world)).cutscenes.map((c) => c.week), [4]);
});

test('a completed season expires 7 days after the Matchup week\'s last Kickoff even though current_week moved on', async () => {
  const world = baseWorld();
  world.leagues[0].season_status = 'complete'; // finalize sets current_week = week + 1 here too
  const expiry = new Date(W4_LAST).getTime() + 7 * DAY;
  assert.equal((await listDue(world, new Date(expiry - 1))).cutscenes.length, 1);
  assert.deepEqual((await listDue(world, new Date(expiry))).cutscenes, []);
});

test("a league advanced past the schedule's weeks still expires 7 days after the Matchup week's last Kickoff", async () => {
  const world = baseWorld();
  world.leagues[0].current_week = 19;
  world.nflGames = world.nflGames.filter((g) => g.week !== 5);
  const expiry = new Date(W4_LAST).getTime() + 7 * DAY;
  assert.equal((await listDue(world, new Date(expiry - 1))).cutscenes.length, 1);
  assert.deepEqual((await listDue(world, new Date(expiry))).cutscenes, []);
});

test('a playoff week past the schedule (no Kickoffs) is not left due once the league is two weeks on', async () => {
  const world = baseWorld();
  world.seen = [{ matchup_id: 901 }, { matchup_id: 902 }, { matchup_id: 903 }, { matchup_id: 904 }];
  world.matchups.push(matchup(919, 19, 248, 488, '100.00', '90.00', { is_playoff: true }));
  world.leagues[0].current_week = 20; // the final is next: the semifinal result is still the latest
  assert.deepEqual((await listDue(world)).cutscenes.map((c) => c.week), [19]);
  world.leagues[0].current_week = 21; // the final was played too
  assert.deepEqual((await listDue(world)).cutscenes, []);
});

test('a playoff Matchup carries playoff: true and no record or standing', async () => {
  const world = baseWorld();
  world.matchups[3] = matchup(904, 4, 248, 488, '114.50', '98.20', { is_playoff: true });
  const [item] = (await listDue(world)).cutscenes;
  assert.equal(item.playoff, true);
  assert.equal(item.record, null);
  assert.equal(item.standing, null);
  assert.equal(item.outcome, 'win');
});

test('equal scores are a tie, decided as computeStandings decides them', async () => {
  const world = baseWorld();
  world.matchups[3] = matchup(904, 4, 248, 488, '100.00', '100.00');
  const [item] = (await listDue(world)).cutscenes;
  assert.equal(item.outcome, 'tie');
  assert.deepEqual(item.record, { wins: 2, losses: 1, ties: 1 });
});

test('the preference off returns an empty list without reading the league', async () => {
  const world = baseWorld();
  world.prefs = [{ prefs: { postgameCutscenes: false } }];
  const { cutscenes, db } = await listDue(world);
  assert.deepEqual(cutscenes, []);
  assert.equal(db.matching(/FROM "matchups"/).length, 0);
});

test('the preference defaults to on when nothing is stored for the key', async () => {
  const world = baseWorld();
  world.prefs = [{ prefs: { lineupReminder: false } }];
  assert.equal((await listDue(world)).cutscenes.length, 1);
});

test('the payload carries Team identity only: no owner_id, username, email or user id at any depth', async () => {
  const { cutscenes } = await listDue(baseWorld());
  assert.ok(cutscenes.length > 0);
  const keys = [];
  const walk = (value) => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) { keys.push(k); walk(v); }
    }
  };
  walk(cutscenes);
  const forbidden = keys.filter((k) => /^(owner_?id|username|email|user_?id)$/i.test(k));
  assert.deepEqual(forbidden, []);
  assert.doesNotMatch(JSON.stringify(cutscenes), /manager\d|example\.test/);
});

test('several leagues come back sorted by league name then id, over one batched read each', async () => {
  const world = baseWorld();
  world.leagues = [
    { id: 90, name: 'Zed League', current_season: 2026, current_week: 5, my_team_id: 600, my_team_name: 'Z1' },
    { id: 71, name: 'Winsconsota', current_season: 2026, current_week: 5, my_team_id: 248, my_team_name: "Cory's Crunchers" },
    { id: 80, name: 'Winsconsota', current_season: 2026, current_week: 5, my_team_id: 700, my_team_name: 'W1' },
  ];
  world.teams.push(
    team(600, 'Z1', { league_id: 90 }), team(601, 'Z2', { league_id: 90 }),
    team(700, 'W1', { league_id: 80 }), team(701, 'W2', { league_id: 80 })
  );
  world.matchups.push(
    matchup(950, 4, 600, 601, '100.00', '90.00', { league_id: 90 }),
    matchup(960, 4, 700, 701, '100.00', '90.00', { league_id: 80 })
  );
  const { cutscenes, db } = await listDue(world);
  assert.deepEqual(cutscenes.map((c) => [c.leagueName, c.leagueId]), [['Winsconsota', 71], ['Winsconsota', 80], ['Zed League', 90]]);
  for (const pattern of [/FROM "matchups" JOIN "leagues"/, /^SELECT "teams"."id", "teams"."league_id"/, /FROM "postgame_cutscene_views"/, /FROM "nfl_games"/]) {
    assert.equal(db.matching(pattern).length, 1, `${pattern} should run once for all leagues`);
  }
  assert.ok(db.matching(/FROM "matchups" JOIN "leagues"/)[0].params.some((p) => Array.isArray(p) && p.length === 3));
  for (const call of db.matching(/ANY\(/)) assert.match(call.text, /= ANY\(\$\d+/);
});

test('markSeen inserts (user, matchup) with ON CONFLICT DO NOTHING and reports it stored', async () => {
  const world = baseWorld();
  const db = fakeFor(world);
  assert.equal(await postgameCutscene.markSeen({ userId: 7, matchupId: 904, db }), true);
  const [insert] = db.matching(/^INSERT INTO "postgame_cutscene_views"/);
  assert.match(insert.text, /ON CONFLICT DO NOTHING/);
  assert.deepEqual(insert.params, [7, 904]);
});

test('markSeen is idempotent: a second call is stored the same way', async () => {
  const db = fakeFor(baseWorld());
  assert.equal(await postgameCutscene.markSeen({ userId: 7, matchupId: 904, db }), true);
  assert.equal(await postgameCutscene.markSeen({ userId: 7, matchupId: 904, db }), true);
});

test('markSeen refuses a Matchup that is not final yet, and writes nothing', async () => {
  const world = baseWorld();
  world.matchups[3] = matchup(904, 4, 248, 488, '80.00', '70.00', { final: false });
  const db = fakeFor(world);
  assert.equal(await postgameCutscene.markSeen({ userId: 7, matchupId: 904, db }), false);
  assert.equal(db.matching(/^INSERT INTO/).length, 0);
});

test('markSeen refuses a Matchup the viewer holds no Team in, and writes nothing', async () => {
  const world = baseWorld();
  world.matchups.push(matchup(905, 4, 488, 500, '101.00', '99.00'));
  const db = fakeFor(world);
  assert.equal(await postgameCutscene.markSeen({ userId: 7, matchupId: 905, db }), false);
  assert.equal(await postgameCutscene.markSeen({ userId: 7, matchupId: 99999, db }), false);
  assert.equal(db.matching(/^INSERT INTO/).length, 0);
});
