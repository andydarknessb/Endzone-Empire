const test = require('node:test');
const assert = require('node:assert/strict');
const {
  averageOf,
  impliedTotalForTeam,
  usageEntryFromStats,
  opponentEntries,
  memoLeagueContext,
  leagueContextMemoSize,
  clearLeagueContextMemo,
  LEAGUE_CONTEXT_TTL_MS,
} = require('../services/decisionCardContext.service');
const projectionFeatures = require('../services/projectionFeatures');

// ---------------------------------------------------------------------------
// impliedTotalForTeam
// ---------------------------------------------------------------------------

test('impliedTotalForTeam: picks the home side for a home game', () => {
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, 'home'), 25);
});

test('impliedTotalForTeam: picks the away side for an away game', () => {
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, 'away'), 22);
});

test('impliedTotalForTeam: a favourite (negative spread home team) and an underdog', () => {
  // total 47, spread -3 (home favoured by 3): home 25, away 22 (vegasOdds.provider docblock).
  const quote = { home: 25, away: 22 };
  assert.equal(impliedTotalForTeam(quote, 'home'), 25); // favourite
  assert.equal(impliedTotalForTeam(quote, 'away'), 22); // underdog
});

test('impliedTotalForTeam: null quote, or an unrecognized/neutral orientation, is null', () => {
  assert.equal(impliedTotalForTeam(null, 'home'), null);
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, null), null);
  assert.equal(impliedTotalForTeam({ home: 25, away: 22 }, 'neutral'), null);
});

// ---------------------------------------------------------------------------
// usageEntryFromStats
// ---------------------------------------------------------------------------

const RULES = undefined; // calculateFantasyPoints defaults to SCORING_RULES

test('usageEntryFromStats: reads targets/carries/airYards and computes target share', () => {
  const stats = { usageTargets: 6, usageCarries: 2, usageAirYards: 55, gameTeam: 'BUF' };
  const entry = usageEntryFromStats(stats, RULES, 30);
  assert.equal(entry.targets, 6);
  assert.equal(entry.carries, 2);
  assert.equal(entry.airYards, 55);
  assert.equal(entry.targetShare, 0.2);
});

test('usageEntryFromStats: target share is null when team pass attempts is zero', () => {
  const stats = { usageTargets: 6, gameTeam: 'BUF' };
  const entry = usageEntryFromStats(stats, RULES, 0);
  assert.equal(entry.targetShare, null);
});

test('usageEntryFromStats: target share is null when the row has no gameTeam (no attempts to look up)', () => {
  const stats = { usageTargets: 6 };
  const entry = usageEntryFromStats(stats, RULES, null);
  assert.equal(entry.targetShare, null);
});

test('usageEntryFromStats: a missing usage key stays null, not zero', () => {
  const entry = usageEntryFromStats({}, RULES, 30);
  assert.equal(entry.targets, null);
  assert.equal(entry.carries, null);
  assert.equal(entry.airYards, null);
  assert.equal(entry.targetShare, null);
});

test('usageEntryFromStats: fantasyPoints prices the stats row under the given rules', () => {
  const stats = { passingYards: 300, passingTDs: 2 };
  const customRules = { passing: { yards: { perYard: 0.05 }, touchdowns: 6 } };
  const entry = usageEntryFromStats(stats, customRules, null);
  // Not asserting the exact scoring-engine mapping here (that's
  // scoring.service's own suite); just that this module's fantasyPoints is
  // calculateFantasyPoints(stats, rules), not the stored fantasy_points column.
  assert.equal(typeof entry.fantasyPoints, 'number');
});

// ---------------------------------------------------------------------------
// averageOf
// ---------------------------------------------------------------------------

test('averageOf: the mean of finite numbers, rounded to 2 decimals', () => {
  assert.equal(averageOf([1, 2, 3]), 2);
  assert.equal(averageOf([0.1, 0.2]), 0.15);
});

test('averageOf: nulls are dropped, not treated as zero', () => {
  assert.equal(averageOf([10, null, 20]), 15);
});

test('averageOf: an empty or all-null list is null, never zero or NaN', () => {
  assert.equal(averageOf([]), null);
  assert.equal(averageOf([null, null]), null);
  assert.equal(averageOf(undefined), null);
});

// ---------------------------------------------------------------------------
// opponentEntries (#1609)
// ---------------------------------------------------------------------------

test('opponentEntries: rank 1 allows the most points; a game with no row (bye) adds no entry', () => {
  const defenses = new Map([['DAL', { allowedPerGame: 30, games: 4 }], ['NYG', { allowedPerGame: 10, games: 4 }], ['PHI', { allowedPerGame: 20, games: 4 }]]);
  const out = opponentEntries([{ week: 5, opponent: 'DAL' }, { week: 6, opponent: 'NYG' }], defenses);
  assert.deepEqual(out, [
    { week: 5, opponent: 'DAL', rankVsPosition: 1, allowedPerGame: 30, games: 4 },
    { week: 6, opponent: 'NYG', rankVsPosition: 3, allowedPerGame: 10, games: 4 },
  ]);
});

test('opponentEntries: ties share the lower rank number', () => {
  const defenses = new Map([['A', { allowedPerGame: 9, games: 1 }], ['B', { allowedPerGame: 9, games: 1 }], ['C', { allowedPerGame: 5, games: 1 }]]);
  const out = opponentEntries([{ week: 1, opponent: 'B' }, { week: 2, opponent: 'C' }], defenses);
  assert.deepEqual(out.map((e) => e.rankVsPosition), [1, 3]);
});

test('opponentEntries: no allowance data is []', () => {
  assert.deepEqual(opponentEntries([{ week: 1, opponent: 'DAL' }], new Map()), []);
  assert.deepEqual(opponentEntries([{ week: 1, opponent: 'DAL' }], null), []);
});

test('usageEntryFromStats: offense side reads the offense snap keys', () => {
  const stats = { usageTargets: 6, usageOffenseSnaps: 58, usageOffenseSnapPct: 0.87, gameTeam: 'BUF' };
  const entry = usageEntryFromStats(stats, RULES, 30, 'offense');
  assert.equal(entry.snaps, 58);
  assert.equal(entry.snapShare, 0.87);
});

test('usageEntryFromStats: defense side reads the defense snap keys', () => {
  const stats = {
    usageOffenseSnaps: 3, usageOffenseSnapPct: 0.05, usageDefenseSnaps: 41, usageDefenseSnapPct: 0.62,
  };
  const entry = usageEntryFromStats(stats, RULES, null, 'defense');
  assert.equal(entry.snaps, 41);
  assert.equal(entry.snapShare, 0.62);
});

test('usageEntryFromStats: missing snap keys stay null, not zero', () => {
  const entry = usageEntryFromStats({ usageTargets: 6 }, RULES, 30, 'offense');
  assert.equal(entry.snaps, null);
  assert.equal(entry.snapShare, null);
});

test('memoLeagueContext (#1682): setting a new key sweeps entries past the lifetime', (t) => {
  t.mock.method(projectionFeatures, 'loadLeagueContext', async () => new Map());
  clearLeagueContextMemo();
  const now = t.mock.method(Date, 'now', () => 1_000);
  memoLeagueContext({ leagueId: 1, season: 2026, week: 3, rules: {}, position: 'WR' });
  assert.equal(leagueContextMemoSize(), 1);
  now.mock.mockImplementation(() => 1_000 + LEAGUE_CONTEXT_TTL_MS + 1);
  memoLeagueContext({ leagueId: 1, season: 2026, week: 4, rules: {}, position: 'WR' });
  assert.equal(leagueContextMemoSize(), 1);
});

// ---------------------------------------------------------------------------
// Start/sit chip context (#1853): the Line and weather a suggestion side carries
// ---------------------------------------------------------------------------

const pool = require('../modules/pool');
const {
  favoredByForTeam,
  chipLine,
  chipWeather,
  loadGameChipContext,
  loadWeather,
} = require('../services/decisionCardContext.service');

test('favoredByForTeam: a negative spread favours the home team, a positive one the away team', () => {
  // vegasOdds.provider: spread -3 is home favoured by 3.
  assert.equal(favoredByForTeam(-7.5, 'home'), 7.5);
  assert.equal(favoredByForTeam(-7.5, 'away'), -7.5);
  assert.equal(favoredByForTeam(3, 'away'), 3);
  assert.equal(favoredByForTeam(3, 'home'), -3);
});

test('favoredByForTeam: a pick-em is 0, and a missing spread or orientation is null', () => {
  assert.equal(favoredByForTeam(0, 'home'), 0);
  assert.equal(Object.is(favoredByForTeam(0, 'home'), -0), false);
  assert.equal(favoredByForTeam(null, 'home'), null);
  assert.equal(favoredByForTeam(-3, null), null);
  assert.equal(favoredByForTeam(-3, 'neutral'), null);
});

test('chipLine: {spread, total, favoredBy} and never the Implied team total (ADR 0037)', () => {
  const line = { spread: -7.5, total: 49.5, observedAt: 'x', impliedTeamTotal: 28.5 };
  const shaped = chipLine(line, 'home');
  assert.deepEqual(shaped, { spread: -7.5, total: 49.5, favoredBy: 7.5 });
  assert.equal('impliedTeamTotal' in shaped, false);
  assert.equal(chipLine(null, 'home'), null);
});

test('chipWeather: the five chip fields only, null for no weather', () => {
  const weather = {
    indoor: false, temperatureF: 40, windSpeedMph: 22, windGustMph: 30,
    precipitationProbability: 70, shortForecast: 'Rain',
  };
  assert.deepEqual(chipWeather(weather), {
    indoor: false, windSpeedMph: 22, windGustMph: 30, precipitationProbability: 70, shortForecast: 'Rain',
  });
  assert.equal(chipWeather(null), null);
});

test('loadGameChipContext: one odds and one weather read per game, keyed by folded team', async (t) => {
  const queries = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    queries.push({ text, params });
    if (text.includes('FROM "nfl_games"')) {
      return {
        rows: [
          { nfl_team: 'BUF', game_key: 'g1', roof: 'outdoors', home_away: 'home' },
          { nfl_team: 'NYJ', game_key: 'g1', roof: 'outdoors', home_away: 'away' },
          { nfl_team: 'DAL', game_key: 'g2', roof: 'dome', home_away: 'home' },
          { nfl_team: 'PHI', game_key: 'g3', roof: 'outdoors', home_away: 'home' },
        ],
      };
    }
    if (text.includes('FROM "game_odds_snapshots"')) {
      return { rows: [{ total: '49.5', spread: '-7.5', observed_at: 'now' }] };
    }
    if (text.includes('FROM "game_weather_snapshots"')) {
      return {
        rows: [{
          temperature_f: '40', wind_speed_mph: '22', wind_gust_mph: '30',
          precipitation_probability: '70', short_forecast: 'Rain', fetched_at: new Date(),
        }],
      };
    }
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  });

  const byTeam = await loadGameChipContext({ season: 2026, week: 6, nflTeams: ['BUF', 'NYJ', 'DAL'] });

  assert.equal(queries.filter((q) => q.text.includes('"game_odds_snapshots"')).length, 2, 'g1 and g2, not g3');
  assert.equal(queries.filter((q) => q.text.includes('"game_weather_snapshots"')).length, 1, 'g1 only: g2 is a dome');
  assert.deepEqual(byTeam.get('BUF').line, { spread: -7.5, total: 49.5, favoredBy: 7.5 });
  assert.deepEqual(byTeam.get('NYJ').line, { spread: -7.5, total: 49.5, favoredBy: -7.5 });
  assert.equal(byTeam.get('BUF').weather.windSpeedMph, 22);
  assert.equal(byTeam.get('DAL').weather.indoor, true);
  assert.equal(byTeam.has('PHI'), false, 'not in the lineup');
});

test('loadWeather: a snapshot more than 24 hours old is withheld, a fresher one is served (#1930)', async (t) => {
  const now = new Date('2026-09-10T12:00:00.000Z');
  const hoursAgo = (h) => new Date(now.getTime() - h * 3600 * 1000);
  let fetchedAt;
  t.mock.method(pool, 'query', async () => ({
    rows: [{
      temperature_f: '65', wind_speed_mph: null, wind_gust_mph: null,
      precipitation_probability: null, short_forecast: 'Rain Showers Likely', fetched_at: fetchedAt,
    }],
  }));

  fetchedAt = hoursAgo(71);
  assert.deepEqual(await loadWeather('g1', 'outdoors', now), {
    indoor: false, temperatureF: null, windSpeedMph: null, windGustMph: null,
    precipitationProbability: null, shortForecast: null,
  });
  fetchedAt = hoursAgo(18);
  const fresh = await loadWeather('g1', 'outdoors', now);
  assert.equal(fresh.temperatureF, 65);
  assert.equal(fresh.shortForecast, 'Rain Showers Likely');
});

test('loadGameChipContext: a one-line fixture can be set stale too, so the chips read unavailable (#1930)', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM "nfl_games"')) {
      return { rows: [{ nfl_team: 'BUF', game_key: 'g1', roof: 'outdoors', home_away: 'home' }] };
    }
    if (String(sql).includes('FROM "game_odds_snapshots"')) return { rows: [] };
    return {
      rows: [{
        temperature_f: '40', wind_speed_mph: '22', wind_gust_mph: '30', precipitation_probability: '70',
        short_forecast: 'Rain', fetched_at: new Date(Date.now() - 72 * 3600 * 1000),
      }],
    };
  });
  const byTeam = await loadGameChipContext({ season: 2026, week: 6, nflTeams: ['BUF'] });
  assert.equal(byTeam.get('BUF').weather.windSpeedMph, null);
  assert.equal(byTeam.get('BUF').weather.shortForecast, null);
});

test('loadGameChipContext: a team with no game (bye) or a row with no game_key has no entry', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    if (String(sql).includes('FROM "nfl_games"')) {
      return { rows: [{ nfl_team: 'BUF', opponent: 'NYJ' }] };
    }
    throw new Error('no odds or weather read without a game_key');
  });
  const byTeam = await loadGameChipContext({ season: 2026, week: 6, nflTeams: ['BUF', 'KC'] });
  assert.equal(byTeam.size, 0);
});

test('loadGameChipContext: rejected reads in several games reject once and leave no unhandled rejection (#1853)', async (t) => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "nfl_games"')) {
      return {
        rows: [
          { nfl_team: 'BUF', game_key: 'g1', roof: 'outdoors', home_away: 'home' },
          { nfl_team: 'DAL', game_key: 'g2', roof: 'outdoors', home_away: 'home' },
          { nfl_team: 'KC', game_key: 'g3', roof: 'outdoors', home_away: 'home' },
        ],
      };
    }
    // g1 is slow and healthy; g2 and g3 fail, g3 after g1 has settled.
    if (params[0] === 'g1') {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { rows: [] };
    }
    if (params[0] === 'g2') throw new Error('pool timeout g2');
    await new Promise((resolve) => setTimeout(resolve, 40));
    throw new Error('pool timeout g3');
  });

  await assert.rejects(
    loadGameChipContext({ season: 2026, week: 6, nflTeams: ['BUF', 'DAL', 'KC'] }),
    /pool timeout g2/
  );
  // Let g3's later rejection land; a handler-less promise would surface here.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(unhandled, []);
});

// ---------------------------------------------------------------------------
// Volatility tag (#1849): the card's tag off the run the card already reads
// ---------------------------------------------------------------------------

const { createFakePool } = require('./helpers/fakePool');
const { loadVolatility } = require('../services/decisionCardContext.service');
const { SCORING_RULES } = require('../services/scoringRules');

const OWN_FACTORS = {
  availability: { available: true },
  dataQuality: { residualSource: 'player', reasons: [] },
};

// A stored run row (snake_case, as the pool returns it): point estimate `point`,
// a p10..p90 Interval `width` wide.
function runRow(id, position, point, width, over = {}) {
  return {
    player_id: id,
    position,
    mean: point,
    median: point,
    p10: point - width / 2,
    p25: point - width / 4,
    p75: point + width / 4,
    p90: point + width / 2,
    sample_size: 16,
    factors: OWN_FACTORS,
    ...over,
  };
}

// The projection entry the card already holds for the player (camelCase).
function entryOf(row) {
  return {
    mean: row.mean,
    median: row.median,
    p10: row.p10,
    p25: row.p25,
    p75: row.p75,
    p90: row.p90,
    sampleSize: row.sample_size,
    factors: row.factors,
    modelVersion: require('../services/projectionModel').MODEL_VERSION,
  };
}

// Twelve WRs of one width, plus id 1 far wider (boom) and id 2 far narrower (steady).
function wrRun() {
  const rows = [runRow(1, 'WR', 11, 20), runRow(2, 'WR', 12, 2)];
  for (let id = 3; id <= 12; id += 1) rows.push(runRow(id, 'WR', 10 + id, 8));
  return rows;
}

function mockRun(t, rows, { runs = [{ id: 77 }] } = {}) {
  const fake = createFakePool([
    [/FROM "projection_runs"/, () => ({ rows: runs })],
    [/FROM "player_week_projections"/, () => ({ rows })],
  ]);
  fake.install(t);
  return fake.calls;
}

async function tagFor(rows, id, position = 'WR') {
  const row = rows.find((r) => r.player_id === id);
  return loadVolatility({
    season: 2026, week: 6, rules: SCORING_RULES, player: { id, position }, entry: entryOf(row),
  });
}

test('loadVolatility: one eligible player reads boom_or_bust, steady or null off the position\'s run rows, read per call', async (t) => {
  const rows = wrRun();
  const queries = mockRun(t, rows);

  assert.equal(await tagFor(rows, 1), 'boom_or_bust');
  assert.equal(await tagFor(rows, 2), 'steady');
  assert.equal(await tagFor(rows, 7), null);

  const rowReads = queries.filter((q) => q.text.includes('FROM "player_week_projections"'));
  assert.equal(rowReads.length, 3, 'one run lookup and one position read per call');
  assert.deepEqual(rowReads[0].params, [77, 'WR']);
});

for (const [label, over, position] of [
  ['an Unavailable player', { factors: { ...OWN_FACTORS, availability: { available: false, reason: 'out' } } }, 'WR'],
  ['a Position-baseline projection', { factors: { ...OWN_FACTORS, dataQuality: { residualSource: 'player', reasons: ['position baseline'] } } }, 'WR'],
  ['a pooled-residual projection', { factors: { ...OWN_FACTORS, dataQuality: { residualSource: 'pooled', reasons: [] } } }, 'WR'],
  ['a player with fewer than 8 games', { sample_size: 7 }, 'WR'],
  ['a kicker', {}, 'K'],
  ['a defense', {}, 'DEF'],
  ['an IDP player', {}, 'LB'],
]) {
  test(`loadVolatility: ${label} shows no tag and reads nothing`, async (t) => {
    const row = runRow(1, position, 11, 20, over);
    const queries = mockRun(t, [row, ...wrRun().slice(1)]);
    assert.equal(await tagFor([row], 1, position), null);
    assert.equal(queries.length, 0);
  });
}

test('loadVolatility: no run for the week, or a reference set under ten, shows no tag', async (t) => {
  const rows = wrRun();
  mockRun(t, rows, { runs: [] });
  assert.equal(await tagFor(rows, 1), null);

  t.mock.restoreAll();
  mockRun(t, rows.slice(0, 9));
  assert.equal(await tagFor(rows, 1), null);
});
test('loadVolatilityTags: one run lookup and one read per distinct position, tags merged across positions (#1858)', async (t) => {
  const wr = [...wrRun(), runRow(13, 'WR', 15, 8, { sample_size: 3 })]; // too few games
  const rb = [];
  for (let id = 101; id <= 112; id += 1) rb.push(runRow(id, 'RB', id - 90, 8));
  rb[0] = runRow(101, 'RB', 11, 20);
  const fake = createFakePool([
    [/FROM "projection_runs"/, () => ({ rows: [{ id: 77 }] })],
    [/FROM "player_week_projections"/, (text, params) => ({ rows: params[1] === 'WR' ? wr : rb })],
  ]);
  fake.install(t);
  const { loadVolatilityTags } = require('../services/decisionCardContext.service');

  const tags = await loadVolatilityTags({
    season: 2026, week: 6, rules: SCORING_RULES, positions: ['WR', 'RB', 'WR', 'K'],
  });

  assert.equal(tags.get(1), 'boom_or_bust');
  assert.equal(tags.get(2), 'steady');
  assert.equal(tags.get(101), 'boom_or_bust');
  assert.equal(tags.get(13), null, 'an ineligible row reads null, never a tag');
  assert.equal(fake.calls.filter((q) => q.text.includes('FROM "projection_runs"')).length, 1);
  assert.deepEqual(
    fake.calls.filter((q) => q.text.includes('FROM "player_week_projections"')).map((q) => q.params),
    [[77, 'WR'], [77, 'RB']],
  );
});

test('loadVolatilityTags: no taggable position reads nothing; no run for the week reads an empty map (#1858)', async (t) => {
  const fake = createFakePool([[/FROM "projection_runs"/, () => ({ rows: [] })]]);
  fake.install(t);
  const { loadVolatilityTags } = require('../services/decisionCardContext.service');
  assert.equal((await loadVolatilityTags({ season: 2026, week: 6, rules: SCORING_RULES, positions: ['K', 'DEF'] })).size, 0);
  assert.equal(fake.calls.length, 0);
  assert.equal((await loadVolatilityTags({ season: 2026, week: 6, rules: SCORING_RULES, positions: ['WR'] })).size, 0);
});
