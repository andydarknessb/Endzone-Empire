const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const { createFakePool } = require('./helpers/fakePool');
const { tenureHandlers, tenure } = require('./helpers/tenureFakes');
const pool = require('../modules/pool');
const {
  benchAcquiredPlayer,
  removeLineupEntries,
  materializeLineup,
} = require('../services/lineup.service');
const { scoreMatchups } = require('../services/scoring.service');
const { finalizeWeekAndAdvance } = require('../services/season.service');
const { correctLeagueWeek } = require('../services/correction.service');

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
 * row no TENURE of this team covered at its player's kickoff (#228).
 *
 * WHY A TENURE AND NOT A TIMESTAMP, because this ticket tried the timestamps
 * first and each one failed in its own way. `team_players.created_at` cannot
 * tell a re-acquisition from an acquisition; `lineup_entries.created_at`
 * depends on when the week happened to be materialized, which for an
 * untouched lineup is the first scheduler tick AFTER the week's first
 * kickoff; and the relational rule over both still read the CURRENT roster,
 * so cutting an excluded pickup a week later made it stop firing and handed
 * his points back on the next correction sweep. `roster_tenures` is appended
 * and closed and never rewritten, so it answers the same way at settle time,
 * at finality, and after any later roster move.
 *
 * THE EXCLUSION IS ONE RULE ON TWO POPULATIONS - settle and final - which is
 * why the last two tests in the "survives a re-score" section exist. An
 * exclusion applied only while settling is undone by the first stat
 * correction after the advance, because nothing deletes the excluded row and
 * `correction.service` re-scores final weeks with no `settle` flag.
 *
 * The world below is a small stateful fake in the shape of
 * finalWeekFreeze.test.js: `lineup_entries`, `team_players`, `roster_tenures`,
 * `nfl_games` and `matchups` are real mutable arrays, so a drop or an
 * acquisition is visible to the settle pass that follows it. Tenures are
 * seeded EXPLICITLY (`heldSince` stays null): this suite is about the tenure
 * predicate, so nothing may be held unless a case says so - see the warning
 * at the top of helpers/tenureFakes.js.
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
const THURSDAY_MAN = 8; // QB, 10.0 points, whose game kicks off on THURSDAY

// The one timeline every test reads. Most NFL games in the fixture kick off
// at KICKOFF, so "before" and "after" mean before and after the week's games.
const KICKOFF = '2026-10-25T17:00:00.000Z';
const BEFORE_KICKOFF = '2026-10-24T12:00:00.000Z';
const AFTER_GAMES = '2026-10-25T23:30:00.000Z';
const LATER_STILL = '2026-10-25T23:45:00.000Z';
const HELD_ALL_SEASON = '2026-10-01T00:00:00.000Z';

// The Thursday game, and the moment the scheduler first materializes an
// untouched lineup: its first tick AFTER the week's first kickoff. For a
// Thursday player that instant is already past his own kickoff, which is why
// `lineup_entries.created_at` could never be read against kickoff on its own.
const THURSDAY_KICKOFF = '2026-10-22T00:20:00.000Z';
const FIRST_MATERIALIZE = '2026-10-25T17:05:00.000Z';

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
  [THURSDAY_MAN, 'Ravens'],
]);

const POSITION = new Map([
  [QB_A, 'QB'],
  [QB_B, 'QB'],
  [ACQUIRED, 'RB'],
  [BYE_MAN, 'RB'],
  [QB_C, 'QB'],
  [QB_D, 'QB'],
  [THURSDAY_MAN, 'QB'],
]);

const WEEK_STATS = new Map([
  [QB_A, { passingYards: 200 }], // 8.0
  [QB_B, { passingYards: 250 }], // 10.0
  [ACQUIRED, { rushingYards: 300 }], // 30.0
  [BYE_MAN, { rushingYards: 120 }], // 12.0
  [QB_C, { passingYards: 500 }], // 20.0
  [QB_D, { passingYards: 125 }], // 5.0
  [THURSDAY_MAN, { passingYards: 250 }], // 10.0
]);

function createWorld({
  bestBall = false,
  teams = [
    { id: TEAM_A, name: 'Team A', owner_id: 101 },
    { id: TEAM_B, name: 'Team B', owner_id: 102 },
  ],
  teamPlayers = [
    { team_id: TEAM_A, player_id: QB_A },
    { team_id: TEAM_B, player_id: QB_B },
  ],
  // Explicit, always. The default pairs one open tenure held since well
  // before kickoff with each default roster row, which is the ordinary case
  // these fixtures are built on; a test about the predicate says otherwise.
  tenures = [
    tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
    tenure(TEAM_B, QB_B, new Date(HELD_ALL_SEASON)),
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
    tenures,
    lineupEntries,
    // One row per NFL team per week, as the real table is. The Ghosts are
    // absent on purpose: that is the bye / unsynced-schedule case.
    nflGames: [
      { season: SEASON, week: WEEK, nfl_team: 'Chiefs', kickoff_at: KICKOFF },
      { season: SEASON, week: WEEK, nfl_team: 'Bills', kickoff_at: KICKOFF },
      { season: SEASON, week: WEEK, nfl_team: 'Eagles', kickoff_at: KICKOFF },
      { season: SEASON, week: WEEK, nfl_team: 'Ravens', kickoff_at: THURSDAY_KICKOFF },
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
    transactions: [],
    // The wall clock a lineup-row INSERT stamps into created_at. The rule no
    // longer reads it - that is the point of #228 - but materializeLineup's
    // ON CONFLICT DO NOTHING still preserves it, and a couple of tests below
    // assert on that to show the row really did survive rather than being
    // recreated.
    clock: AFTER_GAMES,
  };
  for (const entry of state.lineupEntries) {
    if (entry.created_at === undefined) entry.created_at = BEFORE_KICKOFF;
  }

  // The schedule as `playersNotHeldAtKickoff` reads it: team -> kickoff. A
  // team absent from it has no game that week and can never be excluded.
  const schedule = Object.fromEntries(
    state.nflGames
      .filter((g) => g.season === SEASON && g.week === WEEK)
      .map((g) => [g.nfl_team, new Date(g.kickoff_at)])
  );

  const entriesFor = (teamId, season, week) =>
    state.lineupEntries.filter((e) => e.team_id === teamId && e.season === season && e.week === week);
  const rosterRow = (teamId, playerId) =>
    state.teamPlayers.find((tp) => tp.team_id === teamId && tp.player_id === playerId);

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

    // --- the tenure predicate and the schedule read behind it (#228) -------
    // Shared with the removal suites on purpose: the predicate lives in SQL,
    // so one re-implementation drifts once or not at all. It reads the
    // operators OUT of the emitted statement, so mutating `<=` or `>` in
    // production changes what these return - which is what makes a mutation
    // run on this suite mean anything at all.
    ...tenureHandlers({ schedule, tenures: state.tenures, heldSince: null }),

    // --- the lineup lock's own schedule read -------------------------------
    [/^SELECT "nfl_team" FROM "nfl_games"/, (text, [season, week, at]) => ({
      rows: state.nflGames
        .filter((g) => g.season === season && g.week === week
          && new Date(g.kickoff_at).getTime() <= new Date(at).getTime())
        .map((g) => ({ nfl_team: g.nfl_team })),
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
    // ON CONFLICT DO NOTHING: an existing row keeps its original created_at,
    // so a survived row can still be told from a freshly written one.
    [/^INSERT INTO "lineup_entries"/, (text, [, teamId, playerId, season, week, slot, irAttested]) => {
      const clash = entriesFor(teamId, season, week).some((e) => e.player_id === playerId);
      if (!clash) {
        state.lineupEntries.push({
          team_id: teamId, player_id: playerId, season, week, slot, ir_attested: irAttested,
          created_at: state.clock,
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
    // Best ball's candidate read.
    [/^SELECT "lineup_entries"\."player_id", "lineup_entries"\."slot"/, (text, [teamId, season, week]) => ({
      rows: scoringRows(text, teamId, week).map((e) => ({
        player_id: e.player_id,
        slot: e.slot,
        position: POSITION.get(e.player_id),
        nfl_team: NFL_TEAM.get(e.player_id),
        stats: WEEK_STATS.get(e.player_id) || null,
      })),
    })],
    // The standard league's starter read. `nfl_team` rides along because the
    // exclusion maps each row onto its game through lineup.service.
    [/^SELECT "lineup_entries"\."player_id", "players"\."nfl_team"/, (text, [teamId, season, week]) => ({
      rows: scoringRows(text, teamId, week)
        .filter((e) => e.slot !== 'BENCH' && e.slot !== 'IR')
        .filter((e) => WEEK_STATS.has(e.player_id)) // an inner JOIN drops a statless row
        .map((e) => ({
          player_id: e.player_id,
          nfl_team: NFL_TEAM.get(e.player_id),
          stats: WEEK_STATS.get(e.player_id),
        })),
    })],
    [/^UPDATE "matchups" SET "home_score"/, (text, [homeScore, awayScore, id]) => {
      const matchup = state.matchups.find((m) => m.id === id);
      matchup.home_score = homeScore;
      matchup.away_score = awayScore;
      return { rows: [] };
    }],

    // --- correctLeagueWeek's before/after snapshots (on the POOL) ----------
    [/^SELECT "id", "week", "final", "is_playoff", "home_score", "away_score" FROM "matchups"/,
      (text, [leagueId, season, week]) => ({
        rows: state.matchups
          .filter((m) => m.league_id === leagueId && m.season === season && m.week === week)
          .map(({ id, week: w, final, is_playoff, home_score, away_score }) => ({
            id, week: w, final, is_playoff, home_score, away_score,
          })),
      })],
    [/^SELECT "id", "home_score", "away_score" FROM "matchups"/, (text, [leagueId, season, week]) => ({
      rows: state.matchups
        .filter((m) => m.league_id === leagueId && m.season === season && m.week === week)
        .map(({ id, home_score, away_score }) => ({ id, home_score, away_score })),
    })],
    [/^INSERT INTO "transactions"/, (text, params) => {
      state.transactions.push(params);
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
    [/^SELECT "owner_id" FROM "leagues"/, () => ({ rows: [{ owner_id: state.league.owner_id }] })],
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

/**
 * An acquisition: the roster row, the tenure the TRIGGER would open with it
 * (ADR 0006 - fakes do not run triggers, so the seam is modelled here), then
 * the bench rule. One transaction in production, so one instant here.
 */
async function acquire(fake, state, { teamId = TEAM_B, playerId = ACQUIRED, at = AFTER_GAMES } = {}) {
  state.clock = at;
  state.teamPlayers.push({ team_id: teamId, player_id: playerId });
  state.tenures.push(tenure(teamId, playerId, new Date(at)));
  const client = await fake.connect();
  await benchAcquiredPlayer(client, { league: state.league, teamId, playerId });
  client.release();
}

/**
 * A drop: the roster row goes and the trigger CLOSES the open tenure, then
 * #197 decides the lineup row's fate. The close happens FIRST because that is
 * the real order - the roster row is deleted before `removeLineupEntries`
 * runs - and because a closed tenure is exactly what the spare must still be
 * able to see.
 */
async function drop(fake, state, { teamId = TEAM_B, playerId = QB_B, at = AFTER_GAMES } = {}) {
  state.teamPlayers = state.teamPlayers
    .filter((tp) => !(tp.team_id === teamId && tp.player_id === playerId));
  for (const row of state.tenures) {
    if (row.teamId === teamId && row.playerId === playerId && row.releasedAt === null) {
      row.releasedAt = new Date(at);
    }
  }
  const client = await fake.connect();
  const result = await removeLineupEntries(client, {
    league: state.league,
    teamId,
    playerId,
    now: new Date(at),
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
    '#197: his game had kicked off and his tenure covered it, so the week-8 row stays');
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

  assert.equal(awayScoreOf(world.state), 10, 'the starting slot is not enough: no tenure covered his kickoff');
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
 * The first escalation's case, and the hole that sank its candidate   *
 * ------------------------------------------------------------------ */

test('#190 a starter dropped after his game and RE-ADDED still counts', async (t) => {
  // The first escalation. He was held at kickoff and played. The drop closes
  // that tenure and leaves his row standing; the re-add opens a SECOND
  // tenure, stamped now - after kickoff. A rule reading only the roster row
  // cannot tell this from a fresh pickup and deletes the points of a man who
  // played. The closed tenure still covers kickoff, so the tenure rule can.
  const world = createWorld();
  world.fake.install(t);

  await drop(world.fake, world.state);
  await acquire(world.fake, world.state, { playerId: QB_B, at: LATER_STILL });

  assert.equal(
    world.entriesFor(TEAM_B, SEASON, WEEK).find((e) => e.player_id === QB_B).created_at,
    BEFORE_KICKOFF,
    'the surviving row keeps its original timestamp: ON CONFLICT DO NOTHING preserved it'
  );
  assert.equal(world.state.tenures.filter((r) => r.playerId === QB_B).length, 2,
    'two tenures now: the one that covered kickoff, and the one opened by the re-add');

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 10,
    'a tenure of this team covered his kickoff, and closing it did not erase it');
  world.fake.assertClean();
});

test('#190 the Thursday player on an untouched lineup counts when dropped and re-added', async (t) => {
  // The hole in the relational candidate that preceded #228. The scheduler
  // first materializes an untouched lineup on its first tick AFTER the week's
  // first kickoff, so for a Thursday player that row is ALREADY stamped after
  // his own kickoff. Both timestamps then sit after it and every rule built
  // on them excludes a man held since October. The tenure does not care when
  // the row was written.
  const world = createWorld({
    teamPlayers: [
      { team_id: TEAM_A, player_id: QB_A },
      { team_id: TEAM_B, player_id: THURSDAY_MAN },
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, THURSDAY_MAN, new Date(HELD_ALL_SEASON)),
    ],
    lineupEntries: [
      { team_id: TEAM_A, player_id: QB_A, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
      {
        team_id: TEAM_B, player_id: THURSDAY_MAN, season: SEASON, week: WEEK,
        slot: 'QB', ir_attested: false, created_at: FIRST_MATERIALIZE,
      },
    ],
  });
  world.fake.install(t);

  assert.ok(
    new Date(FIRST_MATERIALIZE) > new Date(THURSDAY_KICKOFF),
    'the fixture is the real trap: his lineup row postdates his own kickoff'
  );

  await drop(world.fake, world.state, { playerId: THURSDAY_MAN });
  await acquire(world.fake, world.state, { playerId: THURSDAY_MAN, at: LATER_STILL });

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 10,
    'held since October and played on Thursday: his points are the score of record');
  world.fake.assertClean();
});

test('#190 dropped BEFORE kickoff and re-added after is excluded', async (t) => {
  // The mirror of the case above. This row does NOT survive, because #197
  // deletes a current-week row when the game has not started, and the tenure
  // that would have covered kickoff was closed before it. He was not on the
  // roster when the game kicked off.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  const dropped = await drop(world.fake, world.state, { at: BEFORE_KICKOFF });
  assert.equal(dropped.removedCurrentWeek, true, 'his game had not started, so the row went');

  await acquire(world.fake, world.state, { playerId: QB_B, at: AFTER_GAMES });
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, WEEK).find((e) => e.player_id === QB_B).created_at,
    AFTER_GAMES,
    'the row is new, not inherited'
  );

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 0,
    'the first tenure closed before kickoff and the second opened after it');
  world.fake.assertClean();
});

test('#190 acquired after kickoff, dropped, then re-added is still excluded', async (t) => {
  // Under the retired rule this needed a special tightening of #197's spare,
  // because the first drop would spare his row purely because his game had
  // kicked off. The tenure answers it directly: the spare asks whether a
  // tenure covered kickoff, and none did, so the row goes and nothing is left
  // for the re-add to inherit.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  const dropped = await drop(world.fake, world.state, { playerId: ACQUIRED, at: AFTER_GAMES });
  assert.equal(dropped.removedCurrentWeek, true,
    'his tenure began after kickoff, so his row is not a record of the week');
  assert.equal(
    world.entriesFor(TEAM_B, SEASON, WEEK).find((e) => e.player_id === ACQUIRED),
    undefined,
    'and there is nothing left for a re-add to inherit'
  );

  await acquire(world.fake, world.state, { playerId: ACQUIRED, at: LATER_STILL });

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 10, 'he never played a down for this team this week');
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
  // there is no kickoff for a tenure to have covered. He never enters the
  // question at all, which matches the lock rule's reading of an empty
  // schedule rather than inventing a cutoff.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state, { playerId: BYE_MAN, at: AFTER_GAMES });

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 22,
    'no game row is not a kickoff he can be after; he scores exactly as before');
  world.fake.assertClean();
});

/* ------------------------------------------------------------------ *
 * The second escalation: the settled score must SURVIVE a re-score    *
 * ------------------------------------------------------------------ */

test('#190 the settled score survives the next stat-correction sweep', async (t) => {
  // THE SECOND ESCALATION. The exclusion never deletes the row, so it is
  // still sitting in lineup_entries when the week goes final, and
  // `correction.service` re-scores final weeks with NO settle flag on every
  // correction day - reached from the scheduler's runDailyStatCorrections and
  // from POST /league/:id/score. If the exclusion is applied only while
  // settling, the number the league was told is quietly replaced by the one
  // this ticket exists to prevent, and ANNOUNCED as a stat correction.
  //
  // One rule on both populations is what makes this hold, and it holds by
  // construction rather than by the sweep happening to agree.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  await advanceWeek(world.state);
  assert.equal(awayScoreOf(world.state), 10, 'settled without the post-game pickup');
  assert.equal(world.state.matchups[0].final, true, 'and the week is final');

  const correction = await correctLeagueWeek({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  assert.equal(awayScoreOf(world.state), 10,
    'the score of record is the score of record: re-scoring a settled week returns it');
  assert.deepEqual(correction.changes, [],
    'so there is no correction to log and nothing to announce to the league');
  assert.equal(world.state.notifications.length, 0, 'no stat-correction notification');
  assert.equal(world.state.transactions.length, 0, 'and no transaction-log entry');
  world.fake.assertClean();
});

test('#190 the settled score survives a re-score after the excluded pickup is CUT', async (t) => {
  // THE CASE THAT SANK THE ALTERNATIVE FIX. Applying the same exclusion to
  // the final population is not enough on its own if the exclusion reads the
  // CURRENT ROSTER: cut the excluded pickup and his roster row goes, the rule
  // can no longer fire, and his points come back on the next sweep. That is
  // the ordinary life of a waiver pickup, not an edge case.
  //
  // The tenure is CLOSED here, not absent, and that is the whole point -
  // cutting him closes the tenure that failed to cover kickoff rather than
  // erasing it, so the answer cannot move.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  await advanceWeek(world.state);
  assert.equal(awayScoreOf(world.state), 10, 'settled without him');

  await drop(world.fake, world.state, { playerId: ACQUIRED, at: LATER_STILL });
  assert.equal(
    world.state.teamPlayers.find((tp) => tp.player_id === ACQUIRED),
    undefined,
    'his roster row is gone, so a roster-reading rule would have nothing left to test'
  );
  assert.ok(
    world.state.tenures.some((r) => r.playerId === ACQUIRED && r.releasedAt !== null),
    'but the tenure is closed rather than erased'
  );
  assert.ok(
    world.entriesFor(TEAM_B, SEASON, WEEK).some((e) => e.player_id === ACQUIRED),
    'and his week-8 row is still there to be counted: a settled week is never written into (#106)'
  );

  const correction = await correctLeagueWeek({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK });

  assert.equal(awayScoreOf(world.state), 10,
    'still the settled score, with the roster row that a proxy would have needed long gone');
  assert.deepEqual(correction.changes, [], 'and still nothing to announce');
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
    teamPlayers: [
      { team_id: TEAM_A, player_id: QB_A },
      { team_id: TEAM_B, player_id: QB_B },
      { team_id: TEAM_C, player_id: QB_C },
      { team_id: TEAM_D, player_id: QB_D },
    ],
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, QB_B, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_C, QB_C, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_D, QB_D, new Date(HELD_ALL_SEASON)),
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

  assert.equal(awayScoreOf(world.state), 10, 'team B settled on the week it actually played');
  assert.equal(advance.seasonStatus, 'playoffs');
  const bracket = world.state.matchups.filter((m) => m.is_playoff);
  assert.equal(bracket.length, 2, 'a four-team bracket');
  const pairs = bracket.map((m) => [m.home_team_id, m.away_team_id].sort((a, b) => a - b));
  assert.deepEqual(
    pairs.sort((a, b) => a[0] - b[0]),
    [[TEAM_A, TEAM_B].sort((a, b) => a - b), [TEAM_C, TEAM_D].sort((a, b) => a - b)]
      .sort((a, b) => a[0] - b[0]),
    'seeded from the settled standings: C v D and B v A, not the live C v B and A v D'
  );
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
  assert.equal(world.fake.matching(/FROM "roster_tenures"/).length, 0,
    'and an open week scored live never asks the tenure question');
  world.fake.assertClean();
});

test('#190 the settle pass neither materializes nor joins the live roster', async (t) => {
  // THE STRUCTURAL TRIPWIRE. Cheap, and it catches a join reappearing by any
  // route. It is NOT the guarantee - the test below is - because a filter
  // written some other way (a WHERE EXISTS, a join this pattern misses) would
  // break the behaviour while leaving this green. Keep both: this one fails
  // early and points at the mechanism, that one fails whenever the promise to
  // the league is broken. If one of them has to go, this is the one.
  const world = createWorld();
  world.fake.install(t);

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });

  assert.equal(world.fake.matching(/^SELECT "team_players"\."player_id"/).length, 0,
    "no materializeLineup call: the week's rows are the population");
  const [scoring] = world.fake.matching(/^SELECT "lineup_entries"\."player_id", "players"\."nfl_team"/);
  assert.ok(scoring, 'the standard scoring query ran');
  assert.doesNotMatch(scoring.text, /"team_players"/,
    "the settle population must not reach the roster table at all - not even a LEFT JOIN, "
    + 'which is what the retired proxy rule needed and the tenure rule does not');
  assert.deepEqual(scoring.params, [TEAM_A, SEASON, WEEK], 'team, season, week');
  world.fake.assertClean();
});

test('#190 a team with no rows for the week settles at 0 rather than materializing one', async (t) => {
  // The documented price of not re-materializing, pinned rather than only
  // described. Before #190 the advance would have built this team a
  // carried-forward or default-bench lineup and scored it; the settle pass
  // counts the week's existing rows, and there are none.
  //
  // This is deliberate, not an oversight: re-materializing IS the bug, since
  // it is what hands a post-game acquisition a row. In practice the
  // scheduler has already materialized the week - it live-scores every
  // league whose week has had a kickoff in the last 8 hours - so this
  // reaches 0 only for a week with no synced schedule that no manager ever
  // opened. If that trade is ever revisited, this test is the one to read.
  const world = createWorld({
    lineupEntries: [
      { team_id: TEAM_A, player_id: QB_A, season: SEASON, week: WEEK, slot: 'QB', ir_attested: false },
    ],
  });
  world.fake.install(t);

  assert.deepEqual(world.entriesFor(TEAM_B, SEASON, WEEK), [],
    'team B never opened its lineup and the week was never materialized for it');
  assert.ok(
    world.state.teamPlayers.some((tp) => tp.team_id === TEAM_B && tp.player_id === QB_B),
    'though it does hold a scoring player, which the live path would have seated'
  );

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });

  assert.equal(awayScoreOf(world.state), 0,
    'no rows for the week means nothing to count: the settle pass does not build him a lineup');
  assert.equal(homeScoreOf(world.state), 8, 'and the team that did play is scored normally');
  assert.equal(world.fake.matching(/^INSERT INTO "lineup_entries"/).length, 0,
    'and no row was written into the week while settling it');
  world.fake.assertClean();
});

test('#190 the settle population keeps dropped players in', async (t) => {
  // THE GUARANTEE, stated as behaviour rather than as SQL. A player dropped
  // after his game must still be counted, and this fails whenever that stops
  // being true however the population came to lose him. The tripwire above
  // names the mechanism; this one names the promise.
  const world = createWorld();
  world.fake.install(t);

  await drop(world.fake, world.state);
  assert.equal(
    world.state.teamPlayers.find((tp) => tp.team_id === TEAM_B && tp.player_id === QB_B),
    undefined,
    'he is off the roster before the pass runs'
  );

  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });

  assert.equal(awayScoreOf(world.state), 10,
    'a player with no roster row at all is still in the settled population, and still scores');
  world.fake.assertClean();
});

test('#190 the kickoff question goes through lineup.service\'s shared predicate', async (t) => {
  // Not a style point. DEF units carry full team names while nfl_games keys
  // by Tank01 abbreviation (#227), so if this pass matched teams its own way
  // it could exclude a player the lock rule considers unlocked - the two
  // halves disagreeing about the same man. One predicate, one fix.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state);
  await scoreMatchups({ leagueId: LEAGUE_ID, season: SEASON, week: WEEK, settle: true });

  const scheduleReads = world.fake.matching(/FROM "nfl_games"/);
  assert.ok(scheduleReads.length > 0, 'the schedule is consulted');
  for (const call of scheduleReads) {
    assert.match(call.text, /^SELECT "nfl_team", "kickoff_at" FROM "nfl_games"/,
      'every schedule read on this path is lineup.service\'s weekKickoffs, not a second one grown here');
    assert.deepEqual(call.params, [SEASON, WEEK]);
  }
  const [tenureRead] = world.fake.matching(/FROM "roster_tenures"/);
  assert.ok(tenureRead, 'and the exclusion is answered from the recorded tenure');
  world.fake.assertClean();
});

test('#190 a tenure beginning EXACTLY at kickoff counts, it did not begin after', async (t) => {
  // The boundary, carried over from a1a6dc2 and re-seeded onto the tenure.
  // "Held at kickoff" is `acquired_at <= kickoff_at`, so a tenure that began
  // at the kickoff instant was there when the game started. Every other
  // fixture in this file puts the tenure a day early or hours late, so this
  // is the only case that visits the instant where `<=` and `<` disagree -
  // and it fails on the SCORE, not on a statement match, so it still means
  // something when the fake's routing changes.
  const world = createWorld({ bestBall: true });
  world.fake.install(t);

  await acquire(world.fake, world.state, { at: KICKOFF });
  assert.equal(
    world.state.tenures.find((r) => r.playerId === ACQUIRED).acquiredAt.toISOString(),
    KICKOFF,
    'the fixture really does sit on the boundary'
  );

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 40,
    'acquired AT kickoff is not acquired after it, so his points are the team\'s');
  world.fake.assertClean();
});

test('#190 a tenure that ended exactly at kickoff does not count', async (t) => {
  // The other end of the same boundary: `released_at > kickoff_at`, strictly,
  // so a tenure that closed at the kickoff instant was already over when the
  // game began. Pins the second operator the way the test above pins the
  // first; without it, flipping `>` to `>=` changes nothing in this file.
  const world = createWorld({
    bestBall: true,
    tenures: [
      tenure(TEAM_A, QB_A, new Date(HELD_ALL_SEASON)),
      tenure(TEAM_B, QB_B, new Date(HELD_ALL_SEASON), new Date(KICKOFF)),
    ],
  });
  world.fake.install(t);

  await advanceWeek(world.state);

  assert.equal(awayScoreOf(world.state), 0,
    'his tenure was over the moment the game started, so the week was not his to score');
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
    if (/"current_season", "current_week"/.test(text)) {
      // The handler also selects the phase columns now (#194); this league is
      // mid-season with its draft done, which is the only state in which
      // advance-week does anything at all.
      return {
        rows: [{
          current_season: SEASON,
          current_week: WEEK,
          pickem_only: false,
          draft_status: 'complete',
          season_status: 'regular',
        }],
      };
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
