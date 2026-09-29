const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const scoring = {
  ...require('../services/tank01Feed'),
  ...require('../services/boxScoreApply.service'),
  ...require('../services/scoringRules'),
};

/**
 * applyGameBoxScore's own behavior around the write: the scoring-event baseline
 * and the plays it emits. What the box line becomes (which keys it owns, what it
 * carries from the stored row) is the write module's ownership table, pinned once
 * in storedStatLine.test.js (#1760).
 */

const { STAT_KEY_OWNERSHIP } = require('../services/playerStatsWrite.service');

function stubUpserts(t) {
  const upserts = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    if (String(sql).includes('INTO "player_stats"')) {
      upserts.push(params);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  return upserts;
}

const ENRICHED_PRIOR = {
  rushingYards: 40,
  rushingTDs: 0,
  usageTargets: 7,
  usageCarries: 12,
  usageAirYards: null,
  gameTeam: 'KC',
  gameOpponent: 'BUF',
  idpSackYards: 9,
};

function playerMaps(prevStats) {
  return {
    idByExternal: new Map([['4433971', 7]]),
    metaById: new Map([[7, { name: 'Star Back', position: 'RB', nfl_team: 'KC' }]]),
    defByTeamCode: new Map(),
    prevById: prevStats ? new Map([[7, prevStats]]) : new Map(),
    opponentByTeam: new Map([['KC', 'BUF']]),
  };
}

const BOX = {
  playerStats: {
    4433971: { playerID: '4433971', Rushing: { rushYds: '104', rushTD: '1', carries: '18' } },
  },
};

test('applyGameBoxScore: the prevById baseline is the stored line the write returned, so a second apply keeps the carried keys', async (t) => {
  const upserts = stubUpserts(t);
  const maps = playerMaps(ENRICHED_PRIOR);
  await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps });
  await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps });

  const second = JSON.parse(upserts[1][3]);
  assert.equal(second.usageTargets, 7, 'kills the "prevById.set(fresh)" mutant: carry survives re-applies');
  assert.equal(second.gameTeam, 'KC');
});

// --- Washington skill player: the emitted play carries Team codes (#449) -----

/**
 * Regression for #449. A scoring play's `nflTeam` and `opponent` are the
 * payload the matchup cutscene keys its colour table by, and CONTEXT.md's
 * **Team code** entry forbids a raw code there. Washington is the one team
 * whose raw spelling (`WSH`) is not its Team code (`WAS`), so it is the only
 * fixture that can catch a missing fold; the KC/BUF fixtures above cannot,
 * their raw code already equals their Team code. The LOOKUPS stay raw-on-raw
 * (the opponent map is keyed by the raw `nfl_games.nfl_team` and looked up with
 * the raw player code); only the values written INTO the play are folded.
 */
test('applyGameBoxScore: a WSH skill player emits a play folded to Team codes (#449)', async (t) => {
  const upserts = stubUpserts(t);
  const maps = {
    idByExternal: new Map([['4433971', 7]]),
    metaById: new Map([[7, { name: 'Star Back', position: 'RB', nfl_team: 'WSH' }]]),
    defByTeamCode: new Map(),
    // The schedule speaks Tank01's raw vocabulary on BOTH columns: the row is
    // keyed WSH and its opponent is another drifted raw code (JAC), so a folded
    // opponent (JAX) proves the emission fold ran on the opponent too.
    prevById: new Map([[7, { rushingYards: 40, rushingTDs: 0 }]]),
    opponentByTeam: new Map([['WSH', 'JAC']]),
  };
  const out = await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps });

  const play = out.plays.find((p) => p.position === 'RB');
  assert.ok(play, 'a Washington skill-player scoring play must be emitted');
  assert.equal(play.nflTeam, 'WAS', "the play carries WSH folded to the Team code WAS, not the raw code");
  assert.equal(play.opponent, 'JAX', 'the opponent is folded to a Team code too (raw JAC -> JAX)');
  // The stored player_stats row is untouched by the fold: ADR 0011 keeps the
  // raw code in the table.
  assert.ok(upserts.some((p) => p[0] === 7), 'the player_stats row was still written');
});

// --- Washington DEF: teamAbv 'WSH' must match a 'Washington Commanders' unit --

/**
 * Regression for #431. Washington is the one team whose live box-score DST side
 * (Tank01's raw `teamAbv: 'WSH'`) does not equal the Team code its seeded DEF
 * unit folds to (`Washington Commanders` -> WAS). The DEF-unit map must be built
 * AND looked up on the folded Team code, or Washington's DST aggregate is
 * silently skipped every live sync. This drives loadWeekMaps (which builds the
 * map) so the fix at the real keying site is what turns it green; a hand-built
 * defByTeamCode would test the fixture, not the code. The other DST tests use KC/BAL,
 * whose Team code already equals Tank01's raw code, so they cannot catch this.
 */
test('applyGameBoxScore: a WSH box score matches the Washington Commanders DEF unit and scores it (#431)', async (t) => {
  const captured = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('INTO "player_stats"')) {
      captured.push(params);
      return { rows: [] };
    }
    if (text.includes(`WHERE "external_id" IS NOT NULL`)) return { rows: [] };
    if (text.includes(`"position" = 'DEF'`)) {
      return { rows: [{ id: 91, name: 'Washington Commanders', nfl_team: 'Washington Commanders' }] };
    }
    if (text.includes('FROM "player_stats"')) return { rows: [] }; // no prior stats
    if (text.includes('FROM "nfl_games"')) {
      // nfl_games speaks Tank01's raw vocabulary on BOTH columns: WSH, not WAS,
      // and a drifted opponent code (JAC) so the emitted opponent fold to JAX
      // is visible on the DEF path too (#449).
      return { rows: [{ nfl_team: 'WSH', opponent: 'JAC' }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const maps = await scoring.loadWeekMaps({ season: 2026, week: 1 });
  const box = {
    playerStats: {},
    DST: { home: { teamAbv: 'WSH', sacks: '3', defTD: '1', ptsAllowed: '10' } },
    teamStats: { away: {} },
  };
  const out = await scoring.applyGameBoxScore({ box, season: 2026, week: 1, maps });

  // A player_stats row was written for the Washington DEF id.
  const defUpsert = captured.find((p) => p[0] === 91);
  assert.ok(defUpsert, 'a player_stats row must be written for the Washington DEF unit');
  const stored = JSON.parse(defUpsert[3]);
  assert.equal(stored.sack, 3, 'the Tank01 DST numbers landed on the Washington unit');
  assert.equal(stored.defensiveTD, 1);

  // A DEF scoring play was emitted. The DEF-unit match and the opponent lookup
  // still succeed on the raw code (proving #431 did not regress), but the play
  // object now carries Team codes (#449): the DST side's raw teamAbv `WSH` folds
  // to `WAS`, and the raw-keyed opponent `JAC` folds to `JAX`.
  const defPlay = out.plays.find((p) => p.position === 'DEF');
  assert.ok(defPlay, 'a Washington DEF scoring play must be emitted');
  assert.equal(defPlay.nflTeam, 'WAS', "the play carries the folded Team code WAS, not Tank01's raw WSH (#449)");
  assert.equal(defPlay.opponent, 'JAX', 'opponent found via the raw WSH-keyed schedule row, then folded to a Team code (#449)');
});

// --- carried keys can never fire a cutscene ----------------------------------

test('detectScoringEvents ignores every nflverse-only key', () => {
  // Assertion-style: no nflverse-owned key is in the animatable-play set, so a
  // carried usageTargets can never manufacture a touchdown event.
  for (const key of [...STAT_KEY_OWNERSHIP['nflverse-week'].keys, ...STAT_KEY_OWNERSHIP['nflverse-snaps'].keys, 'gameTeam', 'gameOpponent', 'usageTargets']) {
    assert.deepEqual(
      scoring.detectScoringEvents({ [key]: 0 }, { [key]: 99 }),
      [],
      `${key} must never produce a scoring event`
    );
    assert.deepEqual(scoring.detectScoringEvents({}, { [key]: 99 }), []);
  }
});

// --- one sync's plays for a player must SUM to the whole points change ------

/**
 * liveBoxPoll's rescore gate (createRescoreGate) buckets a league's plays
 * across 30s engine ticks and flushes on a 60s floor, so one score event
 * routinely carries plays from more than one sync for the same player. A
 * client can never dedupe those plays per player - it must sum them - which
 * only works if the plays THEMSELVES add up to the whole points change,
 * instead of each one carrying the whole thing (the pre-fix bug). This drives
 * the real apply path (not attributePlayPoints directly) so a regression at
 * either call site is caught.
 */
test('applyGameBoxScore: a DEF unit with two tracked events in one sync emits plays that sum to the points change', async (t) => {
  const upserts = stubUpserts(t);
  const prevStats = { fumbleRecovery: 0, defensiveTD: 0, pointsAllowed: 3 }; // tier 1-6 -> 7 pts
  const maps = {
    idByExternal: new Map(),
    metaById: new Map(),
    defByTeamCode: new Map([['KC', { id: 91, name: 'Kansas City Chiefs', nfl_team: 'Kansas City Chiefs' }]]),
    prevById: new Map([[91, prevStats]]),
    opponentByTeam: new Map([['KC', 'BUF']]),
  };
  const box = {
    playerStats: {},
    DST: { home: { teamAbv: 'KC', fumblesRecovered: '1', defTD: '1', ptsAllowed: '10' } }, // tier 7-13 -> 4 pts
    teamStats: { away: {} },
  };
  const out = await scoring.applyGameBoxScore({ box, season: 2026, week: 2, maps });

  const plays = out.plays.filter((p) => p.playerId === 91);
  assert.equal(plays.length, 2, 'both fumbleRecovery and defensiveTD fired');

  const stored = JSON.parse(upserts[0][3]);
  const wholeDelta = Math.round(
    (scoring.calculateFantasyPoints(stored) - scoring.calculateFantasyPoints(prevStats)) * 100
  ) / 100;
  const sum = Math.round(plays.reduce((s, p) => s + p.pointsDelta, 0) * 100) / 100;
  assert.equal(sum, wholeDelta, "the sync's plays must sum to the whole points change");
  assert.notDeepEqual(
    plays.map((p) => p.pointsDelta),
    [wholeDelta, wholeDelta],
    'each play must not carry the whole delta (the old stamp-it-on-every-play bug)'
  );
});

test('applyGameBoxScore: a carried usageTargets produces no play', async (t) => {
  stubUpserts(t);
  // Prior row already has the touchdown, so the only DIFFERENCE this apply sees
  // is the carried usage data — which must animate nothing.
  const prior = { rushingYards: 104, rushingTDs: 1, usageTargets: 0, gameTeam: 'KC' };
  const maps = playerMaps(prior);
  const out = await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps });
  assert.deepEqual(out.plays, []);
});
