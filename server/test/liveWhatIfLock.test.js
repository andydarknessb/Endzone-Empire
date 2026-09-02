/**
 * The live advisor and the lock it advises against (#227).
 *
 * `liveWhatIf` exists to tell a manager what he could still DO, so it has to
 * agree with `setLineup` about who can still be moved. It used to answer that
 * itself, with `LEFT JOIN "nfl_games" ON "nfl_games"."nfl_team" =
 * "players"."nfl_team"` and a `locked` column derived from the joined
 * `kickoff_at`. A DEF unit's `players.nfl_team` is a full team name and
 * `nfl_games` keys by Tank01 abbreviation, so he joined to nothing, his
 * `kickoff_at` came back NULL, and he read UNLOCKED however long his game had
 * been over. The advisor would then offer a swap that `setLineup` refuses with
 * a 409 the manager cannot act on.
 *
 * That is the fifth kickoff-keyed consumer of the same broken comparison, and
 * it is not one #227's own list names - it was found by reviewing the diff
 * against the ticket's "every kickoff-keyed consumer uses it" line rather than
 * against its enumeration. Worth knowing when the next one turns up.
 *
 * These are the first tests this function has had, which is most of why the
 * join survived this long.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { liveWhatIf } = require('../services/decision.service');

const SEASON = 2026;
const WEEK = 8;
const LEAGUE_ID = 5;
const TEAM_ID = 10;

const DEF_STARTER = {
  player_id: 1, name: 'Denver Broncos', position: 'DEF', nfl_team: 'Denver Broncos',
};
const DEF_BENCH = {
  player_id: 2, name: 'Chicago Bears', position: 'DEF', nfl_team: 'Chicago Bears',
};

/**
 * @param entries   the team's lineup rows, each carrying the raw `stats` the
 *                  population query now returns (#739); the reader prices them
 *                  under the league's rules.
 * @param kickedOff the teams whose game has started, in the SCHEDULE's
 *                  vocabulary (Tank01 abbreviations). Never the player's own
 *                  `nfl_team` string: seeding the player's spelling into the
 *                  schedule is exactly what would make these tests prove
 *                  nothing about #227.
 * @param rosterSlots the league's starting slots (defaults to one DEF slot).
 * @param scoringRules the league's scoring_rules (defaults to the defaults).
 */
function whatIfWorld(t, {
  entries, kickedOff,
  rosterSlots = [{ key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] }],
  scoringRules = null,
}) {
  return createFakePool([
    [/^SELECT \* FROM "leagues"/, () => ({
      rows: [{
        id: LEAGUE_ID,
        current_season: SEASON,
        current_week: WEEK,
        roster_slots: rosterSlots,
        bench_slots: 5,
        ir_slots: 1,
        scoring_rules: scoringRules,
      }],
    })],
    [/^SELECT 1 FROM "teams"/, () => ({ rows: [{ ok: 1 }] })],
    // materializeLineup: a live week, already fully materialized.
    [/^SELECT 1 FROM "matchups".*"final" = true/, () => ({ rows: [] })],
    [/^SELECT "team_players"\."player_id"/, () => ({
      rows: entries.map(({ player_id, position }) => ({ player_id, position })),
    })],
    [/^SELECT "player_id" FROM "lineup_entries"/, () => ({
      rows: entries.map(({ player_id }) => ({ player_id })),
    })],
    [/^SELECT "lineup_entries"\."player_id"/, () => ({ rows: entries.map((e) => ({ ...e })) })],
    [/^SELECT "nfl_team" FROM "nfl_games"/, () => ({
      rows: kickedOff.map((nfl_team) => ({ nfl_team })),
    })],
  ]).install(t);
}

const runWhatIf = () => liveWhatIf({
  leagueId: LEAGUE_ID, teamId: TEAM_ID, season: SEASON, week: WEEK,
});

test('#227 liveWhatIf will not suggest moving a DEF unit whose game has kicked off', async (t) => {
  // The started DEF is scoring 2 and the benched one is scoring 20, so the
  // ONLY thing that can suppress this swap is the lock. The schedule spells
  // his team DEN; his own row says "Denver Broncos".
  const fake = whatIfWorld(t, {
    entries: [
      { ...DEF_STARTER, slot: 'DEF', stats: { sack: 2 } },
      { ...DEF_BENCH, slot: 'BENCH', stats: { sack: 20 } },
    ],
    kickedOff: ['DEN'],
  });

  const result = await runWhatIf();

  assert.deepEqual(result.swaps, [],
    'his game has started, so setLineup would refuse the move this used to advise');
  assert.equal(result.delta, 0);
  fake.assertClean();
});

test('#227 liveWhatIf still suggests the swap before the DEF unit kicks off', async (t) => {
  // The control, and the half a normalisation breaks just as easily: the fix
  // must make a DEF unit ORDINARY here, not permanently unsuggestible.
  const fake = whatIfWorld(t, {
    entries: [
      { ...DEF_STARTER, slot: 'DEF', stats: { sack: 2 } },
      { ...DEF_BENCH, slot: 'BENCH', stats: { sack: 20 } },
    ],
    kickedOff: [],
  });

  const result = await runWhatIf();

  assert.equal(result.swaps.length, 1, 'nobody has kicked off, so the upgrade is actionable');
  fake.assertClean();
});

test('#227 liveWhatIf asks lineup.service for the lock rather than joining the schedule itself', async (t) => {
  // Pinned to the emitted statements rather than to what a fake returned. The
  // advisor must carry NO `nfl_games` join of its own, or #227 has two places
  // to fix and they can drift apart again - which is how this one survived
  // the first four being found.
  const fake = whatIfWorld(t, {
    entries: [{ ...DEF_STARTER, slot: 'DEF', stats: { sack: 2 } }],
    kickedOff: ['DEN'],
  });

  await runWhatIf();

  const population = fake.matching(/FROM "lineup_entries" JOIN "players"/);
  assert.ok(population.length > 0, 'the population query ran');
  for (const call of population) {
    assert.doesNotMatch(call.text, /nfl_games/, 'and it joins no schedule of its own');
  }
  const scheduleReads = fake.matching(/FROM "nfl_games"/);
  assert.equal(scheduleReads.length, 1, 'exactly one schedule read on this path');
  assert.match(scheduleReads[0].text, /^SELECT "nfl_team" FROM "nfl_games"/,
    'and it is lineup.service\'s own lock predicate');
  fake.assertClean();
});

test('#739 liveWhatIf prices the live week under the league rules, not the stored column', async (t) => {
  // Full PPR. The bench RB's twenty catches make him worth 20 under the
  // league's rules but only 10 under the half-PPR default column. Under the
  // column he does not out-score the 10-point starter and no swap is offered;
  // under the league's rules he does, and the delta is league-priced. The
  // stats-versus-column split is the point (#739): a reader on the column
  // would return actualPoints 10 with zero swaps.
  const RB_STARTER = { player_id: 3, name: 'Rush RB', position: 'RB', nfl_team: 'Chiefs' };
  const RB_BENCH = { player_id: 4, name: 'PPR RB', position: 'RB', nfl_team: 'Eagles' };
  const fake = whatIfWorld(t, {
    rosterSlots: [{ key: 'RB', label: 'RB', count: 1, eligiblePositions: ['RB'] }],
    scoringRules: { receiving: { reception: 1 } },
    entries: [
      { ...RB_STARTER, slot: 'RB', stats: { rushingYards: 100 } }, // 10 under either rule
      { ...RB_BENCH, slot: 'BENCH', stats: { receptions: 20 } }, // default 10, full PPR 20
    ],
    kickedOff: [],
  });

  const result = await runWhatIf();

  assert.equal(result.actualPoints, 10, 'the starter, priced under the league rules');
  assert.equal(result.swaps.length, 1, 'full PPR makes the bench RB an upgrade the column would have hidden');
  assert.equal(result.swaps[0].in.points, 20, 'the bench RB is worth his twenty catches, not the column\'s ten');
  assert.equal(result.swaps[0].out.points, 10);
  assert.equal(result.delta, 10);
  fake.assertClean();
});
