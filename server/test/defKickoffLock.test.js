/**
 * #227: every kickoff-keyed rule must recognise a DEF unit and an alias code.
 *
 * `nfl_games` keys teams by Tank01 abbreviation (`DEN`, `WSH`, ...). A DEF
 * unit's `players.nfl_team` is a FULL TEAM NAME (`Denver Broncos`), seeded
 * that way by `syncTeamDefenses`, and even among codes Tank01's `WSH`
 * disagrees with the `WAS` a skill player may carry. Raw equality between the
 * two columns therefore answers "no game" for every DEF unit in the league,
 * on every consumer of the kickoff question at once:
 *
 *   - the lineup lock, so a manager can move a DEF after its game started;
 *   - the #197 current-week spare, so a DEF dropped after its game loses the
 *     row that carries its points;
 *   - #190's settle exclusion, so a DEF acquired after its game still counts.
 *
 * The three used to disagree about the same player. This suite is the proof
 * that they no longer can: the SAME fixtures, one per consumer, with a DEF
 * unit and an alias-coded skill player in place of a plain matching code.
 *
 * The controls matter as much as the cases. "No game row that week" is a bye
 * or an unsynced schedule and means NOT LOCKED everywhere, which is the
 * easiest thing to break while making a full name match an abbreviation: a
 * normalisation that folds an unknown string onto something real, or a join
 * that turns a miss into a hit, shows up here and nowhere else.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { tenureHandlers } = require('./helpers/tenureFakes');
const {
  getLineup,
  setLineup,
  removeLineupEntries,
} = require('../services/lineup.service');

const SEASON = 2026;
const WEEK = 8;
const LEAGUE_ID = 5;
const TEAM_ID = 10;
const USER_ID = 7;

const KICKED_OFF_AT = new Date('2026-11-01T17:00:00.000Z');
const NOT_YET_AT = new Date('2026-11-08T17:00:00.000Z');
const HELD_SINCE = new Date('2026-09-01T00:00:00.000Z');
const NOW = new Date('2026-11-01T20:00:00.000Z');

// One slot per position under test, so a move out of a starting slot leaves a
// legal lineup and the only thing that can refuse it is the lock.
const ROSTER_SLOTS = [
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
];

const DEF_UNIT = { player_id: 1, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos' };
const ALIAS_QB = { player_id: 2, name: 'Jayden Daniels', position: 'QB', nfl_team: 'WAS' };

/**
 * @param entries  the team's lineup rows.
 * @param games    `nfl_games` rows for the week, SPELLED THE WAY THE SCHEDULE
 *                 SPELLS THEM: Tank01 abbreviations, never the player's own
 *                 `nfl_team` string. A test that seeds the player's spelling
 *                 into the schedule proves nothing about #227.
 */
function lineupWorld({ entries, games, now = NOW }) {
  const rows = entries.map((entry) => ({ injury_status: null, ir_attested: false, ...entry }));
  return createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: LEAGUE_ID,
        current_season: SEASON,
        current_week: WEEK,
        best_ball: false,
        roster_slots: ROSTER_SLOTS,
        bench_slots: 5,
        ir_slots: 1,
      }],
    })],
    [/^SELECT \* FROM "teams"/, () => ({ rows: [{ id: TEAM_ID, owner_id: USER_ID }] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: rows.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: rows.map(({ player_id }) => ({ player_id })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: rows.map((row) => ({ ...row })) })],
    [/^SELECT "players"\."id"/, () => ({ rows: rows.map((row) => ({ ...row, id: row.player_id })) })],
    [/^SELECT "player_id", "season", "games_played"/, () => ({ rows: [] })],
    // The two schedule reads, both answered from the SAME rows: the lock's
    // kicked-off filter and the kickoff map behind the tenure predicate.
    [/^SELECT "nfl_team" FROM "nfl_games"/, (text, [, , at]) => ({
      rows: games
        .filter((game) => game.kickoff_at.getTime() <= new Date(at ?? now).getTime())
        .map((game) => ({ nfl_team: game.nfl_team })),
    })],
    [/FROM "nfl_games" "ng"/, () => ({ rows: [] })], // computeByeWeeks
    [/^UPDATE "lineup_entries"/, () => ({ rows: [] })],
  ]);
}

const scheduleFor = (games) => Object.fromEntries(games.map((g) => [g.nfl_team, g.kickoff_at]));

// ---------------------------------------------------------------------------
// The lineup lock (this is the half #227 says was READ and NOT EXERCISED at
// triage, so it is asserted through setLineup's real refusal, not through the
// predicate in isolation).
// ---------------------------------------------------------------------------

test('#227 setLineup refuses to move a DEF unit whose game has kicked off', async (t) => {
  const fake = lineupWorld({
    entries: [{ ...DEF_UNIT, slot: 'DEF' }, { ...ALIAS_QB, slot: 'QB' }],
    games: [{ nfl_team: 'DEN', kickoff_at: KICKED_OFF_AT }, { nfl_team: 'WSH', kickoff_at: NOT_YET_AT }],
  }).install(t);

  await assert.rejects(
    setLineup({ leagueId: LEAGUE_ID, userId: USER_ID, week: WEEK, moves: [{ playerId: DEF_UNIT.player_id, slot: 'BENCH' }] }),
    (error) => error.statusCode === 409 && error.code === 'LINEUP_LOCKED'
  );
  fake.assertClean();
});

test('#227 setLineup still allows moving a DEF unit before its game kicks off', async (t) => {
  const fake = lineupWorld({
    entries: [{ ...DEF_UNIT, slot: 'DEF' }, { ...ALIAS_QB, slot: 'QB' }],
    games: [{ nfl_team: 'DEN', kickoff_at: NOT_YET_AT }, { nfl_team: 'WSH', kickoff_at: NOT_YET_AT }],
  }).install(t);

  const result = await setLineup({
    leagueId: LEAGUE_ID, userId: USER_ID, week: WEEK,
    moves: [{ playerId: DEF_UNIT.player_id, slot: 'BENCH' }],
  });

  assert.equal(result.updated, 1);
  fake.assertClean();
});

test('#227 a WSH-coded game row locks a WAS-coded player, and vice versa', async (t) => {
  const wshGame = lineupWorld({
    entries: [{ ...ALIAS_QB, slot: 'QB' }],
    games: [{ nfl_team: 'WSH', kickoff_at: KICKED_OFF_AT }],
  }).install(t);

  await assert.rejects(
    setLineup({ leagueId: LEAGUE_ID, userId: USER_ID, week: WEEK, moves: [{ playerId: ALIAS_QB.player_id, slot: 'BENCH' }] }),
    (error) => error.code === 'LINEUP_LOCKED',
    'the schedule spells it WSH; the player is spelled WAS'
  );
  wshGame.assertClean();
  t.mock.restoreAll();

  const wasGame = lineupWorld({
    entries: [{ ...ALIAS_QB, nfl_team: 'WSH', slot: 'QB' }],
    games: [{ nfl_team: 'WAS', kickoff_at: KICKED_OFF_AT }],
  }).install(t);

  await assert.rejects(
    setLineup({ leagueId: LEAGUE_ID, userId: USER_ID, week: WEEK, moves: [{ playerId: ALIAS_QB.player_id, slot: 'BENCH' }] }),
    (error) => error.code === 'LINEUP_LOCKED',
    'and the other way round, because neither spelling is privileged'
  );
  wasGame.assertClean();
});

test('#227 a player with no game row that week is not locked (bye / unsynced schedule)', async (t) => {
  const fake = lineupWorld({
    entries: [{ ...DEF_UNIT, slot: 'DEF' }, { ...ALIAS_QB, slot: 'QB' }],
    // Every other team in the league has kicked off. Neither of these two has
    // a row at all, which is a bye or a schedule nobody synced, and is never
    // evidence that a game has started.
    games: [{ nfl_team: 'KC', kickoff_at: KICKED_OFF_AT }, { nfl_team: 'BUF', kickoff_at: KICKED_OFF_AT }],
  }).install(t);

  const result = await setLineup({
    leagueId: LEAGUE_ID, userId: USER_ID, week: WEEK,
    moves: [{ playerId: DEF_UNIT.player_id, slot: 'BENCH' }, { playerId: ALIAS_QB.player_id, slot: 'BENCH' }],
  });

  assert.equal(result.updated, 2);
  fake.assertClean();
});

test('#227 getLineup reports a kicked-off DEF unit as locked to the manager', async (t) => {
  const fake = lineupWorld({
    entries: [{ ...DEF_UNIT, slot: 'DEF' }, { ...ALIAS_QB, slot: 'QB' }],
    games: [{ nfl_team: 'DEN', kickoff_at: KICKED_OFF_AT }, { nfl_team: 'WSH', kickoff_at: NOT_YET_AT }],
  }).install(t);

  const lineup = await getLineup({ leagueId: LEAGUE_ID, userId: USER_ID, week: WEEK });

  const byId = new Map(lineup.entries.map((entry) => [entry.id, entry]));
  assert.equal(byId.get(DEF_UNIT.player_id).locked, true, 'his game has started');
  assert.equal(byId.get(ALIAS_QB.player_id).locked, false, 'his has not');
  fake.assertClean();
});

// ---------------------------------------------------------------------------
// The #197 current-week spare on a drop.
// ---------------------------------------------------------------------------

/**
 * `removeLineupEntries` as the drop paths reach it. Both drops that offer an
 * undo now go through `waiver.service`'s `placeOnWaiversUndoable`, and the
 * waiver-claim drop stays open-coded; all three land here, which is why the
 * fix belongs to this predicate and not to any one of them.
 */
function removalWorld({ nflTeam, games, tenures = [] }) {
  return createFakePool([
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT "nfl_team" FROM "players"/, () => ({ rows: [{ nfl_team: nflTeam }] })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, (text, [, , at]) => ({
      rows: games
        .filter((game) => game.kickoff_at.getTime() <= new Date(at).getTime())
        .map((game) => ({ nfl_team: game.nfl_team })),
    })],
    ...tenureHandlers({ schedule: scheduleFor(games), tenures, heldSince: HELD_SINCE }),
    [/^DELETE FROM "lineup_entries"/, () => ({ rows: [], rowCount: 1 })],
  ]);
}

const removeFor = async (fake) => {
  const client = await fake.connect();
  const result = await removeLineupEntries(client, {
    league: { id: LEAGUE_ID, current_season: SEASON, current_week: WEEK },
    teamId: TEAM_ID,
    playerId: DEF_UNIT.player_id,
    now: NOW,
  });
  client.release();
  return result;
};

test('#227 a DEF unit dropped AFTER its game keeps its current-week lineup row', async () => {
  const fake = removalWorld({
    nflTeam: 'Denver Broncos',
    games: [{ nfl_team: 'DEN', kickoff_at: KICKED_OFF_AT }],
  });

  const result = await removeFor(fake);

  assert.equal(result.removedCurrentWeek, false,
    'the row that carries his points is the record of the week as played');
  fake.assertClean();
});

test('#227 a DEF unit dropped BEFORE its game loses the current-week row like anyone else', async () => {
  const fake = removalWorld({
    nflTeam: 'Denver Broncos',
    games: [{ nfl_team: 'DEN', kickoff_at: NOT_YET_AT }],
  });

  const result = await removeFor(fake);

  assert.equal(result.removedCurrentWeek, true);
  fake.assertClean();
});

test('#227 a DEF unit with no game row that week is not spared', async () => {
  const fake = removalWorld({
    nflTeam: 'Denver Broncos',
    games: [{ nfl_team: 'KC', kickoff_at: KICKED_OFF_AT }],
  });

  const result = await removeFor(fake);

  assert.equal(result.removedCurrentWeek, true,
    'a bye or an unsynced schedule is not a kickoff, however the team is spelled');
  fake.assertClean();
});
