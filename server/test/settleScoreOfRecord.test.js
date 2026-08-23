const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const pool = require('../modules/pool');
const {
  benchAcquiredPlayer,
  removeLineupEntries,
  materializeLineup,
} = require('../services/lineup.service');
const { scoreMatchups } = require('../services/scoring.service');
const { finalizeWeekAndAdvance } = require('../services/season.service');

/**
 * Issue #190: the score of record must be the week AS PLAYED.
 *
 * `POST /api/scoring/league/:id/advance-week` scores the closing week and
 * then finalizes it, and until now that scoring pass took the LIVE path: it
 * re-materialized each lineup from today's roster and joined `team_players`.
 * Whatever a manager did between the last whistle and the commissioner's
 * click was therefore baked into a settled competitive result, silently and
 * in the direction of whoever moved a player:
 *
 *   - a starter DROPPED after his game lost his points, because the live
 *     roster join no longer found him;
 *   - a player ACQUIRED after his game gained his points, because the
 *     acquisition materialized him into the still-open week.
 *
 * The settle pass counts the week's existing `lineup_entries` rows, with no
 * re-materialization and no roster join, and excludes exactly one thing: a
 * player whose roster row was created AFTER his NFL game for that week
 * kicked off. The two halves pull in opposite directions on purpose, and the
 * first two tests below are that pair.
 *
 * The population rule leans on #197, which made a lineup entry follow the
 * roster: a drop deletes the current week's row only while the player's game
 * has NOT kicked off, so a row that SURVIVES means he was on the roster at
 * kickoff. That is what lets a post-game drop keep its points without the
 * settle pass needing a "when did ownership end" timestamp that no table
 * records. #197 also made a trade delete-and-insert the roster row, so
 * `team_players.created_at` is the acquisition time on every path.
 *
 * The world below is a small stateful fake in the shape of
 * finalWeekFreeze.test.js: `lineup_entries`, `team_players`, `nfl_games` and
 * `matchups` are real mutable arrays, so a drop or an acquisition is visible
 * to the settle pass that follows it.
 */

const SEASON = 2026;
const WEEK = 8;
const LEAGUE_ID = 5;
const TEAM_A = 10;
const TEAM_B = 20;
const TEAM_C = 30;
const TEAM_D = 40;

const QB_A = 1; // Team A's QB, 8.0 points, plays for the Chiefs
const QB_B = 3; // Team B's QB, 10.0 points, plays for the Bills
const ACQUIRED = 4; // RB, 30.0 points, plays for the Eagles
const BYE_MAN = 5; // RB, 12.0 points, whose NFL team has NO game row this week
const QB_C = 6; // Team C's QB, 20.0 points (seeding fixture only)
const QB_D = 7; // Team D's QB, 5.0 points (seeding fixture only)

// The one timeline every test reads. Every NFL game in the fixture kicks off
// at KICKOFF, so "before" and "after" mean before and after the week's games.
const KICKOFF = '2026-10-25T17:00:00.000Z';
const BEFORE_KICKOFF = '2026-10-24T12:00:00.000Z';
const AFTER_GAMES = '2026-10-25T23:30:00.000Z';

const ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] },
];

const NFL_TEAM = new Map([
  [QB_A, 'Chiefs'],
  [QB_B, 'Bills'],
  [ACQUIRED, 'Eagles'],
  [BYE_MAN, 'Ghosts'], // deliberately absent from nfl_games
  [QB_C, 'Chiefs'],
  [QB_D, 'Chiefs'],
]);

const POSITION = new Map([
  [QB_A, 'QB'],
  [QB_B, 'QB'],
  [ACQUIRED, 'RB'],
  [BYE_MAN, 'RB'],
  [QB_C, 'QB'],
  [QB_D, 'QB'],
]);

const WEEK_STATS = new Map([
  [QB_A, { passingYards: 200 }], // 8.0
  [QB_B, { passingYards: 250 }], // 10.0
  [ACQUIRED, { rushingYards: 300 }], // 30.0
  [BYE_MAN, { rushingYards: 120 }], // 12.0
  [QB_C, { passingYards: 500 }], // 20.0
  [QB_D, { passingYards: 125 }], // 5.0
]);

function createWorld({
  bestBall = false,
  teams = [
    { id: TEAM_A, name: 'Team A', owner_id: 101 },
    { id: TEAM_B, name: 'Team B', owner_id: 102 },
  ],
  teamPlayers = [
    { team_id: TEAM_A, player_id: QB_A, created_at: BEFORE_KICKOFF },
    { team_id: TEAM_B, player_id: QB_B, created_at: BEFORE_KICKOFF },
  ],
  lineupEntries = [
    { team_id: TEAM_A, player_id: QB_A, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
    { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
  ],
  matchups,
  regularSeasonWeeks = 14,
  playoffTeams = 4,
} = {}) {
  const state = {
    league: {
      id: LEAGUE_ID,
      current_season: SEASON,
      current_week: WEEK,
      best_ball: bestBall,
      roster_slots: ROSTER_SLOTS,
      bench_slots: 5,
      ir_slots: 1,
      scoring_rules: null,
      season_status: 'regular',
      regular_season_weeks: regularSeasonWeeks,
      playoff_teams: playoffTeams,
      playoff_consolation: false,
      owner_id: 101,
    },
    teams,
    teamPlayers,
    lineupEntries,
    // One row per NFL team per week, as the real table is. The Ghosts are
    // absent on purpose: that is the bye / unsynced-schedule case.
    nflGames: [
      { season: SEASON, week: WEEK, nfl_team: 'Chiefs', kickoff_at: KICKOFF },
      { season: SEASON, week: WEEK, nfl_team: 'Bills', kickoff_at: KICKOFF },
      { season: SEASON, week: WEEK, nfl_team: 'Eagles', kickoff_at: KICKOFF },
    ],
    matchups: matchups || [{
      id: 90,
      league_id: LEAGUE_ID,
      season: SEASON,
      week: WEEK,
      home_team_id: TEAM_A,
      away_team_id: TEAM_B,
      final: false,
      home_score: 0,
      away_score: 0,
      is_playoff: false,
      is_consolation: false,
      playoff_round: null,
    }],
    notifications: [],
  };

  const entriesFor = (teamId, season, week) =>
    state.lineupEntries.filter((e) => e.team_id === teamId && e.season === season && e.week === week);
  const rosterRow = (teamId, playerId) =>
    state.teamPlayers.find((tp) => tp.team_id === teamId && tp.player_id === playerId);
  const gameFor = (playerId, season, week) =>
    state.nflGames.find((g) => g.season === season && g.week === week
      && g.nfl_team === NFL_TEAM.get(playerId));

  // The live path's roster join, reproduced from the SQL text: its absence is
  // exactly what makes the settle and final populations differ from live.
  const scoringRows = (text, teamId, week) => {
    const joinsRoster = /JOIN "team_players"/.test(text);
    return entriesFor(teamId, SEASON, week)
      .filter((e) => !joinsRoster || Boolean(rosterRow(teamId, e.player_id)));
  };

  const handlers = [
    // --- the finality probe (must precede the generic matchups matcher) ----
    [/^SELECT 1 FROM "matchups".*"final" = true/, (text, [leagueId, season, week, teamId]) => ({
      rows: state.matchups
        .filter((m) => m.league_id === leagueId && m.season === season && m.week === week
          && m.final && (m.home_team_id === teamId || m.away_team_id === teamId))
        .slice(0, 1)
        .map(() => ({ frozen: 1 })),
    })],

    // --- the settle pass's exclusion probe ---------------------------------
    // All three joins are inner, so a player with no roster row (dropped) and
    // a player with no game row that week (bye) both fall out unexcluded.
    [/^SELECT "lineup_entries"\."player_id" FROM "lineup_entries"/, (text, [teamId, season, week]) => ({
      rows: entriesFor(teamId, season, week)
        .filter((e) => {
          const tp = rosterRow(teamId, e.player_id);
          if (!tp) return false;
          const game = gameFor(e.player_id, season, week);
          if (!game) return false;
          return new Date(tp.created_at) > new Date(game.kickoff_at);
        })
        .map((e) => ({ player_id: e.player_id })),
    })],

    // --- lineup.service ----------------------------------------------------
    [/^SELECT "team_players"\."player_id"/, (text, [teamId]) => ({
      rows: state.teamPlayers
        .filter((tp) => tp.team_id === teamId)
        .map((tp) => ({ player_id: tp.player_id, position: POSITION.get(tp.player_id) })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, (text, [teamId, season, week]) => ({
      rows: entriesFor(teamId, season, week).map((e) => ({ player_id: e.player_id })),
    })],
    [/^SELECT "player_id", "slot", "ir_attested" FROM "lineup_entries"/, (text, [teamId, season, week]) => {
      const earlier = state.lineupEntries
        .filter((e) => e.team_id === teamId && e.season === season && e.week < week);
      if (earlier.length === 0) return { rows: [] };
      const maxWeek = Math.max(...earlier.map((e) => e.week));
      return {
        rows: earlier
          .filter((e) => e.week === maxWeek)
          .map(({ player_id, slot, ir_attested }) => ({ player_id, slot, ir_attested })),
      };
    }],
    [/^INSERT INTO "lineup_entries"/, (text, [, teamId, playerId, season, week, slot, irAttested]) => {
      const clash = entriesFor(teamId, season, week).some((e) => e.player_id === playerId);
      if (!clash) {
        state.lineupEntries.push({
          team_id: teamId, player_id: playerId, season, week, slot, ir_attested: irAttested,
        });
      }
      return { rows: [] };
    }],
    [/^UPDATE "lineup_entries"/, (text, [teamId, playerId, season, fromWeek, toSlot, matchSlot]) => {
      for (const entry of state.lineupEntries) {
        if (entry.team_id === teamId && entry.player_id === playerId
            && entry.season === season && entry.week >= fromWeek && entry.slot === matchSlot) {
          entry.slot = toSlot;
          entry.ir_attested = false;
        }
      }
      return { rows: [] };
    }],
    // --- removeLineupEntries (#197) ---------------------------------------
    [/^SELECT "nfl_team" FROM "players"/, (text, [playerId]) => ({
      rows: [{ nfl_team: NFL_TEAM.get(playerId) }],
    })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, (text, [season, week, now]) => ({
      rows: state.nflGames
        .filter((g) => g.season === season && g.week === week
          && new Date(g.kickoff_at) <= new Date(now))
        .map((g) => ({ nfl_team: g.nfl_team })),
    })],
    [/^DELETE FROM "lineup_entries"/, (text, [teamId, playerId, season, week, removeCurrent]) => {
      const before = state.lineupEntries.length;
      state.lineupEntries = state.lineupEntries.filter((e) => !(
        e.team_id === teamId && e.player_id === playerId && e.season === season
        && (e.week > week || (e.week === week && removeCurrent))
      ));
      return { rows: [], rowCount: before - state.lineupEntries.length };
    }],

    // --- scoreMatchups -----------------------------------------------------
    [/^SELECT \* FROM "leagues"/, () => ({ rows: [{ ...state.league }] })],
    [/^SELECT \* FROM "matchups"/, (text, params) => {
      const [leagueId, season, week] = params;
      return {
        rows: state.matchups
          .filter((m) => m.league_id === leagueId && m.season === season
            && (week === undefined || m.week === week))
          .map((m) => ({ ...m })),
      };
    }],
    [/^SELECT "lineup_entries"\."player_id", "lineup_entries"\."slot"/, (text, [teamId, season, week]) => ({
      rows: scoringRows(text, teamId, week).map((e) => ({
        player_id: e.player_id,
        slot: e.slot,
        position: POSITION.get(e.player_id),
        stats: WEEK_STATS.get(e.player_id) || null,
      })),
    })],
    [/^SELECT "player_stats"\."stats"/, (text, [teamId, season, week]) => ({
      rows: scoringRows(text, teamId, week)
        .filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR')
        .filter((e) => WEEK_STATS.has(e.player_id)) // an inner JOIN drops a statless row
        .map((e) => ({ stats: WEEK_STATS.get(e.player_id), player_id: e.player_id })),
    })],
    [/^UPDATE "matchups" SET "home_score"/, (text, [homeScore, awayScore, id]) => {
      const matchup = state.matchups.find((m) => m.id === id);
      matchup.home_score = homeScore;
      matchup.away_score = awayScore;
      return { rows: [] };
    }],

    // --- finalizeWeekAndAdvance -------------------------------------------
    [/^SELECT "id", "name", "owner_id" FROM "teams"/, () => ({
      rows: state.teams.map((t) => ({ ...t })),
    })],
    [/^UPDATE "matchups" SET "final"/, (text, [leagueId, season, week]) => {
      for (const m of state.matchups) {
        if (m.league_id === leagueId && m.season === season && m.week === week) m.final = true;
      }
      return { rows: [] };
    }],
    [/^INSERT INTO "matchups"/, (text, [leagueId, season, week, home, away, round]) => {
      state.matchups.push({
        id: 900 + state.matchups.length,
        league_id: leagueId,
        season,
        week,
        home_team_id: home,
        away_team_id: away,
        final: false,
        home_score: 0,
        away_score: 0,
        is_playoff: true,
        is_consolation: false,
        playoff_round: round || 1,
      });
      return { rows: [] };
    }],
    [/^UPDATE "leagues" SET "season_status" = 'playoffs'/, (text, [nextWeek]) => {
      state.league.season_status = 'playoffs';
      state.league.current_week = nextWeek;
      return { rows: [] };
    }],
    [/^UPDATE "leagues" SET "current_week"/, (text, [nextWeek]) => {
      state.league.current_week = nextWeek;
      return { rows: [] };
    }],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({
      rows: state.teams.map((t) => ({ owner_id: t.owner_id })),
    })],
    [/^INSERT INTO "notifications"/, (text, params) => {
      state.notifications.push(params);
      return { rows: [] };
    }],
  ];

  return { state, fake: createFakePool(handlers), entriesFor };
}

/**
 * The real advance-week sequence, in the route's order: read (season, week)
 * BEFORE anything moves, score the closing week with settle semantics, then
 * finalize. The read is pinned here for the same reason the route pins it -
 * finalize advances current_week, so a pass keyed to current_week afterwards
 * would settle the wrong week.
 */
async function advanceWeek(state) {
  const season = state.league.current_season;
  const week = state.league.current_week;
  const scored = await scoreMatchups({ leagueId: LEAGUE_ID, season, week, settle: true });
  const advance = await finalizeWeekAndAdvance({ leagueId: LEAGUE_ID });
  return { scored, advance };
}

/** A post-game (or pre-kickoff) acquisition: roster row, then the bench rule. */
async function acquire(fake, state, { teamId = TEAM_B, playerId = ACQUIRED, at = AFTER_GAMES } = {}) {
  state.teamPlayers.push({ team_id: teamId, player_id: playerId, created_at: at });
  const client = await fake.connect();
  await benchAcquiredPlayer(client, { league: state.league, teamId, playerId });
  client.release();
}

/** A drop: the roster row goes, then #197 decides the lineup row's fate. */
async function drop(fake, state, { teamId = TEAM_B, playerId = QB_B, at = AFTER_GAMES } = {}) {
  state.teamPlayers = state.teamPlayers
    .filter((tp) => !(tp.team_id === teamId && tp.player_id === playerId));
  const client = await fake.connect();
  const result = await removeLineupEntries(client, {
    league: state.league, teamId, playerId, now: new Date(at),
  });
  client.release();
  return result;
}

const scoreOf = (state, side, id = 90) => Number(state.matchups.find((m) => m.id === id)[side]);
const awayScoreOf = (state) => scoreOf(state, 'away_score');
const homeScoreOf = (state) => scoreOf(state, 'home_score');

/* ------------------------------------------------------------------ *
 * The pair that pulls in opposite directions                          *
 * ------------------------------------------------------------------ */

test('#190 standard: a starter dropped AFTER his game keeps his points in the score of record', async (t) => {
  const world = createWorld();
  world.fake.install(t);

  // Team B played week 8 with its QB, who scored 10.
  const dropped = await drop(world.fake, world.state);
  assert.equal(dropped.removedCurrentWeek, false,
    '#197: his game had kicked off, so the week-8 row stays - he was on the roster at kickoff');
  assert.deepEqual(
    world.entriesFor(TEAM_B, SEASON, WEEK).map((e) => e.player_id),
    [QB_B],
    'the row that carries his points survives the drop'
  );

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 10,
    'the score of record is the week as played: dropping him afterwards cannot erase his points');
  assert.equal(homeScoreOf(world.state), 8, 'the opponent is untouched');
  assert.equal(world.state.matchups[0].final, true, 'and the week is closed on that number');
  world.fake.assertClean();
});

test('#190 best ball: a player acquired AFTER his game is excluded from the score of record', async (t) => {
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, WEEK).find((e) => e.player_id === ACQUIRED).slot,
    'BENCH',
    'the acquisition benches him in the still-open week, which best ball counts anyway'
  );

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 10,
    'his 30 points were earned for someone else after the whistle and must not settle here');
  world.fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * Standard-league acquisition, with #97 / PR #102 preserved           *
 * ------------------------------------------------------------------ */

test('#190 standard: a post-game acquisition is excluded even from a STARTING slot', async (t) => {
  // He started at RB for team B back in week 7, so materializeLineup's
  // copy-forward hands him a STARTING slot in week 8 - which is exactly what
  // a standard league counts. Without the settle rule he is paid for it.
  // This is the standard-league twin of the best-ball test above: best ball
  // needs no such help, which is why the two leagues need separate fixtures.
  const world = createWorld({
    lineupEntries: [
      { team_id: TEAM_A, player_id: QB_A, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
      { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
      { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: 7, slot: 'QB', ir_attested: false },
      { team_id: TEAM_B, player_id: ACQUIRED, season: SEASON, week: 7, slot: 'RB', ir_attested: false },
    ],
  });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, WEEK).find((e) => e.player_id === ACQUIRED).slot,
    'RB',
    'the copy-forward really does seat him as a starter in the closing week'
  );

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 10, 'the starting slot is not enough: he was acquired after kickoff');
  world.fake.assertClean();
});

test('#190 standard: excluding a post-game acquisition still leaves him benched next week', async (t) => {
  // #97 / PR #102: an acquisition lands on the bench, and the settle pass
  // must not cost him that. Kept separate from the test above because that
  // one gives him week-7 history on purpose, and materializeLineup's
  // copy-forward would then carry the RB slot into week 9 - which is the
  // copy-forward's own behaviour, not anything #190 decides.
  const world = createWorld();
  world.fake.install(t);

  await acquire(world.fake, world.state);
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, WEEK).find((e) => e.player_id === ACQUIRED).slot,
    'BENCH',
    'the acquisition benches him in the closing week'
  );

  await advanceWeek(world.state);
  assert.equal(awayScoreOf(world.state), 10, 'and a benched acquisition scores nothing either way');

  const client = await world.fake.connect();
  await materializeLineup(client, { leagueId: LEAGUE_ID, teamId: TEAM_B, season: SEASON, week: WEEK + 1 });
  client.release();
  const nextWeek = world.entriesFor(TEAM_B, SEASON, WEEK + 1);
  assert.deepEqual(nextWeek.map((e) => e.player_id).sort(), [QB_B, ACQUIRED].sort());
  assert.equal(nextWeek.find((e) => e.player_id === ACQUIRED).slot, 'BENCH',
    'excluding him from last week must not cost him his bench spot in this one');
  world.fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * Controls: the cutoff is the KICKOFF, not the advance                *
 * ------------------------------------------------------------------ */

test('#190 control: a drop made BEFORE kickoff is reflected normally', async (t) => {
  const world = createWorld();
  world.fake.install(t);

  const dropped = await drop(world.fake, world.state, { at: BEFORE_KICKOFF });
  assert.equal(dropped.removedCurrentWeek, true,
    '#197: his game had not kicked off, so the week-8 row goes with the roster row');
  assert.deepEqual(world.entriesFor(TEAM_B, SEASON, WEEK), [],
    'no surviving row means he was not on the roster at kickoff');

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 0,
    'a player dropped before his game does not score for the team that let him go');
  world.fake.assertClean();
});

test('#190 control: a player acquired BEFORE kickoff scores normally', async (t) => {
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state, { at: BEFORE_KICKOFF });

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 40,
    "he was on the roster when his game started, so his 30 points are the team's");
  world.fake.assertClean();
});

test('#190 control: a player with no game row that week is never excluded', async (t) => {
  // The bye / unsynced-schedule case: the Ghosts have no nfl_games row, so
  // there is no kickoff to be after. This matches the lock rule's "empty
  // schedule means nothing is locked" rather than inventing a cutoff.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state, { playerId: BYE_MAN, at: AFTER_GAMES });

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 22,
    'no game row is not a kickoff he can be after; he scores exactly as before');
  world.fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * Playoff seeding reads the settled scores                            *
 * ------------------------------------------------------------------ */

test('#190 the playoff bracket is seeded from the SETTLED scores, not the live ones', async (t) => {
  // Week 8 is the last regular-season week. Team B's QB is dropped after his
  // game. Live scoring would hand team B a 0 and flip both its result and its
  // seed; the settled 10 wins the game and seeds the bracket differently.
  //
  //   settled: C 1-0 (20 pf), B 1-0 (10), A 0-1 (8), D 0-1 (5)  -> C v D, B v A
  //   live:    C 1-0 (20), A 1-0 (8), D 0-1 (5), B 0-1 (0)      -> C v B, A v D
  const world = createWorld({
    regularSeasonWeeks: WEEK,
    teams: [
      { id: TEAM_A, name: 'Team A', owner_id: 101 },
      { id: TEAM_B, name: 'Team B', owner_id: 102 },
      { id: TEAM_C, name: 'Team C', owner_id: 103 },
      { id: TEAM_D, name: 'Team D', owner_id: 104 },
    ],
    // C and D field real starters: the settle pass scores EVERY matchup in
    // the week, so a hand-written score on their row would just be overwritten.
    teamPlayers: [
      { team_id: TEAM_A, player_id: QB_A, created_at: BEFORE_KICKOFF },
      { team_id: TEAM_B, player_id: QB_B, created_at: BEFORE_KICKOFF },
      { team_id: TEAM_C, player_id: QB_C, created_at: BEFORE_KICKOFF },
      { team_id: TEAM_D, player_id: QB_D, created_at: BEFORE_KICKOFF },
    ],
    lineupEntries: [
      { team_id: TEAM_A, player_id: QB_A, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
      { team_id: TEAM_B, player_id: QB_B, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
      { team_id: TEAM_C, player_id: QB_C, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
      { team_id: TEAM_D, player_id: QB_D, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
    ],
    matchups: [
      {
        id: 90, league_id: LEAGUE_ID, season: SEASON, week: WEEK,
        home_team_id: TEAM_A, away_team_id: TEAM_B, final: false,
        home_score: 0, away_score: 0, is_playoff: false, is_consolation: false, playoff_round: null,
      },
      {
        id: 91, league_id: LEAGUE_ID, season: SEASON, week: WEEK,
        home_team_id: TEAM_C, away_team_id: TEAM_D, final: false,
        home_score: 0, away_score: 0, is_playoff: false, is_consolation: false, playoff_round: null,
      },
    ],
  });
  world.fake.install(t);

  await drop(world.fake, world.state);
  const { advance } = await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 10, 'team B settles at 10, so it WON week 8');
  assert.equal(advance.seasonStatus, 'playoffs');

  const bracket = world.state.matchups
    .filter((m) => m.is_playoff)
    .map((m) => [m.home_team_id, m.away_team_id]);
  assert.deepEqual(bracket, [[TEAM_C, TEAM_D], [TEAM_B, TEAM_A]],
    'seeds 1-4 are C, B, A, D from the settled standings (live scoring would pair C v B and A v D)');
  world.fake.assertClean();
});

/* -------------------------------------------------------------------- *
 * The settle pass is a pass, not a mode: the other paths are untouched  *
 * -------------------------------------------------------------------- */

test('#190 without settle, an open week still materializes and still joins the current roster', async (t) => {
  // The live scheduler path and the manual /score route land here. Same
  // fixture as the best-ball settle test, one flag flipped.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  assert.equal(awayScoreOf(world.state), 40,
    'live scoring counts the current roster, exactly as it did before #190');
  assert.equal(
    world.fake.matching(/^SELECT "lineup_entries"\."player_id" FROM "lineup_entries"/).length,
    0,
    "and it never asks the settle pass's question"
  );
  world.fake.assertClean();
});

test('#190 the settle pass neither materializes nor joins the live roster', async (t) => {
  const world = createWorld();
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });

  assert.equal(world.fake.matching(/^SELECT "team_players"\."player_id"/).length, 0,
    "no materializeLineup call: the week's rows are the population");
  const [scoring] = world.fake.matching(/^SELECT "player_stats"\."stats"/);
  assert.ok(scoring, 'the standard scoring query ran');
  assert.doesNotMatch(scoring.text, /JOIN "team_players"/,
    "and it does not filter the week through today's roster");
  world.fake.assertClean();
});

test('#190 the exclusion reads team_players.created_at against nfl_games.kickoff_at', async (t) => {
  // The world answers this probe from its own arrays, so on its own it would
  // keep passing even if the production SQL asked a different question. Pin
  // the statement so the rule's two timestamps are the ones actually read,
  // and so nobody quietly substitutes lineup_entries.created_at.
  const world = createWorld();
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });

  const [probe] = world.fake.matching(/^SELECT "lineup_entries"\."player_id" FROM "lineup_entries"/);
  assert.ok(probe, 'the settle pass must ask which players were acquired after kickoff');
  assert.match(probe.text, /"team_players"\."created_at" > "nfl_games"\."kickoff_at"/,
    'acquisition time is the roster row, kickoff is the NFL schedule');
  assert.doesNotMatch(probe.text, /"lineup_entries"\."created_at"/,
    'a lineup row is written whenever the week is first materialized, not when the player arrived');
  assert.deepEqual(probe.params, [TEAM_A, SEASON, WEEK], 'team, season, week');
  world.fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * The route wiring                                                    *
 * ------------------------------------------------------------------ */

const { signToken } = require('../modules/auth');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'settle-score-of-record-test-secret';
test.after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

test('#190 advance-week asks for settle semantics, pinned to the week it is closing', async (t) => {
  const scoring = require('../services/scoring.service');
  const season = require('../services/season.service');
  const montecarlo = require('../services/montecarlo.service');

  const app = express();
  app.use(express.json());
  app.use('/api/scoring', require('../routes/scoring.router'));

  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    if (/"pickem_only" FROM "leagues"/.test(text)) return { rows: [{ pickem_only: false }] };
    if (/SELECT 1 FROM "leagues"/.test(text)) return { rows: [{ ok: 1 }] }; // commissioner
    if (/"current_season", "current_week" FROM "leagues"/.test(text)) {
      return { rows: [{ current_season: SEASON, current_week: WEEK }] };
    }
    throw new Error(`unexpected query: ${text}`);
  });

  const scoreCalls = [];
  t.mock.method(scoring, 'scoreMatchups', async (args) => {
    scoreCalls.push(args);
    return { scored: [] };
  });
  const finalizeCalls = [];
  t.mock.method(season, 'finalizeWeekAndAdvance', async (args) => {
    finalizeCalls.push({ args, scoredBefore: scoreCalls.length });
    return { advancedTo: WEEK + 1, seasonStatus: 'regular' };
  });
  // The post-week analytics chain is fire-and-forget display data; keep it
  // out of this test's way rather than letting it reach the mocked pool.
  t.mock.method(montecarlo, 'computeLeagueOdds', async () => { throw new Error('stopped'); });
  t.mock.method(console, 'error', () => {});

  const res = await request(app)
    .post(`/api/scoring/league/${LEAGUE_ID}/advance-week`)
    .set('Authorization', `Bearer ${signToken({ id: 101, username: 'commish' })}`)
    .send({});

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(scoreCalls.length, 1, 'the closing week is scored exactly once');
  assert.equal(scoreCalls[0].settle, true, 'and with settle semantics, not the live path');
  assert.equal(scoreCalls[0].season, SEASON);
  assert.equal(scoreCalls[0].week, WEEK, 'pinned to the week being closed');
  assert.equal(finalizeCalls.length, 1);
  assert.equal(finalizeCalls[0].scoredBefore, 1,
    'score THEN finalize: the bracket is seeded from scores that already exist');
});

/* ------------------------------------------------------------------ *
 * The docstring names all three populations                           *
 * ------------------------------------------------------------------ */

test('#190 the scoreMatchups docstring describes three populations', () => {
  // There are three after this change, and a reader who finds two will read
  // the third as a bug. Pin them so a fourth cannot arrive unannounced.
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'scoring.service.js'),
    'utf8'
  );
  const docstring = source.slice(0, source.indexOf('async function scoreMatchups'));
  const comment = docstring.slice(docstring.lastIndexOf('/**'));
  for (const population of ['Live', 'Settle', 'Final']) {
    assert.match(comment, new RegExp(`- \\*?${population} `, 'i'),
      `the docstring must describe the ${population} population`);
  }
});
