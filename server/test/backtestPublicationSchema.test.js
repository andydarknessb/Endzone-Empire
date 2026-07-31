const test = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../../scripts/backtest/lib/publicationSchema');
const { assertClosedSchema } = require('../../scripts/backtest/lib/schemaGuard');

// ---------------------------------------------------------------------------
// The two structural self-checks run at module load; re-run them here
// directly so a future edit that breaks either fails a NAMED test, not just
// "requiring the module throws" somewhere unrelated.
// ---------------------------------------------------------------------------

test('assertExternalIdOnlyInPlayers passes on the real, shipped schema set', () => {
  assert.equal(schema.assertExternalIdOnlyInPlayers(), true);
});

test('assertInjuryDetailExplicitlyAllowlisted passes on the real, shipped schema set', () => {
  assert.equal(schema.assertInjuryDetailExplicitlyAllowlisted(), true);
});

test('assertExternalIdOnlyInPlayers fails if any OTHER schema declares external_id (mutation check)', () => {
  // Calls the REAL exported function (not a reimplementation of its logic),
  // injected with a throwaway copy of the label map that has external_id
  // added to a non-players schema - this is what actually exercises the
  // guard line inside assertExternalIdOnlyInPlayers itself.
  const mutated = {
    ...schema.ALL_SCHEMAS_BY_LABEL,
    games_csv: { kind: 'object', mode: 'exact', fields: { external_id: { kind: 'number' } } },
  };
  assert.doesNotThrow(() => schema.assertExternalIdOnlyInPlayers(schema.ALL_SCHEMAS_BY_LABEL));
  assert.throws(
    () => schema.assertExternalIdOnlyInPlayers(mutated),
    /dataset schema "games_csv" declares external_id/
  );
});

test('assertInjuryDetailExplicitlyAllowlisted fails if the literal key is removed (mutation check)', () => {
  // Calls the REAL exported function, injected with a copy of the players
  // schema that has injury_detail stripped out - proving the guard actually
  // looks, not just that the real schema currently happens to name it.
  const withoutInjuryDetail = { ...schema.PLAYERS_SCHEMA, fields: { ...schema.PLAYERS_SCHEMA.fields } };
  delete withoutInjuryDetail.fields.injury_detail;
  assert.doesNotThrow(() => schema.assertInjuryDetailExplicitlyAllowlisted(schema.PLAYERS_SCHEMA));
  assert.throws(
    () => schema.assertInjuryDetailExplicitlyAllowlisted(withoutInjuryDetail),
    /players schema does not explicitly declare injury_detail/
  );
});

// ---------------------------------------------------------------------------
// assertNoExternalIdOutsidePlayers - the row-level twin, independent of what
// the schema declares
// ---------------------------------------------------------------------------

test('assertNoExternalIdOutsidePlayers is a no-op for the players dataset itself', () => {
  const result = schema.assertNoExternalIdOutsidePlayers('players', [{ id: 1, external_id: 99 }]);
  assert.deepEqual(result, { dataset: 'players', ok: true, checked: 0 });
});

test('assertNoExternalIdOutsidePlayers passes when no other dataset carries the key', () => {
  const result = schema.assertNoExternalIdOutsidePlayers('player_stats', [
    { player_id: 1, season: 2024, week: 1, stats: { passingYards: 10 } },
  ]);
  assert.deepEqual(result, { dataset: 'player_stats', ok: true, checked: 1 });
});

test('assertNoExternalIdOutsidePlayers rejects a top-level external_id outside players', () => {
  assert.throws(
    () => schema.assertNoExternalIdOutsidePlayers('player_stats', [{ player_id: 1, external_id: 5 }]),
    /external_id found in dataset player_stats at \$\[0\] - .*approved external_id ONLY in players/
  );
});

test('assertNoExternalIdOutsidePlayers rejects external_id nested arbitrarily deep', () => {
  const rows = [{ player_id: 1, stats: { nested: { deeper: { external_id: 5 } } } }];
  assert.throws(
    () => schema.assertNoExternalIdOutsidePlayers('player_stats', rows),
    /\$\[0\]\.stats\.nested\.deeper/
  );
});

test('assertNoExternalIdOutsidePlayers requires an array', () => {
  assert.throws(() => schema.assertNoExternalIdOutsidePlayers('player_stats', 'nope'), /requires an array of rows/);
});

// ---------------------------------------------------------------------------
// schemaForDataset dispatch
// ---------------------------------------------------------------------------

test('schemaForDataset resolves every fixed name and both parametrized families', () => {
  assert.equal(schema.schemaForDataset('players'), schema.PLAYERS_SCHEMA);
  assert.equal(schema.schemaForDataset('player_stats'), schema.PLAYER_STATS_SCHEMA);
  assert.equal(schema.schemaForDataset('player_season_stats'), schema.PLAYER_SEASON_STATS_SCHEMA);
  assert.equal(schema.schemaForDataset('orientation_overlay'), schema.ORIENTATION_OVERLAY_SCHEMA);
  assert.equal(schema.schemaForDataset('position_rank'), schema.POSITION_RANK_SCHEMA);
  assert.equal(schema.schemaForDataset('player_name_rank'), schema.PLAYER_NAME_RANK_SCHEMA);
  assert.equal(schema.schemaForDataset('games_csv'), schema.GAMES_CSV_SCHEMA);
  for (const name of ['nfl_games_2022', 'nfl_games_2024', 'nfl_games_2025']) {
    assert.equal(schema.schemaForDataset(name), schema.NFL_GAMES_SCHEMA);
  }
  for (const name of ['oracle_2024_w1', 'oracle_2025_w18']) {
    assert.equal(schema.schemaForDataset(name), schema.ORACLE_SCHEMA);
  }
});

test('schemaForDataset refuses a name this file does not register (fail closed, not "let it through")', () => {
  assert.throws(() => schema.schemaForDataset('mystery_dataset'), /no closed-schema allowlist is registered/);
  assert.throws(() => schema.schemaForDataset('nfl_games_24'), /no closed-schema allowlist/, 'a malformed season is rejected, not coerced');
});

// ---------------------------------------------------------------------------
// Closed-schema fixtures required by the house quality bar: an unexpected
// key, an unexpected nested shape, and external_id outside players - all
// exercised through the REAL registered schemas, not toy ones.
// ---------------------------------------------------------------------------

test('an unexpected top-level key on players is rejected', () => {
  const row = {
    id: 1, external_id: null, name: 'X', position: 'QB', nfl_team: 'KC',
    injury_status: null, injury_detail: null, adp: null, team_key: 'KC',
    unexpectedColumn: 'nope',
  };
  assert.throws(
    () => assertClosedSchema([row], schema.PLAYERS_SCHEMA, 'players'),
    /unexpected key\(s\) not on the closed allowlist: unexpectedColumn/
  );
});

test('an unexpected nested key inside player_stats.stats is rejected', () => {
  const row = { player_id: 1, season: 2024, week: 1, stats: { passingYards: 10, ssn: '123-45-6789' } };
  assert.throws(
    () => assertClosedSchema([row], schema.PLAYER_STATS_SCHEMA, 'player_stats'),
    /\$\.stats: unexpected key\(s\) not on the closed allowlist: ssn/
  );
});

test('an unexpected value TYPE (a nested object where a number is declared) is rejected', () => {
  const row = { player_id: 1, season: 2024, week: 1, stats: { passingYards: { not: 'a number' } } };
  assert.throws(
    () => assertClosedSchema([row], schema.PLAYER_STATS_SCHEMA, 'player_stats'),
    /\$\.stats\.passingYards: expected a finite number, got object/
  );
});

test('external_id present on a non-players dataset is rejected by the closed schema itself, independent of the row-level guard', () => {
  const row = { player_id: 1, season: 2024, week: 1, stats: {}, external_id: 42 };
  assert.throws(
    () => assertClosedSchema([row], schema.PLAYER_STATS_SCHEMA, 'player_stats'),
    /unexpected key\(s\) not on the closed allowlist: external_id/
  );
});

test('the real players schema accepts a realistic full row, DEF pseudo-player row, and a legacy row with no external_id mapping', () => {
  const rows = [
    { id: 1, external_id: 4241, name: 'Real Player', position: 'QB', nfl_team: 'KC', injury_status: 'Questionable', injury_detail: 'Ankle', adp: '12.5', team_key: 'KC' },
    { id: 2, external_id: null, name: 'Kansas City Chiefs', position: 'DEF', nfl_team: 'Kansas City Chiefs', injury_status: null, injury_detail: null, adp: null, team_key: 'KC' },
  ];
  assert.doesNotThrow(() => assertClosedSchema(rows, schema.PLAYERS_SCHEMA, 'players'));
});

test('the real oracle schema accepts a fully-populated projection AND the sparse dataQuality/availability variants seen in production', () => {
  const base = {
    activeProbability: null, confidence: 'high', confidenceReasons: [], effectiveGames: 4,
    mean: null, median: 12.3, modelVersion: 'free_baseline_v3.1', p10: null, p25: null, p75: null,
    p90: null, playerId: 1, position: 'RB', sampleSize: 4, unavailableReason: null,
  };
  const factorsVariantA = {
    availability: { activeProbability: null, available: true, locked: false, lockedSlot: null, reason: null, status: null },
    dataQuality: { level: 'good', reason: 'ok', residualSource: null },
    expertConsensus: null, homeAway: null, opponent: null, recentProduction: null, role: null,
    versusOpponent: null, weather: null,
  };
  const factorsVariantB = {
    availability: { activeProbability: 0.9, autoRecommend: true, available: true, locked: true, lockedSlot: 'FLEX', reason: 'starter', status: 'ACT' },
    dataQuality: { level: 'sparse', reasons: ['few games'], residualSource: 'position-baseline' },
    expertConsensus: null,
    homeAway: { available: true, effect: 0.2, pointsContribution: 0.5, reason: 'home' },
    opponent: { allowedPerGame: 20, available: true, effect: 0.1, games: 4, leagueAveragePerGame: 18, opponentTeam: 'BUF', pointsContribution: 1.2, reason: 'weak defense' },
    recentProduction: { available: true, effectiveGames: 3, expectedOpportunities: 10, games: 4, opportunityEfficiency: 0.5, opportunityValue: 1.1, perGame: 12, pointsBaselinePerGame: 11, pointsContribution: 12, usageBlendWeight: 0.25, usageGames: 4, usedPositionBaseline: false, usedPriorSeason: true },
    role: { available: true, note: 'starter', pointsContribution: null },
    versusOpponent: { available: false, effect: 0, meetings: 0, pointsContribution: null, reason: 'insufficient meetings' },
    weather: { available: false, effect: 0, pointsContribution: null, reason: 'dome', roof: 'dome' },
  };
  const rowA = { season: 2024, week: 1, player_id: 1, projection: { ...base, factors: factorsVariantA } };
  const rowB = { season: 2024, week: 2, player_id: 1, projection: { ...base, factors: factorsVariantB } };
  assert.doesNotThrow(() => assertClosedSchema([rowA, rowB], schema.ORACLE_SCHEMA, 'oracle_2024_w1'));
});
