const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const extract = require('../../scripts/backtest/extract-snapshot');
const store = require('../../scripts/backtest/lib/snapshotStore');
const { SOURCES } = require('../../scripts/backtest/lib/sources');
const { FANTASY_POSITIONS } = require('../../scripts/backtest/lib/mappings');

// The REAL production normalization, so the overlay's LA/LAR and WAS/WSH
// handling is tested against `fn_normalize_nfl_team`'s actual JS twin rather
// than a stand-in that would agree with a wrong implementation. Requiring it
// from a TEST is fine; `scripts/backtest` may not, which is why the extraction
// takes it as an injected dependency.
const { normalizeTeamKey } = require('../services/projectionFeatures');

const { normalizeSql, EXTRACTION_SQL, SQL_SURFACE } = extract;

/**
 * Everything in this file is pure: fake clients returning canned rows, fixture
 * CSVs handed in through an injected reader, a temporary output directory. No
 * database is opened, no socket, no environment variable read.
 */

function tmpRoot(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ez-extract-${label}-`));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const EXTRACTION_BY_SIG = new Map(
  Object.entries(EXTRACTION_SQL).map(([name, sql]) => [normalizeSql(sql), name])
);
const SURFACE_BY_SIG = new Map(SQL_SURFACE.map((e) => [normalizeSql(e.text), e.name]));

/** Four teams per season, in the app's Tank01 spellings (WSH, LAR included). */
const DB_PLAYERS = Object.freeze([
  { id: 1, external_id: '3001', name: 'Aaron Quarterback', position: 'QB', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: 1, team_key: 'KC' },
  { id: 2, external_id: '3002', name: 'Bella Runner', position: 'RB', nfl_team: 'WSH', injury_status: null, injury_detail: null, adp: 2, team_key: 'WAS' },
  { id: 3, external_id: '3003', name: 'Cara Receiver', position: 'WR', nfl_team: 'LAR', injury_status: null, injury_detail: null, adp: 3, team_key: 'LAR' },
  { id: 4, external_id: '3004', name: 'Dan Tightend', position: 'TE', nfl_team: 'BUF', injury_status: null, injury_detail: null, adp: 4, team_key: 'BUF' },
  { id: 5, external_id: '3005', name: 'Evan Kicker', position: 'K', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: 5, team_key: 'KC' },
  { id: 6, external_id: '3006', name: 'Kansas City Chiefs', position: 'DEF', nfl_team: 'Kansas City Chiefs', injury_status: null, injury_detail: null, adp: null, team_key: 'KC' },
  { id: 7, external_id: '3007', name: 'Washington Commanders', position: 'DEF', nfl_team: 'Washington Commanders', injury_status: null, injury_detail: null, adp: null, team_key: 'WAS' },
  { id: 8, external_id: '3008', name: 'Los Angeles Rams', position: 'DEF', nfl_team: 'Los Angeles Rams', injury_status: null, injury_detail: null, adp: null, team_key: 'LAR' },
  { id: 9, external_id: '3009', name: 'Buffalo Bills', position: 'DEF', nfl_team: 'Buffalo Bills', injury_status: null, injury_detail: null, adp: null, team_key: 'BUF' },
]);

/** Weekly rows only in 2024/2025: 2022 and 2023 are captured-as-empty. */
const DB_PLAYER_STATS = Object.freeze([
  { player_id: 1, season: 2024, week: 1, stats: { passingYards: 250, gameTeam: 'KC', gameOpponent: 'WSH' } },
  { player_id: 1, season: 2024, week: 2, stats: { passingYards: 300 } },
  { player_id: 2, season: 2025, week: 1, stats: { rushingYards: 80, gameTeam: 'WSH' } },
  { player_id: 3, season: 2025, week: 2, stats: { receptions: 6, gameTeam: 'LAR', gameOpponent: 'BUF' } },
]);

const DB_PLAYER_SEASON_STATS = Object.freeze([
  { player_id: 1, season: 2019, games_played: 16, stats: { passingYards: 4000 }, fantasy_points: 300 },
  { player_id: 2, season: 2023, games_played: 15, stats: { rushingYards: 900 }, fantasy_points: 180 },
]);

/**
 * Two games per season, four teams, written the way nfl_games writes them:
 * Tank01 spellings and a NULL home_away (production's 2024/2025 state).
 *
 * 2022 and 2023 return NOTHING, which models production: the history window
 * reaches them, the query runs, and it finds nothing. That is an OBSERVATION
 * and the manifest has to record it as one.
 */
function dbGames(season) {
  if (season < 2024) return [];
  return [
    { season, week: 1, nfl_team: 'KC', opponent: 'WSH', kickoff_at: `${season}-09-08T17:00:00.000Z`, game_key: `${season}-1-WSH-KC`, home_away: null, neutral_site: null, venue: null, roof: null, surface: null, latitude: null, longitude: null, rest_days: null, team_key: 'KC', opponent_key: 'WAS' },
    { season, week: 1, nfl_team: 'WSH', opponent: 'KC', kickoff_at: `${season}-09-08T17:00:00.000Z`, game_key: `${season}-1-WSH-KC`, home_away: null, neutral_site: null, venue: null, roof: null, surface: null, latitude: null, longitude: null, rest_days: null, team_key: 'WAS', opponent_key: 'KC' },
    { season, week: 2, nfl_team: 'LAR', opponent: 'BUF', kickoff_at: `${season}-09-15T17:00:00.000Z`, game_key: `${season}-2-BUF-LAR`, home_away: null, neutral_site: null, venue: null, roof: null, surface: null, latitude: null, longitude: null, rest_days: null, team_key: 'LAR', opponent_key: 'BUF' },
    { season, week: 2, nfl_team: 'BUF', opponent: 'LAR', kickoff_at: `${season}-09-15T17:00:00.000Z`, game_key: `${season}-2-BUF-LAR`, home_away: null, neutral_site: null, venue: null, roof: null, surface: null, latitude: null, longitude: null, rest_days: null, team_key: 'BUF', opponent_key: 'LAR' },
  ];
}

function csv(header, rows) {
  return [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n';
}

/**
 * Fixture games.csv: nflverse spellings, so `LA` and `WAS` are actually
 * exercised; one neutral-site game; a 2026 row that must survive in the raw
 * provenance store and nowhere else.
 */
const GAMES_CSV_ROWS = [
  { game_id: '2024_01_WAS_KC', season: 2024, game_type: 'REG', week: 1, gameday: '2024-09-08', gametime: '13:00', away_team: 'WAS', home_team: 'KC', away_score: 20, home_score: 27, location: 'Home' },
  { game_id: '2024_02_BUF_LA', season: 2024, game_type: 'REG', week: 2, gameday: '2024-09-15', gametime: '13:00', away_team: 'BUF', home_team: 'LA', away_score: 17, home_score: 24, location: 'Neutral' },
  { game_id: '2025_01_WAS_KC', season: 2025, game_type: 'REG', week: 1, gameday: '2025-09-07', gametime: '13:00', away_team: 'WAS', home_team: 'KC', away_score: 21, home_score: 28, location: 'Home' },
  { game_id: '2025_02_BUF_LA', season: 2025, game_type: 'REG', week: 2, gameday: '2025-09-14', gametime: '13:00', away_team: 'BUF', home_team: 'LA', away_score: 10, home_score: 13, location: 'Home' },
  { game_id: '2025_01_KC_BUF_POST', season: 2025, game_type: 'POST', week: 19, gameday: '2026-01-11', gametime: '13:00', away_team: 'KC', home_team: 'BUF', away_score: 3, home_score: 6, location: 'Home' },
  { game_id: '2026_01_KC_WAS', season: 2026, game_type: 'REG', week: 1, gameday: '2026-09-13', gametime: '13:00', away_team: 'KC', home_team: 'WAS', away_score: '', home_score: '', location: 'Home' },
];

const GAMES_CSV_HEADER = [
  'game_id', 'season', 'game_type', 'week', 'gameday', 'gametime',
  'away_team', 'home_team', 'away_score', 'home_score', 'location',
];

function fixtureSourceText(source, overrides = {}) {
  if (overrides[source.name]) return overrides[source.name];
  if (source.kind === 'roster_weekly') {
    return csv(['season', 'week', 'team', 'position', 'status', 'gsis_id', 'full_name', 'game_type'], [
      { season: source.season, week: 1, team: 'KC', position: 'QB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron Quarterback', game_type: 'REG' },
      { season: source.season, week: 1, team: 'WAS', position: 'RB', status: 'ACT', gsis_id: '00-0000002', full_name: 'Bella Runner', game_type: 'REG' },
      { season: source.season, week: 2, team: 'LA', position: 'WR', status: 'INA', gsis_id: '00-0000003', full_name: 'Cara Receiver', game_type: 'REG' },
      { season: source.season, week: 2, team: 'BUF', position: 'TE', status: 'ACT', gsis_id: '', full_name: 'Blank Id', game_type: 'REG' },
    ]);
  }
  if (source.kind === 'injuries') {
    const header = ['season', 'week', 'team', 'gsis_id', 'report_status', 'game_type', 'full_name', 'position'];
    const rows = [
      { season: source.season, week: 1, team: 'KC', gsis_id: '00-0000001', report_status: 'Questionable', game_type: 'REG', full_name: 'Aaron Quarterback', position: 'QB' },
    ];
    if (source.season === 2024) {
      // 2024 carries date_modified AND a resolvable duplicate player-week, the
      // shape section 2.4 of the preregistration recorded.
      rows.push({ season: 2024, week: 1, team: 'KC', gsis_id: '00-0000001', report_status: 'Out', game_type: 'REG', full_name: 'Aaron Quarterback', position: 'QB', date_modified: '2024-09-07T18:00:00Z' });
      rows[0].date_modified = '2024-09-06T18:00:00Z';
      return csv([...header, 'date_modified'], rows);
    }
    return csv([...header, 'season_type'], rows.map((r) => ({ ...r, season_type: 'REG' })));
  }
  if (source.kind === 'games') return csv(GAMES_CSV_HEADER, GAMES_CSV_ROWS);
  if (source.kind === 'stats_player_week') {
    return csv(['season', 'week', 'season_type', 'player_id', 'team', 'position'], [
      { season: source.season, week: 1, season_type: 'REG', player_id: '00-0000001', team: 'KC', position: 'QB' },
      { season: source.season, week: 1, season_type: 'REG', player_id: '00-0000002', team: 'WAS', position: 'RB' },
      { season: source.season, week: 2, season_type: 'REG', player_id: '00-0000003', team: 'BUF', position: 'WR' },
    ]);
  }
  if (source.kind === 'stats_team_week') {
    return csv(['season', 'week', 'season_type', 'team', 'opponent_team'], [
      { season: source.season, week: 1, season_type: 'REG', team: 'KC', opponent_team: 'WAS' },
    ]);
  }
  if (source.kind === 'players') {
    return csv(['gsis_id', 'espn_id'], [
      { gsis_id: '00-0000001', espn_id: '3001' },
      { gsis_id: '00-0000002', espn_id: '3002' },
      { gsis_id: '00-0000003', espn_id: '3003' },
      { gsis_id: 'ABB498348', espn_id: '9999' }, // legacy pre-GSIS shape, excluded by shape
      { gsis_id: '00-0000004', espn_id: '' },    // no espn id, simply unmappable
    ]);
  }
  throw new Error(`no fixture for kind ${source.kind}`);
}

function makeReadSource(overrides = {}) {
  return (source) => fixtureSourceText(source, overrides);
}

function fields(names) {
  return names.map((name, i) => ({ name, dataTypeID: 20 + i }));
}

/**
 * A fake pg client. It records every normalized SQL it is asked for, answers the
 * extraction's own queries from the fixtures above, and answers the production
 * surface with empty result sets. Each instance carries a unique tag so a test
 * can prove how many distinct clients a run touched.
 */
let clientSerial = 0;
function makeFakeClient({
  database = 'endzone_empire',
  role = 'backtest_ro',
  readOnly = 'on',
  isolation = 'repeatable read',
  players = DB_PLAYERS,
  playerStats = DB_PLAYER_STATS,
  playerSeasonStats = DB_PLAYER_SEASON_STATS,
  gamesFor = dbGames,
  dropFields = null,
} = {}) {
  const tag = `client-${++clientSerial}`;
  const log = [];
  const client = {
    tag,
    log,
    released: 0,
    names() { return log.map((e) => e.name); },
    async query(text, params = []) {
      const sql = typeof text === 'string' ? text : (text && text.text);
      const norm = normalizeSql(sql);
      const name = EXTRACTION_BY_SIG.get(norm) || SURFACE_BY_SIG.get(norm) || 'UNKNOWN';
      log.push({ name, norm, params, tag });
      const answer = (rows, columns) => ({
        rows,
        fields: dropFields === name ? undefined : fields(columns),
        rowCount: rows.length,
      });
      switch (name) {
        case 'identity': return answer([{ database, role }], ['database', 'role']);
        case 'transactionMode':
          return answer([{ transaction_read_only: readOnly, transaction_isolation: isolation }],
            ['transaction_read_only', 'transaction_isolation']);
        case 'setConfig': return answer([{ applied: params[1] }], ['applied']);
        case 'begin': case 'rollback': return answer([], []);
        case 'players':
          return answer(players.map((p) => ({ ...p })),
            ['id', 'external_id', 'name', 'position', 'nfl_team', 'injury_status', 'injury_detail', 'adp', 'team_key']);
        case 'playerStats':
          return answer(
            playerStats.filter((r) => r.season >= params[0] && r.season <= params[1]).map((r) => ({ ...r })),
            ['player_id', 'season', 'week', 'stats']
          );
        case 'playerSeasonStats':
          return answer(playerSeasonStats.filter((r) => r.season < params[0]).map((r) => ({ ...r })),
            ['player_id', 'season', 'games_played', 'stats', 'fantasy_points']);
        case 'nflGames':
          return answer(gamesFor(params[0]),
            ['season', 'week', 'nfl_team', 'opponent', 'kickoff_at', 'game_key', 'home_away',
              'neutral_site', 'venue', 'roof', 'surface', 'latitude', 'longitude', 'rest_days',
              'team_key', 'opponent_key']);
        case 'positionRank':
          return answer([...params[0]].sort().map((code, i) => ({ code, rank: i + 1 })), ['code', 'rank']);
        case 'playerNameRank':
          return answer(
            [...players].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id))
              .map((p, i) => ({ id: p.id, name: p.name, rank: i + 1 })),
            ['id', 'name', 'rank']
          );
        default:
          // Every production-surface query answers empty; the oracle tests care
          // about WHICH queries fired, not what they returned.
          return answer([], ['x']);
      }
    },
    release() { client.released++; },
  };
  return client;
}

function makeFakePool() {
  const pool = {
    calls: 0,
    async query() { pool.calls++; return { rows: [], fields: [] }; },
    async connect() { pool.calls++; return makeFakeClient(); },
  };
  return pool;
}

/**
 * A stand-in for the real `generateProjections` that issues the same SQL the
 * real one does, through whatever client it is handed. The real function is
 * injected in the gated run; this one exists so the branch assertions and the
 * "one client only" property can be tested with no database.
 */
function makeFakeGenerateProjections({ skipScan = false, extraSql = null, forceScan = false } = {}) {
  const calls = [];
  const fn = async ({ season, week, playerIds, client, weatherService, modelConstants, rules, hashValue, now }) => {
    calls.push({ season, week, playerIds, client, weatherService, modelConstants, rules, hashValue, now });
    const byName = new Map(SQL_SURFACE.map((e) => [e.name, e.text]));
    await client.query(byName.get('playersById'), [playerIds]);
    await client.query(byName.get('priorPlayerStats'), [playerIds, season - 2, season, week]);
    await client.query(byName.get('priorPlayerSeasonStats'), [playerIds, season]);
    await client.query(byName.get('targetWeekSchedule'), [season, week]);
    await client.query(byName.get('historyWindowSchedule'), [season - 2, season, week]);
    if ((week > 1 && !skipScan) || forceScan) {
      await client.query(byName.get('leagueScan'), [season, week, ['QB'], 60000]);
      await client.query(byName.get('defenseGameCount'), [season, week]);
    }
    await client.query(byName.get('byeWeeks'), [season, ['KC'], 18]);
    if (extraSql) await client.query(extraSql, []);
    return {
      projections: new Map(playerIds.map((id) => [id, { playerId: id, median: id * 1.5, mean: id * 1.6 }])),
      inputCutoff: new Date(`${season}-09-08T17:00:00.000Z`),
      sourceCoverage: {},
    };
  };
  fn.calls = calls;
  return fn;
}

function extractionDeps(overrides = {}) {
  return {
    normalizeTeamKey,
    generateProjections: makeFakeGenerateProjections(),
    rules: { passing: { yards: 0.04 }, receiving: { reception: 0.5 } },
    hashValue: 'abc123',
    modelConstants: { usage: { blendWeight: 0.25 } },
    modelVersion: 'free_baseline_v3.1',
    readSource: makeReadSource(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The 8 SQL texts
// ---------------------------------------------------------------------------

test('the pinned SQL surface is exactly the 8 texts production issues, each still verbatim in its source', () => {
  assert.equal(SQL_SURFACE.length, 8);
  assert.deepEqual(SQL_SURFACE.map((e) => e.name), [
    'playersById', 'priorPlayerStats', 'priorPlayerSeasonStats', 'targetWeekSchedule',
    'historyWindowSchedule', 'leagueScan', 'defenseGameCount', 'byeWeeks',
  ]);
  // Read production as TEXT, never require it: requiring projectionFeatures
  // from here would be fine, but the point is that the PIN is checked against
  // the file, so drift in either direction fails.
  const repoRoot = path.join(__dirname, '..', '..');
  const cache = new Map();
  for (const entry of SQL_SURFACE) {
    const file = entry.source.split(':')[0];
    if (!cache.has(file)) {
      cache.set(file, normalizeSql(fs.readFileSync(path.join(repoRoot, file), 'utf8')));
    }
    assert.ok(
      cache.get(file).includes(normalizeSql(entry.text)),
      `${entry.name} no longer appears verbatim in ${file}; the pinned surface has drifted`
    );
  }
  // Exactly two are conditional, matching the preregistration's section-15 table.
  assert.deepEqual(SQL_SURFACE.filter((e) => e.conditional).map((e) => e.name),
    ['leagueScan', 'defenseGameCount']);
});

test('signatures are whitespace-invariant but change on any real edit', () => {
  const [players] = SQL_SURFACE;
  assert.equal(
    extract.sqlSignature(players.text),
    extract.sqlSignature(players.text.replace(/\s+/g, '\n      '))
  );
  assert.notEqual(
    extract.sqlSignature(players.text),
    extract.sqlSignature(players.text.replace('"adp"', '"adp2"'))
  );
  const signed = extract.sqlSurfaceSignatures();
  assert.equal(signed.length, 8);
  assert.equal(new Set(signed.map((s) => s.signature)).size, 8);
  for (const entry of signed) assert.match(entry.signature, /^[0-9a-f]{64}$/);
});

test('the recording client refuses SQL the pinned surface does not contain', async () => {
  const client = makeFakeClient();
  const recording = extract.createRecordingClient(client, { surfaceOnly: true, label: 'oracle' });
  await recording.query(SQL_SURFACE[0].text, [[1]]);
  await assert.rejects(
    () => recording.query('SELECT * FROM "projection_runs"', []),
    /the pinned 8-query surface does not contain/
  );
  assert.deepEqual(recording.observedNames(), ['playersById']);
});

// ---------------------------------------------------------------------------
// The read-only transaction and the identity assertions
// ---------------------------------------------------------------------------

const DATA_QUERIES = new Set([
  'players', 'playerStats', 'playerSeasonStats', 'nflGames', 'positionRank', 'playerNameRank',
  ...SQL_SURFACE.map((e) => e.name),
]);

function openArgs(client, pool, overrides = {}) {
  return {
    connect: async () => client,
    pool,
    expectedDatabase: 'endzone_empire',
    expectedRole: 'backtest_ro',
    statementTimeoutMs: 300000,
    idleInTransactionSessionTimeoutMs: 60000,
    ...overrides,
  };
}

test('the setup sequence is timeouts, identity, BEGIN RR RO, transaction mode - then data', async () => {
  const client = makeFakeClient();
  const pool = makeFakePool();
  const txn = await extract.openReadOnlyTransaction(openArgs(client, pool));
  assert.deepEqual(client.names(), [
    'setConfig', 'setConfig', 'identity', 'begin', 'transactionMode',
  ]);
  assert.deepEqual(client.log[0].params, ['statement_timeout', '300000']);
  assert.deepEqual(client.log[1].params, ['idle_in_transaction_session_timeout', '60000']);
  assert.equal(client.log[3].norm, 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
  assert.deepEqual(txn.identity, {
    database: 'endzone_empire',
    role: 'backtest_ro',
    transactionReadOnly: 'on',
    transactionIsolation: 'repeatable read',
    statementTimeoutMs: 300000,
    idleInTransactionSessionTimeoutMs: 60000,
  });
  await txn.close();
  assert.equal(client.names().pop(), 'rollback');
  assert.equal(client.released, 1);
});

for (const [label, overrides, pattern] of [
  ['the wrong database', { database: 'some_other_db' }, /connected to database "some_other_db"/],
  ['the wrong role', { role: 'postgres' }, /connected as role "postgres"/],
  ['a writable transaction', { readOnly: 'off' }, /transaction_read_only is "off"/],
  ['the wrong isolation level', { isolation: 'read committed' }, /transaction_isolation is "read committed"/],
]) {
  test(`${label} aborts BEFORE any data read`, async () => {
    const client = makeFakeClient(overrides);
    const pool = makeFakePool();
    await assert.rejects(() => extract.openReadOnlyTransaction(openArgs(client, pool)), pattern);
    const dataReads = client.names().filter((n) => DATA_QUERIES.has(n));
    assert.deepEqual(dataReads, [], 'no data query was issued before the abort');
    // The connection is handed back and the pool is unlocked again, so a failed
    // attempt cannot leave the process unable to do anything else.
    assert.equal(client.released, 1);
    assert.equal(typeof pool.query, 'function');
    await pool.query();
  });
}

test('a misconfigured run never even opens a connection', async () => {
  let connects = 0;
  const connect = async () => { connects++; return makeFakeClient(); };
  const pool = makeFakePool();
  for (const [overrides, pattern] of [
    [{ expectedDatabase: null }, /without an expected database name/],
    [{ expectedRole: null }, /without an expected role name/],
    [{ pool: null }, /without a pool to lock out/],
    [{ statementTimeoutMs: 0 }, /statementTimeoutMs must be a positive integer/],
    [{ statementTimeoutMs: 1.5 }, /statementTimeoutMs must be a positive integer/],
    [{ idleInTransactionSessionTimeoutMs: -1 }, /idleInTransactionSessionTimeoutMs must be a positive integer/],
    [{ connect: null }, /requires a connect\(\) factory/],
  ]) {
    await assert.rejects(
      () => extract.openReadOnlyTransaction(openArgs(null, pool, { connect, ...overrides })),
      pattern
    );
  }
  assert.equal(connects, 0);
});

// ---------------------------------------------------------------------------
// The pool lockout
// ---------------------------------------------------------------------------

test('the global pool is locked out the moment the transaction client exists', async () => {
  const client = makeFakeClient();
  const pool = makeFakePool();
  const txn = await extract.openReadOnlyTransaction(openArgs(client, pool));
  assert.throws(() => pool.query('SELECT 1'), /global pool query\(\) is locked out/);
  assert.throws(() => pool.connect(), /global pool connect\(\) is locked out/);
  assert.equal(pool.calls, 0, 'nothing reached the pool while it was locked');
  await txn.close();
  // Restored afterwards, so the lockout is scoped to the extraction.
  await pool.query('SELECT 1');
  await pool.connect();
  assert.equal(pool.calls, 2);
});

test('every pool handed in is locked, because the gated run has two that matter', async () => {
  const client = makeFakeClient();
  const extractionPool = makeFakePool();
  const globalPool = makeFakePool();
  const txn = await extract.openReadOnlyTransaction(
    openArgs(client, [extractionPool, globalPool])
  );
  assert.throws(() => extractionPool.connect(), /locked out/);
  assert.throws(() => globalPool.query(), /locked out/);
  await txn.close();
  await extractionPool.query();
  await globalPool.query();
});

test('installPoolLockout is idempotent on restore and refuses to nest', () => {
  const pool = makeFakePool();
  const lock = extract.installPoolLockout(pool);
  assert.throws(() => extract.installPoolLockout(pool), /already installed/);
  assert.equal(lock.restore(), true);
  assert.equal(lock.restore(), false, 'a second restore is a no-op, not a double-unwrap');
  assert.equal(lock.restored, true);
  assert.throws(() => extract.installPoolLockout(null), /requires a pool-like object/);
  assert.throws(() => extract.installPoolLockout({}), /requires a pool-like object/);
});

test('a partly-failed multi-pool lockout leaves nothing locked', () => {
  const good = makeFakePool();
  const alreadyLocked = makeFakePool();
  const held = extract.installPoolLockout(alreadyLocked);
  assert.throws(() => extract.installPoolLockout([good, alreadyLocked]), /already installed/);
  // `good` was rolled back, so it still works.
  assert.equal(typeof good.query, 'function');
  assert.doesNotThrow(() => good.query());
  held.restore();
});

// ---------------------------------------------------------------------------
// Captures and collation artifacts
// ---------------------------------------------------------------------------

test('a client that returns no field metadata fails closed rather than fingerprinting nothing', async () => {
  const client = makeFakeClient({ dropFields: 'players' });
  await assert.rejects(
    () => extract.capture(client, { name: 'players', sql: EXTRACTION_SQL.players }),
    /returned no field metadata/
  );
});

test('jsonSafe refuses undefined rather than dropping the key, and names where it was', () => {
  // The obvious implementation, JSON.parse(JSON.stringify(x)), silently deletes
  // undefined-valued keys, which would make two different rows hash the same.
  assert.throws(() => extract.jsonSafe(undefined), /value is undefined/);
  assert.throws(() => extract.jsonSafe({ a: 1, b: undefined }, 'row'), (err) => {
    assert.match(err.message, /row\.b is undefined/, 'the error names the exact key');
    assert.match(err.message, /hash identically/);
    return true;
  });
  assert.throws(() => extract.jsonSafe({ a: { b: [1, undefined] } }, 'row'),
    /row\.a\.b\[1\] is undefined/);
  // Proof it is not merely lenient about the SHAPE: an explicit null is fine and
  // is distinguishable from an absent key.
  assert.deepEqual(extract.jsonSafe({ a: null }), { a: null });
  assert.notEqual(
    store.canonicalJson(extract.jsonSafe({ a: 1, b: null })),
    store.canonicalJson(extract.jsonSafe({ a: 1 }))
  );

  // Dates become ISO strings; that is the storage contract Phase 2 rehydrates.
  assert.equal(extract.jsonSafe(new Date('2025-09-08T17:00:00.000Z')), '2025-09-08T17:00:00.000Z');
  assert.deepEqual(
    extract.jsonSafe({ kickoff_at: new Date('2024-01-02T03:04:05.000Z') }),
    { kickoff_at: '2024-01-02T03:04:05.000Z' }
  );

  // Everything JSON cannot represent is refused rather than coerced.
  assert.throws(() => extract.jsonSafe(Number.NaN, 'x'), /x is NaN/);
  assert.throws(() => extract.jsonSafe(Infinity, 'x'), /x is Infinity/);
  assert.throws(() => extract.jsonSafe(Buffer.from('ab'), 'x'), /x is a Buffer/);
  assert.throws(() => extract.jsonSafe(() => {}, 'x'), /x is a function/);
  assert.throws(() => extract.jsonSafe(10n, 'x'), /x is a bigint/);

  // Ordinary values pass through unchanged.
  assert.deepEqual(extract.jsonSafe({ b: 2, a: [1, 'x', true, null] }),
    { b: 2, a: [1, 'x', true, null] });
});

test('an undefined value in a captured row stops the extraction instead of vanishing', async () => {
  const root = tmpRoot('undefrow');
  const holed = DB_PLAYERS.map((p, i) => (i === 0 ? { ...p, adp: undefined } : p));
  const client = makeFakeClient({ players: holed });
  const pool = makeFakePool();
  const txn = await extract.openReadOnlyTransaction(openArgs(client, pool));
  try {
    await assert.rejects(() => extract.runExtraction({
      client: txn.client, identity: txn.identity, outDir: root, apply: false, ...extractionDeps(),
    }), /players\[0\]\.adp is undefined/);
  } finally {
    await txn.close();
  }
  assert.deepEqual(fs.existsSync(root) ? fs.readdirSync(root) : [], [], 'nothing was written');
});

test('the players capture takes external_id, the only link from a DB player to the pinned sources', () => {
  // The crosswalk in players.csv maps gsis_id -> espn_id, and production joins
  // that to the players table through `external_id`
  // (nflverseSync.service.js:224 builds `idByExternal` from it; :177 and :548
  // look up `String(espnId)` in it). Without this column the reconstruction
  // cannot say which roster row is which database player, and no cohort can be
  // built at all.
  assert.match(normalizeSql(EXTRACTION_SQL.players), /SELECT "id", "external_id", "name"/);

  // It is deliberately NOT part of the 8-query production surface - that stays
  // exactly what generateProjections issues.
  for (const entry of SQL_SURFACE) {
    assert.ok(!normalizeSql(entry.text).includes('"external_id"'),
      `${entry.name} must not have grown a column; the surface mirrors production`);
  }
  const productionPlayers = SQL_SURFACE.find((e) => e.name === 'playersById');
  assert.ok(normalizeSql(productionPlayers.text).startsWith('SELECT "id", "name", "position"'),
    'the production players query is unchanged');
});

test('the two collation artifacts come from PostgreSQL ORDER BY, never a JS comparator', () => {
  // Comments are stripped first: the file DOCUMENTS that it must not use a JS
  // collator, and a docblock saying so is the opposite of a defect.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'backtest', 'extract-snapshot.js'), 'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/Intl\.Collator/.test(source), 'no Intl.Collator in the extraction code');
  assert.ok(!/localeCompare/.test(source), 'no localeCompare in the extraction code');
  assert.match(normalizeSql(EXTRACTION_SQL.positionRank),
    /row_number\(\) OVER \(ORDER BY "code"\).*ORDER BY "code"/);
  assert.match(normalizeSql(EXTRACTION_SQL.playerNameRank),
    /row_number\(\) OVER \(ORDER BY "name", "id"\).*ORDER BY "name", "id"/);
  // Artifact 1 runs over the closed set of week-position codes, in the
  // preregistration's fixed order (section 3.3).
  assert.deepEqual([...extract.WEEK_POSITION_CODES], ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
  assert.deepEqual([...extract.WEEK_POSITION_CODES], [...FANTASY_POSITIONS]);
});

// ---------------------------------------------------------------------------
// The oracles
// ---------------------------------------------------------------------------

test('the oracle weeks are exactly the preregistered six, with the section-15 branch table', () => {
  assert.deepEqual(extract.ORACLE_WEEKS.map((w) => `${w.season}W${w.week}`),
    ['2025W1', '2025W2', '2025W9', '2025W18', '2024W1', '2024W10']);
  assert.deepEqual(
    extract.ORACLE_WEEKS.filter((w) => !w.leagueScan).map((w) => `${w.season}W${w.week}`),
    ['2025W1', '2024W1'],
    'only the two Week 1 oracles have the scan off'
  );
  for (const w of extract.ORACLE_WEEKS) {
    assert.equal(w.leagueScan, w.defenseGameCount, 'both conditionals move together in the table');
    assert.equal(w.evaluated, w.week > 1, 'week 1 is a branch pin, never an evaluated week');
  }
});

test('ORACLE_WEEKS is the section-15 table of the SEALED preregistration, parsed from the document', () => {
  // Without this, the code and the tests would both carry the same literals and
  // agree with each other while disagreeing with the sealed document. The
  // preregistration is the authority, so it is read (never written) and parsed.
  const file = path.join(
    __dirname, '..', '..', 'backtest-artifacts', 'pit-sweep-2024-2025', 'PREREGISTRATION.md'
  );
  const text = fs.readFileSync(file, 'utf8');

  const heading = text.indexOf('## 15. Oracle weeks');
  assert.ok(heading > 0, 'section 15 is missing from the preregistration');
  const section = text.slice(heading, text.indexOf('\n## ', heading + 1));

  // The table rows look like:
  //   | 2025 W1 | OFF | OFF | ... |
  const parsed = [];
  for (const line of section.split('\n')) {
    const match = line.match(/^\|\s*(\d{4})\s*W(\d{1,2})\s*\|\s*(ON|OFF)\s*\|\s*(ON|OFF)\s*\|/);
    if (!match) continue;
    parsed.push({
      season: Number(match[1]),
      week: Number(match[2]),
      leagueScan: match[3] === 'ON',
      defenseGameCount: match[4] === 'ON',
    });
  }
  // Fail loud on a parse failure: silently finding nothing and passing would be
  // worse than no test at all.
  assert.equal(parsed.length, 6,
    `parsed ${parsed.length} oracle rows from section 15, expected 6 - the table format changed, `
    + 'so this test must be updated rather than skipped');

  assert.deepEqual(
    extract.ORACLE_WEEKS.map((w) => ({
      season: w.season, week: w.week, leagueScan: w.leagueScan, defenseGameCount: w.defenseGameCount,
    })),
    parsed,
    'ORACLE_WEEKS must match the sealed preregistration section 15, in order'
  );

  // Two anchoring facts the section states in prose, so a table that parsed but
  // meant something else would still be caught. Whitespace is collapsed first:
  // the document is hard-wrapped, so several of these phrases straddle a line
  // break and a raw substring check would fail on formatting rather than on
  // meaning.
  const prose = section.replace(/\s+/g, ' ');
  assert.ok(prose.includes('**Week 1 is NOT an evaluated week.**'));
  assert.ok(prose.includes('weeks 2-18'));
  // And the document names the same 8-query surface this module pins.
  const surfacePhrases = ['players by id', 'prior `player_stats`', 'prior `player_season_stats`',
    'target-week `nfl_games`', 'history-window `nfl_games`', 'the league-wide scan',
    'the normalized defense-game count', '`computeByeWeeks`'];
  assert.equal(surfacePhrases.length, SQL_SURFACE.length);
  for (const fragment of surfacePhrases) {
    assert.ok(prose.includes(fragment), `section 15 should name ${fragment}`);
  }
});

test('the oracle capture runs through the transaction client and nothing else', async () => {
  const client = makeFakeClient();
  const generateProjections = makeFakeGenerateProjections();
  const nameRankById = new Map(DB_PLAYERS.map((p, i) => [p.id, i + 1]));
  const oracles = await extract.captureOracles({
    client,
    generateProjections,
    players: DB_PLAYERS,
    nameRankById,
    rules: { r: 1 },
    hashValue: 'h',
    modelConstants: { c: 1 },
  });
  assert.equal(oracles.length, 6);
  // Every query landed on the single fake client, and the object handed to
  // production was the recording wrapper, not a pool or a second client.
  assert.equal(new Set(client.log.map((e) => e.tag)).size, 1);
  assert.equal(generateProjections.calls.length, 6);
  for (const call of generateProjections.calls) {
    assert.equal(call.weatherService, false, 'weather is disabled, so no network and an exact factor delta');
    assert.equal(typeof call.client.query, 'function');
    assert.ok(!('connect' in call.client), 'production is handed no way to open another connection');
    assert.ok(!('release' in call.client), 'production cannot release the extraction connection either');
  }
  // One recording wrapper per week (so per-week SQL is attributable), all of
  // them delegating to the same single transaction client asserted above.
  assert.equal(new Set(generateProjections.calls.map((c) => c.client)).size, 6);
  // Branch coverage matches the preregistration, week by week.
  const byWeek = new Map(oracles.map((o) => [`${o.season}W${o.week}`, o]));
  assert.equal(byWeek.get('2025W1').observedSql.includes('leagueScan'), false);
  assert.equal(byWeek.get('2024W1').observedSql.includes('defenseGameCount'), false);
  assert.equal(byWeek.get('2025W9').observedSql.includes('leagueScan'), true);
  assert.equal(byWeek.get('2025W9').observedSql.includes('defenseGameCount'), true);
  // ALL SIX oracles run against the SAME player set. This is what makes their
  // player and cohort hashes comparable across weeks, and it is why the cohort
  // is computed once outside the loop rather than per week.
  const [first] = oracles;
  for (const o of oracles) {
    assert.deepEqual(o.playerIds, first.playerIds, `${o.season} W${o.week} uses the same cohort`);
    assert.equal(o.playerHash, first.playerHash);
    assert.equal(o.cohortHash, first.cohortHash);
  }
  assert.equal(new Set(oracles.map((o) => o.playerHash)).size, 1);

  // Hashes are pinned and deterministic.
  for (const o of oracles) {
    assert.match(o.playerHash, /^[0-9a-f]{64}$/);
    assert.match(o.cohortHash, /^[0-9a-f]{64}$/);
    assert.match(o.outputHash, /^[0-9a-f]{64}$/);
    assert.equal(o.rows.length, o.playerIds.length);
    assert.equal(o.rows.every((r) => r.season === o.season && r.week === o.week), true);
  }
  const again = await extract.captureOracles({
    client: makeFakeClient(), generateProjections: makeFakeGenerateProjections(),
    players: DB_PLAYERS, nameRankById, rules: { r: 1 }, hashValue: 'h', modelConstants: { c: 1 },
  });
  assert.deepEqual(again.map((o) => o.outputHash), oracles.map((o) => o.outputHash));
});

test('every oracle week uses the identical cohort, on a fixture where the per-position cap binds', async () => {
  // DB_PLAYERS has at most one player at most positions, so `perPosition` never
  // binds there and a per-week cohort would be indistinguishable from a hoisted
  // one. This fixture has eight quarterbacks and a cap of three, so the slice
  // does real work and a cohort recomputed per week could differ.
  const many = [
    ...Array.from({ length: 8 }, (unused, i) => ({
      id: 100 + i, name: `QB ${String.fromCharCode(65 + i)}`, position: 'QB', team_key: 'KC',
    })),
    ...['RB', 'WR', 'TE', 'K', 'DEF'].map((position, i) => ({
      id: 200 + i, name: `Player ${position}`, position, team_key: 'KC',
    })),
  ];
  const nameRankById = new Map(
    [...many].sort((a, b) => (a.name < b.name ? -1 : 1)).map((p, i) => [p.id, i + 1])
  );
  const perPosition = 3;
  const cohort = extract.selectOracleCohort({ players: many, nameRankById, perPosition });
  assert.equal(cohort.length, 3 + 5, 'the cap binds: 3 of 8 QBs, plus one at each other position');
  assert.deepEqual(cohort.slice(0, 3), [100, 101, 102], 'the three best-ranked QBs, in rank order');

  const oracles = await extract.captureOracles({
    client: makeFakeClient(),
    generateProjections: makeFakeGenerateProjections(),
    players: many,
    nameRankById,
    rules: {},
    hashValue: 'h',
    modelConstants: {},
    perPosition,
  });
  assert.equal(oracles.length, 6);
  for (const oracle of oracles) {
    assert.deepEqual(oracle.playerIds, cohort,
      `${oracle.season} W${oracle.week} must use the same cohort as every other week`);
    assert.equal(oracle.playerIds.length, 8);
  }
  assert.equal(new Set(oracles.map((o) => o.playerIds.join(','))).size, 1);
  assert.equal(new Set(oracles.map((o) => o.playerHash)).size, 1);
  assert.equal(new Set(oracles.map((o) => o.cohortHash)).size, 1);
});

test('an oracle whose branch does not fire as preregistered fails the extraction', async () => {
  const nameRankById = new Map(DB_PLAYERS.map((p, i) => [p.id, i + 1]));
  const base = {
    players: DB_PLAYERS, nameRankById, rules: {}, hashValue: 'h', modelConstants: {},
  };
  // Scan-ON week where the scan did not fire.
  await assert.rejects(() => extract.captureOracles({
    ...base,
    client: makeFakeClient(),
    generateProjections: makeFakeGenerateProjections({ skipScan: true }),
    oracleWeeks: [{ season: 2025, week: 9, leagueScan: true, defenseGameCount: true }],
  }), /the leagueScan branch did not fire, but the sealed preregistration \(section 15\) says it must/);

  // Scan-OFF week where the scan DID fire.
  await assert.rejects(() => extract.captureOracles({
    ...base,
    client: makeFakeClient(),
    generateProjections: makeFakeGenerateProjections({ forceScan: true }),
    oracleWeeks: [{ season: 2025, week: 1, leagueScan: false, defenseGameCount: false }],
  }), /the leagueScan branch fired, but the sealed preregistration \(section 15\) says it must not/);
});

test('an oracle that issues unknown SQL, or misses an unconditional query, fails closed', async () => {
  const nameRankById = new Map(DB_PLAYERS.map((p, i) => [p.id, i + 1]));
  await assert.rejects(() => extract.captureOracles({
    client: makeFakeClient(),
    generateProjections: makeFakeGenerateProjections({ extraSql: 'SELECT 1 FROM "leagues"' }),
    players: DB_PLAYERS, nameRankById, rules: {}, hashValue: 'h', modelConstants: {},
    oracleWeeks: [{ season: 2025, week: 9, leagueScan: true, defenseGameCount: true }],
  }), /the pinned 8-query surface does not contain/);

  // A scan-OFF week, so the conditional-branch check is satisfied and the
  // MISSING UNCONDITIONAL query is what the failure has to be about.
  const silent = async () => ({ projections: new Map(), inputCutoff: null });
  await assert.rejects(() => extract.captureOracles({
    client: makeFakeClient(),
    generateProjections: silent,
    players: DB_PLAYERS, nameRankById, rules: {}, hashValue: 'h', modelConstants: {},
    oracleWeeks: [{ season: 2025, week: 1, leagueScan: false, defenseGameCount: false }],
  }), /the unconditional query playersById was never issued/);
});

test('the oracle cohort is deterministic, covers all six positions, and fails closed on a missing rank', () => {
  const nameRankById = new Map(DB_PLAYERS.map((p, i) => [p.id, i + 1]));
  const a = extract.selectOracleCohort({ players: DB_PLAYERS, nameRankById });
  const b = extract.selectOracleCohort({ players: [...DB_PLAYERS].reverse(), nameRankById });
  assert.deepEqual(a, b, 'input order cannot change the cohort');
  const positions = new Set(a.map((id) => DB_PLAYERS.find((p) => p.id === id).position));
  assert.deepEqual([...positions].sort(), ['DEF', 'K', 'QB', 'RB', 'TE', 'WR']);
  assert.throws(
    () => extract.selectOracleCohort({ players: DB_PLAYERS, nameRankById: new Map() }),
    /has no captured name rank/
  );
  assert.throws(
    () => extract.selectOracleCohort({
      players: DB_PLAYERS.filter((p) => p.position !== 'K'), nameRankById,
    }),
    /no players at position\(s\) K/
  );
});

// ---------------------------------------------------------------------------
// The orientation overlay
// ---------------------------------------------------------------------------

test('the overlay emits two rows per game, normalizes LA/WAS, and flags neutral sites', () => {
  const gamesRows = GAMES_CSV_ROWS.map((r) => ({ ...r }));
  const overlay = extract.buildOrientationOverlay({
    gamesRows, seasons: [2024, 2025], normalizeTeamKey,
  });
  // 2 REG games per season -> 4 team-rows per season. POST and 2026 excluded.
  assert.deepEqual(overlay.teamRowsBySeason, { 2024: 4, 2025: 4 });
  assert.deepEqual(overlay.gamesBySeason, { 2024: 2, 2025: 2 });
  assert.equal(overlay.neutralGames, 1);
  assert.equal(overlay.rows.length, 8);
  assert.equal(overlay.rows.every((r) => r.season < store.QUARANTINE_FROM_SEASON), true);

  // games.csv's `WAS` and `LA` fold to the SAME keys nfl_games' `WSH` and `LAR`
  // fold to. Getting this wrong would silently miss two teams every week.
  const keys = new Set(overlay.rows.map((r) => r.team_key));
  assert.deepEqual([...keys].sort(), ['BUF', 'KC', 'LAR', 'WAS']);
  assert.equal(normalizeTeamKey('WAS'), normalizeTeamKey('WSH'));
  assert.equal(normalizeTeamKey('LA'), normalizeTeamKey('LAR'));

  const was = overlay.rows.find((r) => r.season === 2024 && r.week === 1 && r.team_key === 'WAS');
  assert.equal(was.home_away, 'away', 'games.csv lists WAS as the away team');
  assert.equal(was.source_team, 'WAS', 'the raw source spelling is kept for audit');
  assert.equal(was.neutral_site, false);
  const kc = overlay.rows.find((r) => r.season === 2024 && r.week === 1 && r.team_key === 'KC');
  assert.equal(kc.home_away, 'home');
  assert.equal(kc.opponent_key, 'WAS');

  // The neutral game keeps BOTH orientations and flags both rows: production's
  // `scheduleOrientation` returns null when `neutral_site === true` regardless
  // of home_away, so the flag is what removes it from the home-field factor.
  const neutral = overlay.rows.filter((r) => r.game_id === '2024_02_BUF_LA');
  assert.equal(neutral.length, 2);
  assert.deepEqual(neutral.map((r) => r.team_key).sort(), ['BUF', 'LAR']);
  assert.deepEqual(neutral.map((r) => r.neutral_site), [true, true]);
  assert.deepEqual(neutral.map((r) => r.home_away).sort(), ['away', 'home']);
  assert.equal(neutral.find((r) => r.team_key === 'LAR').home_away, 'home');

  // Deterministic order: season, week, team key.
  const ordered = [...overlay.rows]
    .map((r) => `${r.season}:${r.week}:${r.team_key}`);
  assert.deepEqual(ordered, [...ordered].sort());
});

test('the overlay treats an absent location as unknown, never as "not neutral"', () => {
  const overlay = extract.buildOrientationOverlay({
    gamesRows: [{ game_id: 'g', season: 2025, game_type: 'REG', week: 3, home_team: 'KC', away_team: 'BUF', location: '' }],
    seasons: [2025],
    normalizeTeamKey,
  });
  assert.deepEqual(overlay.rows.map((r) => r.neutral_site), [null, null]);
  assert.equal(overlay.neutralGames, 0);
});

test('the overlay refuses an unmappable team code, a bad week, and a duplicated team-week', () => {
  const base = { game_id: 'g', season: 2025, game_type: 'REG', week: 3, home_team: 'KC', away_team: 'BUF', location: 'Home' };
  assert.throws(() => extract.buildOrientationOverlay({
    gamesRows: [{ ...base, home_team: '' }], seasons: [2025], normalizeTeamKey,
  }), /unmappable team code/);
  assert.throws(() => extract.buildOrientationOverlay({
    gamesRows: [{ ...base, week: 19 }], seasons: [2025], normalizeTeamKey,
  }), /has week 19/);
  assert.throws(() => extract.buildOrientationOverlay({
    gamesRows: [base, { ...base, game_id: 'h', away_team: 'LA' }], seasons: [2025], normalizeTeamKey,
  }), /KC appears twice in 2025 week 3/);
  assert.throws(() => extract.buildOrientationOverlay({
    gamesRows: [base], seasons: [2025], normalizeTeamKey: null,
  }), /requires the production normalizeTeamKey to be injected/);
});

// ---------------------------------------------------------------------------
// Fail-closed integrity checks, one at a time
// ---------------------------------------------------------------------------

test('checkCrosswalkIntegrity: duplicate pairs and one-to-many mappings each fail', () => {
  const good = [
    { gsis_id: '00-0000001', espn_id: '1' },
    { gsis_id: '00-0000002', espn_id: '2' },
    { gsis_id: 'ABB498348', espn_id: '3' }, // legacy shape, excluded by shape
    { gsis_id: '00-0000003', espn_id: '' }, // unmappable, not an error
  ];
  const result = extract.checkCrosswalkIntegrity(good);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.counts, { rows: 4, mappable: 2, legacyShape: 1 });

  assert.throws(() => extract.checkCrosswalkIntegrity([
    { gsis_id: '00-0000001', espn_id: '1' }, { gsis_id: '00-0000001', espn_id: '1' },
  ]), /duplicate \(gsis, espn\) pair/);
  assert.throws(() => extract.checkCrosswalkIntegrity([
    { gsis_id: '00-0000001', espn_id: '1' }, { gsis_id: '00-0000001', espn_id: '2' },
  ]), /maps to two espn ids/);
  assert.throws(() => extract.checkCrosswalkIntegrity([
    { gsis_id: '00-0000001', espn_id: '1' }, { gsis_id: '00-0000002', espn_id: '1' },
  ]), /maps to two gsis ids/);
  assert.throws(() => extract.checkCrosswalkIntegrity([
    { gsis_id: '00-0000001', espn_id: 'abc' },
  ]), /malformed espn id/);
});

test('checkPlayerIds: a non-integer or duplicated player id fails', () => {
  assert.equal(extract.checkPlayerIds([{ id: 1 }, { id: 2 }]).status, 'passed');
  assert.throws(() => extract.checkPlayerIds([{ id: 'x' }]), /carries id "x"/);
  assert.throws(() => extract.checkPlayerIds([{ id: 0 }]), /carries id 0/);
  assert.throws(() => extract.checkPlayerIds([{ id: 1.5 }]), /carries id 1.5/);
  assert.throws(() => extract.checkPlayerIds([{ id: 1 }, { id: 1 }]), /duplicate players row for id 1/);
});

test('checkRosterPlayerWeeks: a duplicate roster player-week fails, a blank gsis id is counted', () => {
  const rows = [
    { season: 2024, week: 1, game_type: 'REG', gsis_id: '00-0000001' },
    { season: 2024, week: 1, game_type: 'REG', gsis_id: '' },
    { season: 2024, week: 2, game_type: 'REG', gsis_id: '00-0000001' },
  ];
  const result = extract.checkRosterPlayerWeeks(rows, { label: 'roster_weekly_2024' });
  assert.deepEqual(result.counts, { rows: 3, blankGsisId: 1 });
  assert.throws(() => extract.checkRosterPlayerWeeks([rows[0], { ...rows[0] }],
    { label: 'roster_weekly_2024' }), /duplicate roster player-week/);
});

test('checkInjuryPlayerWeeks: resolvable duplicates pass, unresolvable ones fail closed', () => {
  const dup = (date_modified) => ({ season: 2024, week: 15, game_type: 'REG', gsis_id: '00-0034270', date_modified });
  // The real 2024 shape: two successive revisions with distinct timestamps.
  assert.equal(extract.checkInjuryPlayerWeeks(
    [dup('2024-12-13T18:00:00Z'), dup('2024-12-14T18:00:00Z')],
    { label: 'injuries_2024', hasDateModified: true }
  ).counts.duplicateKeys, 1);
  // 2025: no date_modified column, and no duplicates, so it passes.
  assert.equal(extract.checkInjuryPlayerWeeks(
    [{ season: 2025, week: 1, game_type: 'REG', gsis_id: '00-0000001' }],
    { label: 'injuries_2025', hasDateModified: false }
  ).status, 'passed');
  // A duplicate with no timestamp column cannot be resolved by section 3.4.
  assert.throws(() => extract.checkInjuryPlayerWeeks(
    [dup(undefined), dup(undefined)], { label: 'injuries_2025', hasDateModified: false }
  ), /no date_modified column/);
  // An exact tie fails closed rather than picking one.
  assert.throws(() => extract.checkInjuryPlayerWeeks(
    [dup('2024-12-13T18:00:00Z'), dup('2024-12-13T18:00:00Z')],
    { label: 'injuries_2024', hasDateModified: true }
  ), /ties exactly on date_modified/);
  assert.throws(() => extract.checkInjuryPlayerWeeks(
    [dup('2024-12-13T18:00:00Z'), dup('')], { label: 'injuries_2024', hasDateModified: true }
  ), /blank date_modified/);
});

test('checkDefenseMappings: a missing or duplicated DEF unit fails', () => {
  const teamKeys = ['KC', 'WAS', 'LAR', 'BUF'];
  assert.equal(extract.checkDefenseMappings({
    dbPlayers: DB_PLAYERS, teamKeys, normalizeTeamKey,
  }).counts.defPlayers, 4);
  assert.throws(() => extract.checkDefenseMappings({
    dbPlayers: DB_PLAYERS.filter((p) => p.team_key !== 'BUF' || p.position !== 'DEF'),
    teamKeys, normalizeTeamKey,
  }), /no DEF player for team\(s\) BUF/);
  assert.throws(() => extract.checkDefenseMappings({
    dbPlayers: [...DB_PLAYERS, { id: 99, external_id: '3099', name: 'KC again', position: 'DEF', nfl_team: 'KC', team_key: 'KC' }],
    teamKeys, normalizeTeamKey,
  }), /two DEF players map to KC/);
  assert.throws(() => extract.checkDefenseMappings({
    dbPlayers: [{ id: 5, external_id: '3005', name: 'nowhere', position: 'DEF', nfl_team: '', team_key: null }],
    teamKeys: [], normalizeTeamKey,
  }), /has no resolvable team/);
});

test('checkSourceColumns: a source missing a preregistered column fails', () => {
  const headers = new Map(SOURCES.map((s) => [s.name, [...s.requiredColumns]]));
  assert.equal(extract.checkSourceColumns(headers).counts.sources, SOURCES.length);
  const short = new Map(headers);
  short.set('games', ['game_id', 'season']);
  assert.throws(() => extract.checkSourceColumns(short), /games: schema validation failed, missing column/);
  const absent = new Map(headers);
  absent.delete('players');
  assert.throws(() => extract.checkSourceColumns(absent), /players was never read/);
});

test('checkTargetSeasonsPopulated: a target season captured as empty is a broken capture', () => {
  assert.equal(extract.checkTargetSeasonsPopulated({ 2024: 10, 2025: 12 }, [2024, 2025]).status, 'passed');
  assert.throws(() => extract.checkTargetSeasonsPopulated({ 2024: 10, 2025: 0 }, [2024, 2025]),
    /captured no player_stats rows for target season\(s\) 2025/);
});

test('checkCaptureQuarantine: a 2026 row anywhere in a capture stops the extraction', () => {
  assert.equal(extract.checkCaptureQuarantine([
    { name: 'player_stats', rows: [{ season: 2025 }] },
  ]).status, 'passed');
  assert.throws(() => extract.checkCaptureQuarantine([
    { name: 'player_stats', rows: [{ season: 2025 }, { season: 2026 }] },
  ]), /a season 2026 row reached the extraction/);
});

// ---------------------------------------------------------------------------
// Dry run, apply, manifest
// ---------------------------------------------------------------------------

async function extractOnce({ apply, root, overrides = {} } = {}) {
  const client = makeFakeClient();
  const pool = makeFakePool();
  const txn = await extract.openReadOnlyTransaction(openArgs(client, pool));
  try {
    const result = await extract.runExtraction({
      client: txn.client,
      identity: txn.identity,
      outDir: root,
      apply,
      ...extractionDeps(overrides),
    });
    return { result, client, pool };
  } finally {
    await txn.close();
  }
}

/** The plan's sequence: dry run first, then apply. */
async function extractDryThenApply(root, overrides = {}) {
  const dry = await extractOnce({ apply: false, root, overrides });
  const applied = await extractOnce({ apply: true, root, overrides });
  return { dry, ...applied };
}

/** Every dataset the extraction writes: 17 with the widened schedule window. */
const EXPECTED_DATASET_COUNT = 3 /* players, player_stats, player_season_stats */
  + 4 /* nfl_games 2022-2025 */
  + 3 /* overlay, position_rank, player_name_rank */
  + 1 /* games_csv provenance */
  + 6 /* oracles */;

test('the default mode reads and checks everything and writes no snapshot', async () => {
  const root = tmpRoot('dryrun');
  const { result, client } = await extractOnce({ apply: false, root });
  assert.equal(result.applied, false);
  // The ONLY thing a dry run leaves behind is the receipt that authorizes the
  // write. No dataset, no manifest.
  assert.deepEqual(fs.readdirSync(root), ['dry-run-receipt.json']);
  // It really did read: every capture query fired, and the checks all ran.
  const names = new Set(client.names());
  for (const q of ['players', 'playerStats', 'playerSeasonStats', 'nflGames', 'positionRank', 'playerNameRank']) {
    assert.ok(names.has(q), `${q} was captured`);
  }
  assert.equal(result.checks.every((c) => c.status === 'passed'), true);
  assert.equal(result.datasets.length, EXPECTED_DATASET_COUNT);
  assert.equal(result.oracles.length, 6);
});

test('--apply writes every dataset, and the manifest pins what the freeze needs', async () => {
  const root = tmpRoot('apply');
  const { result } = await extractDryThenApply(root);
  const manifest = store.loadManifest(root);

  assert.equal(result.applied, true);
  assert.equal(manifest.studyId, 'pit-sweep-2024-2025');
  assert.equal(manifest.quarantineFromSeason, 2026);
  assert.deepEqual(manifest.seasons, [2024, 2025]);

  // The complete history production can query: weekly rows from season-2, and
  // every earlier season of player_season_stats.
  assert.deepEqual(manifest.weeklyStatSeasons, [2022, 2023, 2024, 2025]);
  assert.deepEqual(manifest.capturedAsEmpty.player_stats, [2022, 2023]);
  assert.deepEqual(manifest.weeklyRowsBySeason, { 2022: 0, 2023: 0, 2024: 2, 2025: 2 });
  assert.equal(manifest.rowCounts.player_season_stats, 2, 'unbounded below: 2019 is captured too');

  // nfl_games spans the SAME window, because historyWindowSchedule reads
  // `season >= target - 2` and those rows feed opponentByTeamWeek.
  assert.deepEqual(manifest.scheduleSeasons, manifest.weeklyStatSeasons);
  assert.deepEqual(manifest.scheduleRowsBySeason, { 2022: 0, 2023: 0, 2024: 4, 2025: 4 });
  assert.deepEqual(manifest.capturedAsEmpty.nfl_games, [2022, 2023],
    'a season the schedule query reached and found empty is recorded as an observation');

  // The 8 SQL texts, signed.
  assert.equal(manifest.sqlSurface.length, 8);
  assert.deepEqual(manifest.sqlSurface.map((s) => s.signature),
    extract.sqlSurfaceSignatures().map((s) => s.signature));

  // Schema fingerprint per captured relation.
  assert.deepEqual(Object.keys(manifest.schemaFingerprint).sort(), [
    'nfl_games_2022', 'nfl_games_2023', 'nfl_games_2024', 'nfl_games_2025',
    'player_name_rank', 'player_season_stats', 'player_stats', 'players', 'position_rank',
  ]);
  for (const entry of Object.values(manifest.schemaFingerprint)) {
    assert.match(entry.fingerprint, /^[0-9a-f]{64}$/);
    assert.ok(entry.fields.length > 0);
  }

  // Identity assertions passed, recorded.
  assert.deepEqual(manifest.database, {
    database: 'endzone_empire',
    role: 'backtest_ro',
    transactionReadOnly: 'on',
    transactionIsolation: 'repeatable read',
    statementTimeoutMs: 300000,
    idleInTransactionSessionTimeoutMs: 60000,
  });

  // Collation artifact hashes.
  assert.match(manifest.collation.positionRank.hash, /^[0-9a-f]{64}$/);
  assert.match(manifest.collation.playerNameRank.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(manifest.collation.positionRank.codes, ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

  // Oracle hashes and branch record.
  assert.equal(manifest.oracles.length, 6);
  for (const oracle of manifest.oracles) {
    assert.match(oracle.playerHash, /^[0-9a-f]{64}$/);
    assert.match(oracle.cohortHash, /^[0-9a-f]{64}$/);
    assert.match(oracle.outputHash, /^[0-9a-f]{64}$/);
  }
  assert.equal(manifest.oracleSettings.weatherService, false);

  // Source hashes, recomputed from the bytes the extraction actually read.
  assert.equal(manifest.sources.length, SOURCES.length);
  for (const source of manifest.sources) assert.match(source.sha256, /^[0-9a-f]{64}$/);

  // Overlay counts, and the explicit record that nothing was written to the DB.
  assert.deepEqual(manifest.overlay.teamRowsBySeason, { 2024: 4, 2025: 4 });
  assert.equal(manifest.overlay.neutralGames, 1);
  assert.equal(manifest.overlay.writtenToDatabase, false);
  assert.equal(manifest.overlay.quarantinedProvenanceRows, 1);

  // Timestamp and integrity-check log.
  assert.match(manifest.extractedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(manifest.dryRunAt, /^\d{4}-\d{2}-\d{2}T/, 'the manifest records the dry run it followed');
  assert.match(manifest.planDigest, /^[0-9a-f]{64}$/);
  assert.ok(manifest.integrityChecks.length >= 8);
  assert.equal(manifest.integrityChecks.every((c) => c.status === 'passed'), true);

  // Every dataset loads back, digest-verified against the manifest's own pin.
  assert.equal(manifest.datasets.length, EXPECTED_DATASET_COUNT);
  for (const entry of manifest.datasets) {
    const loaded = store.loadDataset({
      root, store: entry.store, path: entry.path, dataset: entry.dataset,
      expectedSha256: entry.sha256,
    });
    assert.equal(loaded.rows.length, entry.rowCount);
  }
});

test('the raw store keeps games.csv 2026 rows; the evaluation store has none', async () => {
  const root = tmpRoot('stores');
  await extractDryThenApply(root);
  const raw = store.loadDataset({
    root, store: store.STORES.RAW, path: store.PATHS.PROVENANCE, dataset: 'games_csv',
  });
  assert.equal(raw.rows.filter((r) => r.season === 2026).length, 1);
  const manifest = store.loadManifest(root);
  for (const entry of manifest.datasets.filter((d) => d.store === store.STORES.EVALUATION)) {
    const loaded = store.loadDataset({ root, ...entry, path: entry.path });
    assert.equal(
      loaded.rows.every((r) => store.seasonOf(r) === null || store.seasonOf(r) < 2026), true,
      `${entry.dataset} holds only pre-2026 rows`
    );
  }
  // Oracles are on the OUTCOME path, so they can never be read as features.
  const oracleEntries = manifest.datasets.filter((d) => d.dataset.startsWith('oracle_'));
  assert.equal(oracleEntries.length, 6);
  assert.equal(oracleEntries.every((d) => d.path === store.PATHS.OUTCOME), true);

  // games_csv is on the PROVENANCE path, which is what makes the one dataset
  // holding 2026 rows structurally unreachable from a feature loader.
  const gamesEntry = manifest.datasets.find((d) => d.dataset === 'games_csv');
  assert.equal(gamesEntry.path, store.PATHS.PROVENANCE);
  assert.throws(() => store.loadForFeaturePath({
    root, store: store.STORES.RAW, dataset: 'games_csv',
  }), /is a provenance dataset and may never be read into the feature path/);
});

test('the schedule capture window equals the weekly window, and empty seasons are observations', async () => {
  const root = tmpRoot('window');
  const { result } = await extractDryThenApply(root);
  const manifest = store.loadManifest(root);

  // The window the plan requires: season-2 through the last target season.
  assert.deepEqual(manifest.scheduleSeasons, [2022, 2023, 2024, 2025]);
  assert.deepEqual(manifest.scheduleSeasons, manifest.weeklyStatSeasons);

  // Every season in the window has a dataset, including the two the query
  // reached and found nothing in. Their emptiness is RECORDED.
  for (const season of manifest.scheduleSeasons) {
    const entry = manifest.datasets.find((d) => d.dataset === `nfl_games_${season}`);
    assert.ok(entry, `nfl_games_${season} was written`);
    const loaded = store.loadDataset({ root, ...entry, path: entry.path });
    assert.equal(loaded.rows.length, season < 2024 ? 0 : 4);
  }
  assert.deepEqual(manifest.capturedAsEmpty.nfl_games, [2022, 2023]);
  assert.equal(result.applied, true);

  // The regression this guards: capturing only the target seasons would answer
  // historyWindowSchedule (`season >= target - 2`) with a strictly smaller set
  // than the in-transaction oracle saw.
  assert.equal(
    extract.extractionPlan().scheduleSeasons.length,
    extract.extractionPlan().weeklyStatSeasons.length
  );
  assert.equal(extract.extractionPlan().scheduleSeasons[0],
    Math.min(...extract.extractionPlan().seasons) - extract.HISTORY_SEASONS);
});

test('a schedule season with rows is captured, not assumed empty', async () => {
  // The mirror of the case above: when production DOES hold 2023 schedule rows,
  // they are captured and 2023 is not listed as empty.
  const root = tmpRoot('window2023');
  const overrides = {};
  const withEarly = (season) => (season === 2023 ? dbGames(2024).map((r) => ({ ...r, season: 2023 })) : dbGames(season));
  for (const apply of [false, true]) {
    const client = makeFakeClient({ gamesFor: withEarly });
    const pool = makeFakePool();
    const txn = await extract.openReadOnlyTransaction(openArgs(client, pool));
    try {
      await extract.runExtraction({
        client: txn.client, identity: txn.identity, outDir: root, apply, ...extractionDeps(overrides),
      });
    } finally {
      await txn.close();
    }
  }
  const manifest = store.loadManifest(root);
  assert.deepEqual(manifest.capturedAsEmpty.nfl_games, [2022]);
  assert.equal(manifest.scheduleRowsBySeason['2023'], 4);
});

// ---------------------------------------------------------------------------
// Dry-run-first, enforced by the receipt
// ---------------------------------------------------------------------------

test('--apply on a first invocation is refused: there is no dry-run receipt', async () => {
  const root = tmpRoot('noreceipt');
  await assert.rejects(
    () => extractOnce({ apply: true, root }),
    /refusing to --apply: no dry-run receipt/
  );
  // And nothing was written, so the refusal is not a half-applied snapshot.
  assert.deepEqual(fs.existsSync(root) ? fs.readdirSync(root) : [], []);
});

test('a dry run then an apply succeeds, and the receipt carries no credential', async () => {
  const root = tmpRoot('receipt');
  const { dry } = await extractDryThenApply(root);
  const receipt = JSON.parse(fs.readFileSync(store.receiptFile(root), 'utf8'));
  assert.equal(receipt.studyId, 'pit-sweep-2024-2025');
  assert.match(receipt.planDigest, /^[0-9a-f]{64}$/);
  assert.equal(receipt.planDigest, dry.result.digest);
  assert.equal(receipt.wouldWrite.length, EXPECTED_DATASET_COUNT);
  assert.equal(receipt.integrityChecks.every((c) => c.status === 'passed'), true);
  assert.equal(receipt.oracleWeeks.length, 6);
  assert.deepEqual(receipt.capturedAsEmpty.nfl_games, [2022, 2023]);

  // Nothing that could be a secret is in it. The receipt sits next to the
  // snapshot and is as readable as the snapshot is.
  const text = fs.readFileSync(store.receiptFile(root), 'utf8');
  for (const forbidden of ['postgres://', 'password', 'connectionString', 'BACKTEST_RO', '@']) {
    assert.ok(!text.includes(forbidden), `the receipt must not contain ${forbidden}`);
  }
  assert.ok(!/\bhost\b/i.test(text), 'the receipt names no host');
  // The snapshot really was written.
  assert.equal(store.loadManifest(root).datasets.length, EXPECTED_DATASET_COUNT);
});

test('--apply is refused when the receipt was written for a different plan', async () => {
  const root = tmpRoot('staledigest');
  await extractOnce({ apply: false, root });
  // Change something that determines what gets captured: a pinned source's
  // bytes. The digest moves, and the stale receipt no longer authorizes it.
  const drifted = makeReadSource({
    games: fixtureSourceText(SOURCES.find((s) => s.kind === 'games')).replace('KC', 'DEN'),
  });
  await assert.rejects(
    () => extractOnce({ apply: true, root, overrides: { readSource: drifted } }),
    /the dry-run receipt was written for plan digest [0-9a-f]{64}, but this run's plan digest is/
  );
  assert.equal(fs.existsSync(store.manifestFile(root)), false, 'nothing was written');
});

test('a corrupt receipt is refused rather than ignored', async () => {
  const root = tmpRoot('badreceipt');
  await extractOnce({ apply: false, root });
  fs.writeFileSync(store.receiptFile(root), 'not json');
  await assert.rejects(() => extractOnce({ apply: true, root }), /dry-run receipt .* is unreadable/);
});

test('the plan digest tracks configuration and database identity, not results', () => {
  const plan = extract.extractionPlan();
  const identity = { database: 'endzone_empire', role: 'backtest_ro' };
  const base = {
    plan, sourceHashes: { games: 'a' }, oracleSettings: { weatherService: false }, identity,
  };
  const digest = extract.planDigest(base);
  assert.equal(extract.planDigest({ ...base }), digest, 'same configuration, same digest');
  assert.notEqual(extract.planDigest({ ...base, sourceHashes: { games: 'b' } }), digest,
    'a changed source hash moves it');
  assert.notEqual(
    extract.planDigest({ ...base, oracleSettings: { weatherService: true } }), digest,
    'a changed oracle setting moves it'
  );
  assert.notEqual(
    extract.planDigest({ ...base, plan: extract.extractionPlan({ seasons: [2025] }) }), digest,
    'a changed season window moves it'
  );
  // The database and role ARE inputs: they are static configuration, so
  // including them costs nothing in false alarms and stops a staging receipt
  // from authorizing a production write.
  assert.notEqual(
    extract.planDigest({ ...base, identity: { database: 'endzone_staging', role: 'backtest_ro' } }),
    digest, 'a different database moves it'
  );
  assert.notEqual(
    extract.planDigest({ ...base, identity: { database: 'endzone_empire', role: 'postgres' } }),
    digest, 'a different role moves it'
  );
  // Row counts are NOT an input: a dry run and the apply after it are two
  // transactions against a live database and may legitimately differ.
  assert.equal(extract.planDigest({ ...base, rowCounts: { players: 99 } }), digest);
});

test('the digest covers the CAPTURE queries too, not only the 8 served ones', () => {
  // `plan.sqlSurface` is what the client SERVES; `EXTRACTION_SQL` is what the
  // extraction RUNS. Only the first used to be hashed, so a change to a capture
  // query left the digest untouched and a receipt written beforehand still
  // authorized the apply afterwards. That is not hypothetical: adding
  // `external_id` to the players capture is exactly that change, and this study
  // made it.
  const inputs = {
    plan: extract.extractionPlan(),
    sourceHashes: { games: 'a' },
    oracleSettings: { weatherService: false },
    identity: { database: 'endzone_empire', role: 'backtest_ro' },
  };
  const digest = extract.planDigest(inputs);

  // Drop `external_id` from the capture - the precise change that used to be
  // invisible - and the digest must move.
  const withoutExternalId = {
    ...EXTRACTION_SQL,
    players: EXTRACTION_SQL.players.replace('"external_id", ', ''),
  };
  assert.notEqual(EXTRACTION_SQL.players, withoutExternalId.players, 'the fixture really differs');
  assert.notEqual(extract.planDigest({ ...inputs, extractionSql: withoutExternalId }), digest,
    'a change to a CAPTURE query must move the plan digest');

  // Any capture query, not just that one.
  assert.notEqual(extract.planDigest({
    ...inputs,
    extractionSql: { ...EXTRACTION_SQL, nflGames: `${EXTRACTION_SQL.nflGames} -- changed` },
  }), digest);
  // Adding or removing a capture query moves it too.
  const { positionRank, ...fewer } = EXTRACTION_SQL;
  assert.notEqual(extract.planDigest({ ...inputs, extractionSql: fewer }), digest);
  // Whitespace-only reformatting does NOT, matching the serving surface's rule.
  assert.equal(extract.planDigest({
    ...inputs,
    extractionSql: { ...EXTRACTION_SQL, players: EXTRACTION_SQL.players.replace(/\s+/g, '\n  ') },
  }), digest, 're-indenting a capture query is not a behaviour change');
  // And the identical input is still identical.
  assert.equal(extract.planDigest({ ...inputs, extractionSql: EXTRACTION_SQL }), digest);
});

test('a capture-SQL change invalidates a receipt written before it', async () => {
  // The end-to-end consequence: the dry run's receipt no longer authorizes an
  // apply whose capture queries have changed underneath it.
  const root = tmpRoot('capturereceipt');
  await extractOnce({ apply: false, root });
  const receipt = JSON.parse(fs.readFileSync(store.receiptFile(root), 'utf8'));

  const plan = extract.extractionPlan();
  const sourceHashes = Object.fromEntries(
    SOURCES.map((s) => [s.name, 'x'.repeat(64)])
  );
  const shared = { plan, sourceHashes, oracleSettings: {}, identity: null };
  const asRecorded = extract.planDigest(shared);
  const afterChange = extract.planDigest({
    ...shared,
    extractionSql: { ...EXTRACTION_SQL, players: `${EXTRACTION_SQL.players} -- changed` },
  });
  assert.notEqual(asRecorded, afterChange);
  // assertDryRunReceipt compares exactly these, so a moved digest is a refusal.
  assert.throws(() => extract.assertDryRunReceipt({ outDir: root, digest: afterChange }),
    /refusing to --apply: the dry-run receipt was written for plan digest/);
  assert.doesNotThrow(() => extract.assertDryRunReceipt({
    outDir: root, digest: receipt.planDigest,
  }));
});

test('a receipt from a dry run against one database will not authorize an apply against another', async () => {
  const root = tmpRoot('crossdb');
  // Dry run against "staging".
  const staging = makeFakeClient({ database: 'endzone_staging' });
  const stagingTxn = await extract.openReadOnlyTransaction(
    openArgs(staging, makeFakePool(), { expectedDatabase: 'endzone_staging' })
  );
  try {
    await extract.runExtraction({
      client: stagingTxn.client, identity: stagingTxn.identity, outDir: root, apply: false,
      ...extractionDeps(),
    });
  } finally {
    await stagingTxn.close();
  }
  const receipt = JSON.parse(fs.readFileSync(store.receiptFile(root), 'utf8'));
  assert.equal(receipt.database, 'endzone_staging');
  assert.equal(receipt.role, 'backtest_ro');

  // Apply against production with the SAME configuration in every other
  // respect. Only the database differs, and that is enough.
  const prod = makeFakeClient({ database: 'endzone_empire' });
  const prodTxn = await extract.openReadOnlyTransaction(openArgs(prod, makeFakePool()));
  try {
    await assert.rejects(() => extract.runExtraction({
      client: prodTxn.client, identity: prodTxn.identity, outDir: root, apply: true,
      ...extractionDeps(),
    }), (err) => {
      assert.match(err.message, /refusing to --apply/);
      assert.match(err.message, /THE DATABASE AND ROLE THIS RUN IS POINTED AT/);
      assert.match(err.message, /"endzone_staging"/, 'the message names the receipt\'s database');
      return true;
    });
  } finally {
    await prodTxn.close();
  }
  assert.equal(fs.existsSync(store.manifestFile(root)), false, 'nothing was written');

  // A different ROLE against the same database is refused for the same reason.
  const otherRole = makeFakeClient({ database: 'endzone_staging', role: 'postgres' });
  const roleTxn = await extract.openReadOnlyTransaction(
    openArgs(otherRole, makeFakePool(), { expectedRole: 'postgres', expectedDatabase: 'endzone_staging' })
  );
  try {
    await assert.rejects(() => extract.runExtraction({
      client: roleTxn.client, identity: roleTxn.identity, outDir: root, apply: true,
      ...extractionDeps(),
    }), /refusing to --apply/);
  } finally {
    await roleTxn.close();
  }

  // The matching pair still works, so the gate is not simply always-on.
  const again = makeFakeClient({ database: 'endzone_staging' });
  const againTxn = await extract.openReadOnlyTransaction(
    openArgs(again, makeFakePool(), { expectedDatabase: 'endzone_staging' })
  );
  try {
    const result = await extract.runExtraction({
      client: againTxn.client, identity: againTxn.identity, outDir: root, apply: true,
      ...extractionDeps(),
    });
    assert.equal(result.applied, true);
  } finally {
    await againTxn.close();
  }
});

test('a schedule season with no overlay must be empty of stats, or the extraction fails closed', () => {
  // The safe shape: 2022/2023 are in the schedule window, have no overlay, and
  // carry no weekly stat rows, so nothing ever looks their orientation up.
  const safe = extract.checkOverlayWindowCoverage({
    scheduleSeasons: [2022, 2023, 2024, 2025],
    overlaySeasons: [2024, 2025],
    weeklyRowsBySeason: { 2022: 0, 2023: 0, 2024: 100, 2025: 100 },
  });
  assert.equal(safe.status, 'passed');
  assert.deepEqual(safe.counts, { scheduleSeasons: 4, overlaySeasons: 2, uncoveredAndEmpty: 2 });

  // The unsafe shape: 2023 has stat rows but no overlay, so reconstructed mode
  // would serve its schedule rows with production's null orientation while
  // patching 2024 and 2025.
  assert.throws(() => extract.checkOverlayWindowCoverage({
    scheduleSeasons: [2022, 2023, 2024, 2025],
    overlaySeasons: [2024, 2025],
    weeklyRowsBySeason: { 2022: 0, 2023: 7, 2024: 100, 2025: 100 },
  }), (err) => {
    assert.match(err.message, /season\(s\) 2023 have weekly stat rows AND schedule rows but no orientation overlay/);
    assert.match(err.message, /Widen the overlay to cover the whole schedule window/);
    return true;
  });
  // Both uncovered seasons populated: both are named.
  assert.throws(() => extract.checkOverlayWindowCoverage({
    scheduleSeasons: [2022, 2023, 2024, 2025],
    overlaySeasons: [2024, 2025],
    weeklyRowsBySeason: { 2022: 1, 2023: 7, 2024: 100, 2025: 100 },
  }), /season\(s\) 2022, 2023 have weekly stat rows/);
  // Full coverage is trivially safe.
  assert.equal(extract.checkOverlayWindowCoverage({
    scheduleSeasons: [2024, 2025],
    overlaySeasons: [2024, 2025],
    weeklyRowsBySeason: { 2024: 100, 2025: 100 },
  }).status, 'passed');
});

test('the overlay coverage guard runs inside the real extraction, both directions', async () => {
  // Direction one: the fixture's 2022/2023 are empty of stats, so it passes and
  // the check is recorded in the manifest.
  const root = tmpRoot('coverguard');
  const { result } = await extractDryThenApply(root);
  const recorded = result.checks.find((c) => c.name === 'overlayWindowCoverage');
  assert.ok(recorded, 'the check ran');
  assert.equal(recorded.status, 'passed');
  assert.ok(store.loadManifest(root).integrityChecks
    .some((c) => c.name === 'overlayWindowCoverage' && c.status === 'passed'));

  // Direction two: give 2023 a weekly stat row and the extraction stops, before
  // writing anything.
  const poisoned = tmpRoot('coverguardfail');
  const withEarlyStats = [...DB_PLAYER_STATS, { player_id: 1, season: 2023, week: 5, stats: {} }];
  const client = makeFakeClient({ playerStats: withEarlyStats });
  const txn = await extract.openReadOnlyTransaction(openArgs(client, makeFakePool()));
  try {
    await assert.rejects(() => extract.runExtraction({
      client: txn.client, identity: txn.identity, outDir: poisoned, apply: false, ...extractionDeps(),
    }), /season\(s\) 2023 have weekly stat rows AND schedule rows but no orientation overlay/);
  } finally {
    await txn.close();
  }
  assert.deepEqual(fs.existsSync(poisoned) ? fs.readdirSync(poisoned) : [], [],
    'not even a receipt is written when the guard fires');
});

test('runExtraction refuses to run without the pieces it cannot fake', async () => {
  const root = tmpRoot('deps');
  const client = makeFakeClient();
  await assert.rejects(() => extract.runExtraction({
    client: null, outDir: root, ...extractionDeps(),
  }), /requires the transaction client/);
  await assert.rejects(() => extract.runExtraction({
    client, outDir: root, ...extractionDeps({ readSource: null }),
  }), /requires an archived-source reader/);
  await assert.rejects(() => extract.runExtraction({
    client, outDir: root, ...extractionDeps({ generateProjections: null }),
  }), /requires the real generateProjections to be injected/);
});

test('a source that lost a required column stops the extraction before any capture', async () => {
  const root = tmpRoot('badsource');
  const client = makeFakeClient();
  await assert.rejects(() => extract.runExtraction({
    client,
    outDir: root,
    ...extractionDeps({
      readSource: makeReadSource({ games: 'game_id,season\n2024_01,2024\n' }),
    }),
  }), /games: schema validation failed, missing column/);
  assert.deepEqual(client.names().filter((n) => DATA_QUERIES.has(n)), []);
});

// ---------------------------------------------------------------------------
// Structural isolation
// ---------------------------------------------------------------------------

/** Resolve the local require graph of a file inside scripts/backtest. */
function requireGraph(entry) {
  const stripComments = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const seen = new Set();
  const external = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    for (const match of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) { external.add(spec); continue; }
      const resolved = path.resolve(path.dirname(file), spec);
      walk(resolved.endsWith('.js') ? resolved : `${resolved}.js`);
    }
  };
  walk(entry);
  return { files: [...seen], external: [...external].sort() };
}

test('the Phase-1 modules are structurally incapable of fetching or refetching', () => {
  const backtest = path.join(__dirname, '..', '..', 'scripts', 'backtest');
  for (const entry of ['extract-snapshot.js', 'snapshot-checks.js', 'lib/snapshotStore.js']) {
    const graph = requireGraph(path.join(backtest, entry));
    const fetcher = graph.files.filter((f) => path.basename(f) === 'sourceFetch.js');
    assert.deepEqual(fetcher, [], `${entry} pulls in the fetcher`);
    for (const spec of graph.external) {
      assert.ok(
        !['http', 'https', 'net', 'tls', 'dns', 'http2', 'dgram', 'axios', 'node-fetch', 'undici']
          .includes(spec),
        `${entry} requires ${spec}, which can open a socket`
      );
    }
    // And nothing that could reach the production pool.
    for (const spec of graph.external) {
      assert.ok(!/^pg$/.test(spec), `${entry} requires pg directly`);
    }
    assert.ok(graph.files.length > 1, `${entry} resolved a require graph`);
  }
});

test('the whole backtest tree still reads no environment and requires no server code', () => {
  // The Phase-0 isolation test asserts this too; repeated here so a Phase-1
  // file added later fails in the Phase-1 suite as well as the Phase-0 one.
  const root = path.join(__dirname, '..', '..', 'scripts', 'backtest');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
  const files = walk(root);
  assert.ok(files.length >= 8, 'found the Phase-0 and Phase-1 tooling');
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.ok(!/process\.env/.test(text), `${path.basename(file)} reads process.env`);
    for (const match of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(
        !/modules\/pool|server\/services|\.\.\/server/.test(match[1]),
        `${path.basename(file)} requires ${match[1]}, which can reach the production pool`
      );
    }
  }
});

test('every archived-source path is built from a validated bare basename', () => {
  const { assertSafeSourceFile, SOURCES: registry } = require('../../scripts/backtest/lib/sources');
  // The registry itself is validated at module load, so a bad entry could never
  // reach a path.join downstream.
  for (const source of registry) assert.equal(assertSafeSourceFile(source.file), source.file);
  for (const bad of [
    '../../etc/passwd', 'a/b.csv', 'a\\b.csv', '..', '.hidden.csv', 'C:/abs.csv',
    'Games.csv', 'games.CSV', 'games.json', '', null, undefined, 'games..csv',
  ]) {
    assert.throws(() => assertSafeSourceFile(bad), /not a bare lowercase \.csv basename|traversal segment|path separator/,
      `rejects ${JSON.stringify(bad)}`);
  }
  // Every consumer routes through it: no raw `source.file` reaches a path.join.
  for (const file of ['fetch-sources.js', 'inspect-sources.js', 'extract-snapshot.js', 'snapshot-checks.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'backtest', file), 'utf8');
    assert.ok(!/path\.join\([^)]*source\.file/.test(text),
      `${file} still joins source.file without validating it first`);
  }
});

// ---------------------------------------------------------------------------
// The gated runner: credentials, TLS
// ---------------------------------------------------------------------------

test('the runner reads its credential from ONE env var, with no fallback to the app credential', () => {
  const runner = require('../scripts/run-backtest-extraction');
  assert.equal(runner.CREDENTIAL_ENV_VAR, 'BACKTEST_RO_DATABASE_URL');
  assert.equal(runner.readCredential({ BACKTEST_RO_DATABASE_URL: ' postgres://ro@h/db ' }),
    'postgres://ro@h/db');

  // Unset: hard error naming the variable.
  assert.throws(() => runner.readCredential({}), /BACKTEST_RO_DATABASE_URL is not set/);
  assert.throws(() => runner.readCredential({ BACKTEST_RO_DATABASE_URL: '' }),
    /BACKTEST_RO_DATABASE_URL is not set/);
  assert.throws(() => runner.readCredential({ BACKTEST_RO_DATABASE_URL: '   ' }),
    /BACKTEST_RO_DATABASE_URL is not set/);

  // The app's own credential present is STILL a hard error, and the message
  // says why it is not used: that role can write.
  for (const env of [
    { DATABASE_URL: 'postgres://app:p@h/db' },
    { DATABASE_URL_RUNTIME: 'postgres://app:p@h/db' },
    { PGUSER: 'app', PGHOST: 'h' },
  ]) {
    assert.throws(() => runner.readCredential(env), (err) => {
      assert.match(err.message, /BACKTEST_RO_DATABASE_URL is not set/);
      assert.match(err.message, /deliberately NOT used as a fallback/);
      assert.match(err.message, /application role, which can write/);
      assert.ok(!err.message.includes('postgres://app:p@h/db'), 'the app credential is not echoed');
      return true;
    });
  }
});

test('the TLS gate demands a VERIFIED connection, not merely a configured CA', () => {
  const runner = require('../scripts/run-backtest-extraction');
  const url = 'postgres://ro@db.example.com/endzone';
  const env = { NODE_ENV: 'development' };
  // `resolveSsl` is injected, so every branch is exercised without touching the
  // real environment.
  const gate = (ssl) => () => runner.assertVerifiedTls(url, { resolveSsl: () => ssl, env });

  // The only accepted outcome.
  assert.equal(runner.assertVerifiedTls(url, {
    resolveSsl: () => ({ rejectUnauthorized: true, ca: 'cert' }), env,
  }), true);

  // TLS off entirely. This is the case a CA-presence check would have MISSED:
  // dbSsl returns false for a localhost host, so an operator reaching
  // production down an SSH tunnel would have sailed through with a CA set.
  assert.throws(gate(false), (err) => {
    assert.match(err.message, /TLS is disabled entirely for this connection/);
    assert.match(err.message, /localhost\/127\.0\.0\.1 host, or PGSSLMODE=disable/);
    return true;
  });
  assert.throws(gate(null), /TLS is disabled entirely/);

  // TLS on but unverified.
  assert.throws(gate({ rejectUnauthorized: false }), (err) => {
    assert.match(err.message, /TLS is on but unverified \(rejectUnauthorized=false\)/);
    assert.match(err.message, /DB_SSL_CA or DB_SSL_CA_PATH/);
    assert.match(err.message, /NODE_ENV is "development"/);
    return true;
  });
  // A truthy-but-not-exactly-true value is not good enough either.
  assert.throws(gate({ rejectUnauthorized: 'true' }), /TLS is on but unverified/);
  assert.throws(gate({}), /TLS is on but unverified \(rejectUnauthorized=undefined\)/);

  // A resolver that throws is reported, not swallowed.
  assert.throws(
    () => runner.assertVerifiedTls(url, {
      resolveSsl: () => { throw new Error('PGSSLMODE=disable is forbidden'); }, env,
    }),
    /the TLS configuration is invalid \(PGSSLMODE=disable is forbidden\)/
  );
});

test('the real dbSsl resolver drives the gate the way the gate assumes', () => {
  const runner = require('../scripts/run-backtest-extraction');
  const { sslForConnection } = require('../modules/dbSsl');
  // A localhost tunnel resolves to no TLS at all, whatever else is configured -
  // which is exactly why the gate inspects the resolved config.
  assert.equal(sslForConnection('postgres://ro@localhost:5432/endzone'), false);
  assert.throws(
    () => runner.assertVerifiedTls('postgres://ro@localhost:5432/endzone', {
      resolveSsl: sslForConnection, env: { NODE_ENV: 'development' },
    }),
    /TLS is disabled entirely/
  );
  assert.throws(
    () => runner.assertVerifiedTls('postgres://ro@127.0.0.1:5432/endzone', {
      resolveSsl: sslForConnection, env: { NODE_ENV: 'development' },
    }),
    /TLS is disabled entirely/
  );
});

test('the runner gates the credential and TLS BEFORE constructing a pool', async () => {
  const runner = require('../scripts/run-backtest-extraction');
  // Credential missing: refused before any socket, and before TLS is even
  // considered (the resolved ssl config depends on the connection string).
  await assert.rejects(
    () => runner.main(['--database', 'db', '--role', 'ro'], { env: {} }),
    /BACKTEST_RO_DATABASE_URL is not set/
  );
  // Credential present but pointing at a localhost tunnel: refused by the TLS
  // gate, still before any socket.
  await assert.rejects(
    () => runner.main(['--database', 'db', '--role', 'ro'],
      { env: { BACKTEST_RO_DATABASE_URL: 'postgres://ro@localhost:5432/endzone' } }),
    /refusing to run the extraction: TLS is disabled entirely/
  );
  // The accident guard is required too, and refused first of all.
  await assert.rejects(
    () => runner.main([], { env: { BACKTEST_RO_DATABASE_URL: 'postgres://ro@h/db' } }),
    /--database is required/
  );
  // --plan needs none of it and touches nothing.
  assert.equal(await runner.main(['--plan'], { env: {} }), 0);
});

test('the gated runner is the ONE file holding both halves, and it writes nothing', () => {
  const file = path.join(__dirname, '..', 'scripts', 'run-backtest-extraction.js');
  const text = fs.readFileSync(file, 'utf8');
  const code = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // It wires production in...
  for (const spec of ['../services/projection.service', '../services/projectionFeatures', '../modules/pool']) {
    assert.ok(code.includes(spec), `the runner must inject ${spec}`);
  }
  // ...and it contains no analysis logic and no write statement of its own.
  assert.ok(!/INSERT|UPDATE|DELETE|COMMIT|CREATE |DROP |ALTER /i.test(code),
    'the runner issues no write statement');
  assert.ok(code.includes('extract.main('), 'the runner delegates to the tested driver');
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('the plan mode needs no database and prints the signed surface and oracle table', async () => {
  const lines = [];
  const code = await extract.main(['--plan'], { log: (l) => lines.push(String(l)) });
  assert.equal(code, 0);
  const text = lines.join('\n');
  for (const entry of extract.sqlSurfaceSignatures()) assert.ok(text.includes(entry.signature));
  for (const week of extract.ORACLE_WEEKS) assert.ok(text.includes(`${week.season} W`));
  assert.ok(text.includes('quarantine from 2026'));
});

test('without injected wiring the CLI explains itself and exits nonzero rather than guessing', async () => {
  const lines = [];
  const code = await extract.main([], { log: (l) => lines.push(String(l)) });
  assert.equal(code, 1);
  assert.ok(lines.join('\n').includes('run-backtest-extraction.js'));
});

test('parseArgs takes the accident guard on argv and rejects unknown flags', () => {
  const args = extract.parseArgs([
    '--apply', '--out', 'x', '--database', 'db', '--role', 'ro',
    '--statement-timeout-ms', '1000', '--idle-timeout-ms', '2000',
  ]);
  assert.equal(args.apply, true);
  assert.equal(args.out, 'x');
  assert.equal(args.database, 'db');
  assert.equal(args.role, 'ro');
  assert.equal(args.statementTimeoutMs, 1000);
  assert.equal(args.idleInTransactionSessionTimeoutMs, 2000);
  assert.equal(extract.parseArgs([]).apply, false, 'dry run is the default');
  assert.throws(() => extract.parseArgs(['--force']), /unknown argument --force/);
  assert.equal('connectionString' in extract.parseArgs([]), false);
});

test('a credential can never be passed on the command line, and is never echoed back', () => {
  // The flag is refused by name, with an error that says where the credential
  // belongs instead. The value itself is never quoted back.
  assert.throws(
    () => extract.parseArgs(['--connection-string', 'postgres://u:hunter2@h/db']),
    (err) => {
      assert.match(err.message, /--connection-string is not accepted/);
      assert.match(err.message, /BACKTEST_RO_DATABASE_URL/);
      assert.ok(!err.message.includes('hunter2'), 'the secret is not echoed');
      return true;
    }
  );
  // A credential typed in the wrong position is an unknown argument, and the
  // unknown-argument message describes it rather than printing it.
  assert.throws(
    () => extract.parseArgs(['postgres://u:hunter2@h/db']),
    (err) => {
      assert.ok(!err.message.includes('hunter2'), 'the secret is not echoed');
      assert.match(err.message, /<redacted \d+-character non-flag argument>/);
      return true;
    }
  );
  assert.equal(extract.redactArgument('--apply'), '--apply', 'a flag name is safe to echo');
  assert.match(extract.redactArgument('postgres://u:p@h/db'), /^<redacted \d+-character/);
  assert.match(extract.redactArgument('--Weird=thing'), /^<redacted/);
});

test('nothing under scripts/backtest mentions a connection-string option it could read', () => {
  // The isolation test already bans process.env across the tree. This is the
  // other half: no argv path into a credential either.
  const root = path.join(__dirname, '..', '..', 'scripts', 'backtest');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
  for (const file of walk(root)) {
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/args\.connectionString|connectionString\s*=/.test(text),
      `${path.basename(file)} carries a connection-string argument`);
  }
});

// ---------------------------------------------------------------------------
// The extraction's own SQL is read-only
// ---------------------------------------------------------------------------

test('every statement the extraction issues is read-only', () => {
  const WRITES = /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|VACUUM|REFRESH|COMMIT)\b/i;
  for (const [name, sql] of Object.entries(EXTRACTION_SQL)) {
    const normalized = normalizeSql(sql);
    assert.ok(!WRITES.test(normalized), `EXTRACTION_SQL.${name} contains a write keyword: ${normalized}`);
    // Only four shapes are allowed: a SELECT, the read-only BEGIN, and ROLLBACK.
    const allowed = /^SELECT\b/i.test(normalized)
      || normalized === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'
      || normalized === 'ROLLBACK';
    assert.ok(allowed, `EXTRACTION_SQL.${name} is not a SELECT, the read-only BEGIN, or ROLLBACK: ${normalized}`);
    // No bare SET: the two session settings go through set_config with bind
    // parameters, so no value is ever concatenated into SQL.
    assert.ok(!/^SET\b/i.test(normalized), `EXTRACTION_SQL.${name} uses a bare SET`);
    assert.ok(!/\$\{/.test(sql), `EXTRACTION_SQL.${name} interpolates a value into SQL`);
  }
  // The production surface is read-only too, by the same rule.
  for (const entry of SQL_SURFACE) {
    assert.ok(!WRITES.test(normalizeSql(entry.text)), `${entry.name} contains a write keyword`);
    assert.match(normalizeSql(entry.text), /^SELECT\b/i);
  }
  // And the BEGIN really does say READ ONLY.
  assert.match(EXTRACTION_SQL.begin, /READ ONLY$/);
});
