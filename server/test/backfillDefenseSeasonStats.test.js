const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { parseArgs, checkOutcome } = require('../../scripts/backfill-defense-season-stats');
const { syncPlayerSeasonStats, DEFENSIVE_POSITIONS, IDP_POSITIONS } = require('../services/scoring.service');

// --- parseArgs --------------------------------------------------------------

test('parseArgs defaults the cutoff to 2026 (rolls up 2024 and 2025)', () => {
  assert.deepEqual(parseArgs([]), { cutoff: 2026 });
});

test('parseArgs accepts --cutoff in both flag styles and rejects junk', () => {
  assert.equal(parseArgs(['--cutoff', '2025']).cutoff, 2025);
  assert.equal(parseArgs(['--cutoff=2025']).cutoff, 2025);
  assert.throws(() => parseArgs(['--cutoff', 'soon']), /--cutoff must be an integer/);
  assert.throws(() => parseArgs(['--all']), /Unknown argument/);
});

// --- checkOutcome -----------------------------------------------------------

function snapshots(overrides = {}) {
  const before = {
    otherRows: 1000,
    offenseSample: { player_id: 1, season: 2024, games_played: 17, stats: { receptions: 90 }, fantasy_points: '210.00' },
    byPosition: [],
    spotChecks: [],
    ...overrides.before,
  };
  const after = {
    otherRows: 1000,
    offenseSample: before.offenseSample,
    byPosition: [
      { season: 2025, position: 'DEF', rows: 32 },
      { season: 2025, position: 'LB', rows: 600 },
    ],
    spotChecks: [
      { label: 'DEF Denver Broncos', season: 2025, rollupPoints: 187, gamesPlayed: 17, weeklySum: 187, weeklyCount: 17 },
    ],
    ...overrides.after,
  };
  return { before, after, seasons: overrides.seasons || [2025] };
}

test('checkOutcome passes when defenses are covered and offense is untouched', () => {
  assert.deepEqual(checkOutcome(snapshots()), []);
});

test('checkOutcome fails loudly if any non-defensive rollup row was touched', () => {
  const problems = checkOutcome(snapshots({ after: { otherRows: 999 } }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /non-defensive .* changed: 1000 -> 999/);
});

test('checkOutcome fails if a sampled Sleeper offense row was rewritten', () => {
  const s = snapshots();
  s.after.offenseSample = { ...s.before.offenseSample, fantasy_points: '188.00' };
  const problems = checkOutcome(s);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Sleeper data was overwritten/);
});

test('checkOutcome requires all 32 team defenses per season', () => {
  const problems = checkOutcome(snapshots({
    after: { byPosition: [{ season: 2025, position: 'DEF', rows: 30 }, { season: 2025, position: 'LB', rows: 600 }] },
  }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /expected 32 DEF rows, got 30/);
});

test('checkOutcome requires at least some IDP rows per season', () => {
  const problems = checkOutcome(snapshots({
    after: { byPosition: [{ season: 2025, position: 'DEF', rows: 32 }] },
  }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no IDP rollup rows/);
});

test('checkOutcome catches a rollup total that disagrees with its weekly rows', () => {
  const problems = checkOutcome(snapshots({
    after: {
      spotChecks: [
        // The aggregate-scored value a tier bug would produce instead of 187.
        { label: 'DEF Denver Broncos', season: 2025, rollupPoints: -8, gamesPlayed: 17, weeklySum: 187, weeklyCount: 17 },
      ],
    },
  }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /rollup -8 != weekly sum 187/);
});

test('checkOutcome catches a missing rollup row and a games_played mismatch', () => {
  const missing = checkOutcome(snapshots({
    after: { spotChecks: [{ label: 'DEF X', season: 2025, rollupPoints: null, gamesPlayed: null, weeklySum: 187, weeklyCount: 17 }] },
  }));
  assert.match(missing[0], /no rollup row/);

  const games = checkOutcome(snapshots({
    after: { spotChecks: [{ label: 'DEF X', season: 2025, rollupPoints: 187, gamesPlayed: 16, weeklySum: 187, weeklyCount: 17 }] },
  }));
  assert.match(games[0], /games_played 16 != 17 weekly rows/);
});

// --- the scoped rollup itself -----------------------------------------------

test('DEFENSIVE_POSITIONS covers team defenses plus every IDP code', () => {
  assert.equal(DEFENSIVE_POSITIONS[0], 'DEF');
  for (const code of ['DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'CB', 'S', 'FS', 'SS', 'DB', 'DL']) {
    assert.ok(IDP_POSITIONS.includes(code), `missing IDP position ${code}`);
    assert.ok(DEFENSIVE_POSITIONS.includes(code));
  }
  assert.ok(!IDP_POSITIONS.includes('DEF'));
});

test('syncPlayerSeasonStats scopes to the given positions and sums weekly points', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    queries.push({ text, params });
    if (text.includes('FROM "player_stats"')) {
      return { rows: [
        // Two 22-point DEF weeks; the aggregate of these stats would score 21.
        { player_id: 6721, season: 2025, stats: { sack: 2, pointsAllowed: 0, yardsAllowed: 90 }, fantasy_points: '22.00' },
        { player_id: 6721, season: 2025, stats: { sack: 2, pointsAllowed: 0, yardsAllowed: 95 }, fantasy_points: '22.00' },
      ] };
    }
    return { rows: [] };
  });

  const out = await syncPlayerSeasonStats({ currentSeason: 2026, positions: DEFENSIVE_POSITIONS });
  assert.equal(out.seasonsUpserted, 1);

  const weekly = queries.find((q) => q.text.includes('FROM "player_stats"'));
  assert.match(weekly.text, /JOIN "players"/);
  assert.match(weekly.text, /"p"\."position" = ANY\(\$2\)/);
  assert.deepEqual(weekly.params, [2026, DEFENSIVE_POSITIONS]);

  const upsert = queries.find((q) => q.text.includes('INSERT INTO "player_season_stats"'));
  const [playerId, season, games, stats, points] = upsert.params;
  assert.equal(playerId, 6721);
  assert.equal(season, 2025);
  assert.equal(games, 2);
  assert.deepEqual(JSON.parse(stats), { sack: 4, pointsAllowed: 0, yardsAllowed: 185 });
  assert.equal(points, 44); // 22 + 22, NOT the 21 the aggregate would score
});

test('the derived season cutoff ignores pick\'em-only leagues', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    queries.push({ text, params });
    if (text.includes('MAX("current_season")')) return { rows: [{ s: 2026 }] };
    return { rows: [] };
  });

  await syncPlayerSeasonStats({});
  const cutoff = queries.find((q) => q.text.includes('MAX("current_season")'));
  assert.ok(cutoff, 'expected a derived-cutoff query when no currentSeason is given');
  // A pick'em-only league's current_season is seeded from the NFL schedule
  // and can reach the next season before any fantasy league rolls over; it
  // must never widen the backfill cutoff.
  assert.match(cutoff.text, /"pickem_only" = false/);
  const weekly = queries.find((q) => q.text.includes('FROM "player_stats"'));
  assert.deepEqual(weekly.params, [2026]);
});

test('syncPlayerSeasonStats without positions stays unscoped (no players join)', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    queries.push({ text, params });
    return { rows: [] };
  });

  await syncPlayerSeasonStats({ currentSeason: 2026 });
  const weekly = queries.find((q) => q.text.includes('FROM "player_stats"'));
  assert.ok(!weekly.text.includes('JOIN "players"'));
  assert.deepEqual(weekly.params, [2026]);
});

test('syncPlayerSeasonStats scores a week itself when the stored points are unusable', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    queries.push({ text, params });
    if (text.includes('FROM "player_stats"')) {
      return { rows: [
        { player_id: 900, season: 2025, stats: { soloTackle: 6, assistedTackle: 4 }, fantasy_points: null },
      ] };
    }
    return { rows: [] };
  });

  await syncPlayerSeasonStats({ currentSeason: 2026, positions: IDP_POSITIONS });
  const upsert = queries.find((q) => q.text.includes('INSERT INTO "player_season_stats"'));
  assert.equal(upsert.params[4], 8); // 6 solo + 4 assists * 0.5, recomputed
});
