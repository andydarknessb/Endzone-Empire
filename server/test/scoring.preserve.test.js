const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const scoring = require('../services/scoring.service');

/**
 * The Tank01 box-score upsert replaces player_stats.stats WHOLESALE. Anything
 * only nflverse can supply — the per-week usage columns, gameTeam/gameOpponent,
 * the IDP yardage finalization patch — would be erased by the next live sync of
 * a week that was previously enriched. These tests pin the carry-forward.
 */

const { NFLVERSE_ONLY_STAT_KEYS, pickPresentKeys, mergeCarriedStats } = scoring;

// --- NFLVERSE_ONLY_STAT_KEYS -------------------------------------------------

test('NFLVERSE_ONLY_STAT_KEYS covers usage, game-context and IDP-patch keys, with no duplicates', () => {
  for (const key of [
    'usagePassAttempts', 'usageCompletions', 'usageCarries', 'usageTargets', 'usageAirYards',
    'gameTeam', 'gameOpponent',
    'idpSackYards', 'idpTacklesForLossYards', 'idpFumbleReturnYards',
    'idpInterceptionReturnYards', 'idpSafety',
  ]) {
    assert.ok(NFLVERSE_ONLY_STAT_KEYS.includes(key), `${key} must be carried across a Tank01 re-apply`);
  }
  assert.equal(new Set(NFLVERSE_ONLY_STAT_KEYS).size, NFLVERSE_ONLY_STAT_KEYS.length);
});

test('NFLVERSE_ONLY_STAT_KEYS never lists a key Tank01 itself produces', () => {
  // Carrying a Tank01-produced key would let a stale value survive a stat
  // correction. Both live normalizers are checked against a maximal entry.
  const entry = {
    playerID: '1', Passing: { passYds: '300', passTD: '2', int: '1', passAttempts: '40', passCompletions: '25' },
    Rushing: { rushYds: '50', rushTD: '1', carries: '10' },
    Receiving: { recYds: '80', recTD: '1', receptions: '6', targets: '9' },
    Kicking: { fgMade: '2', fgAttempts: '3', xpMade: '3', xpAttempts: '3' },
    Defense: {
      totalTackles: '9', soloTackles: '6', sacks: '1', defensiveInterceptions: '1', forcedFumbles: '1',
      fumblesRecovered: '1', passDeflections: '2', qbHits: '3', tfl: '2', defTD: '1', interceptionTDs: '1',
      twoPointConversionReturn: '1',
    },
  };
  const tank01Keys = new Set([
    ...Object.keys(scoring.normalizeTank01Stats(entry)),
    ...Object.keys(scoring.normalizeTank01IdpStats(entry)),
  ]);
  const overlap = NFLVERSE_ONLY_STAT_KEYS.filter((k) => tank01Keys.has(k));
  assert.deepEqual(overlap, [], 'a Tank01-regenerable key must never be carried forward');
});

// --- pickPresentKeys ---------------------------------------------------------

test('pickPresentKeys never invents a key and never returns an unlisted one', () => {
  const sources = [
    { usageTargets: 7, rushingYards: 104 },
    { gameTeam: 'KC', gameOpponent: 'BUF', passingTDs: 3 },
    { idpSackYards: 12, soloTackle: 6, notAStat: true },
    { usageCarries: 0, usageAirYards: 0 },
  ];
  for (const source of sources) {
    const picked = pickPresentKeys(source, NFLVERSE_ONLY_STAT_KEYS);
    for (const [key, value] of Object.entries(picked || {})) {
      assert.ok(NFLVERSE_ONLY_STAT_KEYS.includes(key), `${key} is not on the carry list`);
      assert.ok(key in source, `${key} was invented: it is not on the source`);
      assert.equal(value, source[key], `${key} was rewritten in transit`);
    }
  }
});

test('pickPresentKeys returns null for a missing source or a source with none of the keys', () => {
  for (const source of [null, undefined, {}, 'nope', 42, { rushingYards: 100, receptions: 4 }]) {
    assert.equal(pickPresentKeys(source, NFLVERSE_ONLY_STAT_KEYS), null);
  }
  // Kills the "return {} instead of null" mutant: callers branch on falsiness.
  assert.equal(pickPresentKeys({ usageTargets: 1 }, []), null);
});

test('pickPresentKeys carries an explicit null but not an undefined', () => {
  // null is DATA here: "the CSV had no targets column for this season". A
  // fabricated 0 would read as a benching, and dropping the key would read as
  // "never enriched". undefined is genuine absence and must not be carried.
  const picked = pickPresentKeys(
    { usageTargets: null, usageAirYards: undefined, gameTeam: 'KC' },
    NFLVERSE_ONLY_STAT_KEYS
  );
  assert.deepEqual(picked, { usageTargets: null, gameTeam: 'KC' });
  assert.ok(!('usageAirYards' in picked), 'undefined must not be materialized as a key');
  // Kills the `source[key] != null` mutant (loose check would drop the null).
  assert.equal(picked.usageTargets, null);
});

test('pickPresentKeys does not mutate its source', () => {
  const source = { usageTargets: 7 };
  pickPresentKeys(source, NFLVERSE_ONLY_STAT_KEYS);
  assert.deepEqual(source, { usageTargets: 7 });
});

// --- mergeCarriedStats -------------------------------------------------------

test('mergeCarriedStats: a fresh value always beats a colliding carried value', () => {
  // Constructed collision: no Tank01 normalizer emits a carry-list key today
  // (asserted above), so this is the guard for the day one starts to.
  const merged = mergeCarriedStats(
    { usageTargets: 3, rushingYards: 104 },
    { usageTargets: 7, gameOpponent: 'KC' }
  );
  assert.equal(merged.usageTargets, 3, 'fresh Tank01 data must win');
  assert.equal(merged.gameOpponent, 'KC', 'a non-colliding carried key survives');
  assert.equal(merged.rushingYards, 104);
  // Kills the `{ ...fresh, ...carried }` mutant, which would answer 7.
});

test('mergeCarriedStats: a fresh 0, empty string or null still beats a carried value', () => {
  // Falsy-but-real fresh values are the classic mutant here: `merged[key] ||
  // carried[key]` would let a stale 7 overwrite a corrected 0.
  for (const fresh of [0, '', null, false]) {
    const merged = mergeCarriedStats({ usageTargets: fresh }, { usageTargets: 7 });
    assert.equal(merged.usageTargets, fresh, `fresh ${JSON.stringify(fresh)} must win`);
  }
});

test('mergeCarriedStats: an explicitly-undefined fresh key does not clobber the carry', () => {
  const merged = mergeCarriedStats({ usageTargets: undefined }, { usageTargets: 7 });
  assert.equal(merged.usageTargets, 7);
});

test('mergeCarriedStats: no carry is a plain copy, and neither input is mutated', () => {
  const fresh = { rushingYards: 104 };
  const carried = { usageTargets: 7 };
  const merged = mergeCarriedStats(fresh, null);
  assert.deepEqual(merged, { rushingYards: 104 });
  merged.rushingYards = 0;
  assert.equal(fresh.rushingYards, 104, 'merge must return a new object');
  mergeCarriedStats(fresh, carried);
  assert.deepEqual(carried, { usageTargets: 7 });
});

// --- applyGameBoxScore: the real carry ---------------------------------------

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

test('applyGameBoxScore: a Tank01 re-apply preserves the nflverse-only keys on the stored row', async (t) => {
  const upserts = stubUpserts(t);
  await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps: playerMaps(ENRICHED_PRIOR) });

  const stored = JSON.parse(upserts[0][3]);
  assert.equal(stored.usageTargets, 7);
  assert.equal(stored.gameOpponent, 'BUF');
  assert.equal(stored.gameTeam, 'KC');
  assert.equal(stored.usageCarries, 12);
  assert.equal(stored.idpSackYards, 9);
  assert.ok('usageAirYards' in stored, 'a known-absent null must survive as null, not vanish');
  assert.equal(stored.usageAirYards, null);
  // Fresh Tank01 numbers still land.
  assert.equal(stored.rushingYards, 104);
  assert.equal(stored.rushingTDs, 1);
});

test('applyGameBoxScore: stored fantasy_points is computed from the MERGED stats', async (t) => {
  const upserts = stubUpserts(t);
  await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps: playerMaps(ENRICHED_PRIOR) });

  const stored = JSON.parse(upserts[0][3]);
  assert.equal(
    Number(upserts[0][4]),
    scoring.calculateFantasyPoints(stored),
    'kills the "merge happened after points were computed" mutant'
  );
  // The carried keys are unscored, so the value is still the plain Tank01 total.
  assert.equal(Number(upserts[0][4]), 16.4); // 104 * 0.1 + 6
});

test('applyGameBoxScore: the prevById baseline is the merged row, so a second apply keeps the carry', async (t) => {
  const upserts = stubUpserts(t);
  const maps = playerMaps(ENRICHED_PRIOR);
  await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps });
  await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps });

  const second = JSON.parse(upserts[1][3]);
  assert.equal(second.usageTargets, 7, 'kills the "prevById.set(fresh)" mutant: carry survives re-applies');
  assert.equal(second.gameTeam, 'KC');
});

test('applyGameBoxScore: a row with no prior stats is unchanged by the carry logic', async (t) => {
  const upserts = stubUpserts(t);
  await scoring.applyGameBoxScore({ box: BOX, season: 2026, week: 2, maps: playerMaps(null) });
  const stored = JSON.parse(upserts[0][3]);
  for (const key of NFLVERSE_ONLY_STAT_KEYS) {
    assert.ok(!(key in stored), `${key} must not be invented for a never-enriched player`);
  }
});

test('applyGameBoxScore: a DST re-apply preserves gameTeam/gameOpponent', async (t) => {
  const upserts = stubUpserts(t);
  const maps = {
    idByExternal: new Map(),
    metaById: new Map(),
    defByTeamCode: new Map([['KC', { id: 91, name: 'Kansas City Chiefs', nfl_team: 'Kansas City Chiefs' }]]),
    prevById: new Map([[91, { sack: 1, gameTeam: 'KC', gameOpponent: 'BUF' }]]),
    opponentByTeam: new Map([['KC', 'BUF']]),
  };
  const box = {
    playerStats: {},
    DST: { home: { teamAbv: 'KC', sacks: '3', defTD: '0' } },
    teamStats: { away: { ptsAllowed: '17' } },
  };
  await scoring.applyGameBoxScore({ box, season: 2026, week: 2, maps });
  const stored = JSON.parse(upserts[0][3]);
  assert.equal(stored.gameTeam, 'KC');
  assert.equal(stored.gameOpponent, 'BUF');
  assert.equal(stored.sack, 3, 'fresh Tank01 DST numbers still land');
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
      // nfl_games speaks Tank01's raw vocabulary: WSH, not WAS.
      return { rows: [{ nfl_team: 'WSH', opponent: 'DAL' }] };
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

  // A DEF scoring play was emitted, carrying Tank01's RAW spelling and an
  // opponent resolved from the raw-keyed nfl_games row (proves the raw-on-raw
  // opponent lookup did not regress).
  const defPlay = out.plays.find((p) => p.position === 'DEF');
  assert.ok(defPlay, 'a Washington DEF scoring play must be emitted');
  assert.equal(defPlay.nflTeam, 'WSH', "the play carries Tank01's raw team code, not the folded Team code");
  assert.equal(defPlay.opponent, 'DAL', 'opponent resolved from the WSH-keyed schedule row');
});

// --- carried keys can never fire a cutscene ----------------------------------

test('detectScoringEvents ignores every nflverse-only key', () => {
  // Assertion-style: no carry-list key is in the animatable-play set, so a
  // carried usageTargets can never manufacture a touchdown event.
  for (const key of NFLVERSE_ONLY_STAT_KEYS) {
    assert.deepEqual(
      scoring.detectScoringEvents({ [key]: 0 }, { [key]: 99 }),
      [],
      `${key} must never produce a scoring event`
    );
    assert.deepEqual(scoring.detectScoringEvents({}, { [key]: 99 }), []);
  }
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
