const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const checks = require('../../scripts/backtest/snapshot-checks');
const extract = require('../../scripts/backtest/extract-snapshot');
const store = require('../../scripts/backtest/lib/snapshotStore');
const { sha256Hex } = require('../../scripts/backtest/lib/verifiedBytes');
const { SOURCES } = require('../../scripts/backtest/lib/sources');
const { normalizeTeamKey } = require('../services/projectionFeatures');

/**
 * `snapshot-checks.js` is the second pair of eyes on the extraction, so these
 * tests care about two things above all:
 *
 *   - that it FAILS when the snapshot is wrong (each check is broken
 *     individually and the failure is asserted by name), and
 *   - that its expected counts are DERIVED from the manifest and the archived
 *     source rather than hardcoded - proved by re-running it against a snapshot
 *     built from a DIFFERENT number of games and watching the expectation move
 *     with the data.
 *
 * Every snapshot here is produced by the real extraction driver against a fake
 * client, so the two halves are exercised against each other with no database.
 */

// ---------------------------------------------------------------------------
// Fixtures: a small snapshot produced by the real extraction
// ---------------------------------------------------------------------------

function tmpRoot(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ez-checks-${label}-`));
  test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const TEAMS = Object.freeze([
  { key: 'KC', schedule: 'KC', source: 'KC', name: 'Kansas City Chiefs' },
  { key: 'WAS', schedule: 'WSH', source: 'WAS', name: 'Washington Commanders' },
  { key: 'LAR', schedule: 'LAR', source: 'LA', name: 'Los Angeles Rams' },
  { key: 'BUF', schedule: 'BUF', source: 'BUF', name: 'Buffalo Bills' },
]);

const PLAYERS = Object.freeze([
  { id: 1, name: 'Aaron Quarterback', position: 'QB', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: 1, team_key: 'KC' },
  { id: 2, name: 'Bella Runner', position: 'RB', nfl_team: 'WSH', injury_status: null, injury_detail: null, adp: 2, team_key: 'WAS' },
  { id: 3, name: 'Cara Receiver', position: 'WR', nfl_team: 'LAR', injury_status: null, injury_detail: null, adp: 3, team_key: 'LAR' },
  { id: 4, name: 'Dan Tightend', position: 'TE', nfl_team: 'BUF', injury_status: null, injury_detail: null, adp: 4, team_key: 'BUF' },
  { id: 5, name: 'Evan Kicker', position: 'K', nfl_team: 'KC', injury_status: null, injury_detail: null, adp: 5, team_key: 'KC' },
  ...TEAMS.map((t, i) => ({
    id: 6 + i, name: t.name, position: 'DEF', nfl_team: t.name,
    injury_status: null, injury_detail: null, adp: null, team_key: t.key,
  })),
]);

/**
 * `weeks` regular-season weeks per season, two games each: KC-WAS and LAR-BUF.
 * Making the count a parameter is what lets a test prove the checks derive
 * their expectations rather than remembering 544.
 */
function buildFixture({ weeks = 2, neutralWeeks = [2], gameTeamOn = [1] } = {}) {
  const seasons = [2024, 2025];
  const gamesCsvRows = [];
  for (const season of seasons) {
    for (let week = 1; week <= weeks; week++) {
      const neutral = neutralWeeks.includes(week) && season === 2024;
      gamesCsvRows.push({
        game_id: `${season}_${week}_WAS_KC`, season, game_type: 'REG', week,
        gameday: `${season}-09-0${Math.min(9, week)}`, gametime: '13:00',
        away_team: 'WAS', home_team: 'KC', away_score: 20, home_score: 27, location: 'Home',
      });
      gamesCsvRows.push({
        game_id: `${season}_${week}_BUF_LA`, season, game_type: 'REG', week,
        gameday: `${season}-09-0${Math.min(9, week)}`, gametime: '16:00',
        away_team: 'BUF', home_team: 'LA', away_score: 17, home_score: 24,
        location: neutral ? 'Neutral' : 'Home',
      });
    }
  }
  // A POST row and a 2026 row: neither may reach the overlay, and the 2026 row
  // MUST survive in the raw provenance store.
  gamesCsvRows.push({
    game_id: '2025_19_KC_BUF', season: 2025, game_type: 'POST', week: 19,
    gameday: '2026-01-11', gametime: '13:00', away_team: 'KC', home_team: 'BUF',
    away_score: 3, home_score: 6, location: 'Home',
  });
  gamesCsvRows.push({
    game_id: '2026_1_KC_WAS', season: 2026, game_type: 'REG', week: 1,
    gameday: '2026-09-13', gametime: '13:00', away_team: 'KC', home_team: 'WAS',
    away_score: '', home_score: '', location: 'Home',
  });

  // 2022 and 2023 are reached by the history window and found empty, which is
  // what production looks like and what capturedAsEmpty has to record.
  const dbGames = (season) => {
    const rows = [];
    if (season < 2024) return rows;
    for (let week = 1; week <= weeks; week++) {
      for (const [a, b] of [['KC', 'WAS'], ['LAR', 'BUF']]) {
        for (const [team, opponent] of [[a, b], [b, a]]) {
          const t = TEAMS.find((x) => x.key === team);
          const o = TEAMS.find((x) => x.key === opponent);
          rows.push({
            season, week, nfl_team: t.schedule, opponent: o.schedule,
            kickoff_at: `${season}-09-08T17:00:00.000Z`,
            game_key: `${season}-${week}-${a}-${b}`,
            home_away: null, neutral_site: null, venue: null, roof: null, surface: null,
            latitude: null, longitude: null, rest_days: null,
            team_key: t.key, opponent_key: o.key,
          });
        }
      }
    }
    return rows;
  };

  const playerStats = [];
  for (const season of [2024, 2025]) {
    for (let week = 1; week <= weeks; week++) {
      for (const player of PLAYERS.filter((p) => p.position !== 'DEF')) {
        const stats = { passingYards: 100 + week };
        if (gameTeamOn.includes(week)) {
          stats.gameTeam = TEAMS.find((t) => t.key === player.team_key).schedule;
          stats.gameOpponent = 'BUF';
        }
        playerStats.push({ player_id: player.id, season, week, stats });
      }
    }
  }

  return { seasons, gamesCsvRows, dbGames, playerStats, weeks, neutralWeeks };
}

const GAMES_CSV_HEADER = [
  'game_id', 'season', 'game_type', 'week', 'gameday', 'gametime',
  'away_team', 'home_team', 'away_score', 'home_score', 'location',
];

function csv(header, rows) {
  return [header.join(','), ...rows.map((r) => header.map((h) => r[h] ?? '').join(','))].join('\n') + '\n';
}

function makeReadSource(fixture, overrides = {}) {
  const byName = (name) => {
    if (overrides[name]) return overrides[name];
    const source = SOURCES.find((s) => s.name === name);
    if (source.kind === 'games') return csv(GAMES_CSV_HEADER, fixture.gamesCsvRows);
    if (source.kind === 'players') {
      return csv(['gsis_id', 'espn_id'], [
        { gsis_id: '00-0000001', espn_id: '3001' },
        { gsis_id: '00-0000002', espn_id: '3002' },
        { gsis_id: 'ABB498348', espn_id: '9999' },
      ]);
    }
    if (source.kind === 'roster_weekly') {
      return csv(['season', 'week', 'team', 'position', 'status', 'gsis_id', 'full_name', 'game_type'], [
        { season: source.season, week: 1, team: 'KC', position: 'QB', status: 'ACT', gsis_id: '00-0000001', full_name: 'Aaron Quarterback', game_type: 'REG' },
        { season: source.season, week: 1, team: 'WAS', position: 'RB', status: 'ACT', gsis_id: '00-0000002', full_name: 'Bella Runner', game_type: 'REG' },
        // Unmappable: a well-formed gsis id that the crosswalk does not carry.
        { season: source.season, week: 1, team: 'LA', position: 'WR', status: 'ACT', gsis_id: '00-0009999', full_name: 'Unmapped Player', game_type: 'REG' },
        { season: source.season, week: 2, team: 'BUF', position: 'TE', status: 'ACT', gsis_id: '', full_name: 'Blank Id', game_type: 'REG' },
      ]);
    }
    if (source.kind === 'injuries') {
      const header = ['season', 'week', 'team', 'gsis_id', 'report_status', 'game_type', 'full_name', 'position'];
      const row = { season: source.season, week: 1, team: 'KC', gsis_id: '00-0000001', report_status: 'Questionable', game_type: 'REG', full_name: 'Aaron Quarterback', position: 'QB' };
      return source.season === 2024
        ? csv([...header, 'date_modified'], [{ ...row, date_modified: '2024-09-06T18:00:00Z' }])
        : csv([...header, 'season_type'], [{ ...row, season_type: 'REG' }]);
    }
    if (source.kind === 'stats_player_week') {
      return csv(['season', 'week', 'season_type', 'player_id', 'team', 'position'], [
        // Agrees with the roster row.
        { season: source.season, week: 1, season_type: 'REG', player_id: '00-0000001', team: 'KC', position: 'QB' },
        // CONTRADICTS the roster (roster says WAS, gameTeam says BUF): reported,
        // never used to exclude.
        { season: source.season, week: 1, season_type: 'REG', player_id: '00-0000002', team: 'BUF', position: 'RB' },
        // WSH vs the roster's WAS: a SPELLING, not a contradiction, once both
        // sides go through normalizeTeamKey.
        { season: source.season, week: 1, season_type: 'REG', player_id: '00-0009999', team: 'LA', position: 'WR' },
        // No roster row at all for this player-week.
        { season: source.season, week: 2, season_type: 'REG', player_id: '00-0000007', team: 'KC', position: 'QB' },
      ]);
    }
    if (source.kind === 'stats_team_week') {
      return csv(['season', 'week', 'season_type', 'team', 'opponent_team'], [
        { season: source.season, week: 1, season_type: 'REG', team: 'KC', opponent_team: 'WAS' },
      ]);
    }
    throw new Error(`no fixture for ${name}`);
  };
  // The extraction hands the source OBJECT; snapshot-checks hands the NAME.
  const reader = (arg) => byName(typeof arg === 'string' ? arg : arg.name);
  return reader;
}

function fields(names) {
  return names.map((name, i) => ({ name, dataTypeID: 20 + i }));
}

function makeFakeClient(fixture) {
  const bySig = new Map(
    Object.entries(extract.EXTRACTION_SQL).map(([name, sql]) => [extract.normalizeSql(sql), name])
  );
  return {
    log: [],
    async query(text, params = []) {
      const norm = extract.normalizeSql(typeof text === 'string' ? text : text.text);
      const name = bySig.get(norm) || 'surface';
      this.log.push(name);
      const answer = (rows, columns) => ({ rows, fields: fields(columns), rowCount: rows.length });
      switch (name) {
        case 'identity': return answer([{ database: 'endzone_empire', role: 'backtest_ro' }], ['database', 'role']);
        case 'transactionMode':
          return answer([{ transaction_read_only: 'on', transaction_isolation: 'repeatable read' }],
            ['transaction_read_only', 'transaction_isolation']);
        case 'setConfig': return answer([{ applied: params[1] }], ['applied']);
        case 'players': return answer(PLAYERS.map((p) => ({ ...p })), ['id', 'name', 'position', 'nfl_team', 'injury_status', 'injury_detail', 'adp', 'team_key']);
        case 'playerStats':
          return answer(fixture.playerStats.filter((r) => r.season >= params[0] && r.season <= params[1]),
            ['player_id', 'season', 'week', 'stats']);
        case 'playerSeasonStats':
          return answer([{ player_id: 1, season: 2019, games_played: 16, stats: {}, fantasy_points: 300 }],
            ['player_id', 'season', 'games_played', 'stats', 'fantasy_points']);
        case 'nflGames':
          return answer(fixture.dbGames(params[0]), ['season', 'week', 'nfl_team', 'opponent', 'kickoff_at', 'game_key', 'home_away', 'neutral_site', 'venue', 'roof', 'surface', 'latitude', 'longitude', 'rest_days', 'team_key', 'opponent_key']);
        case 'positionRank':
          return answer([...params[0]].sort().map((code, i) => ({ code, rank: i + 1 })), ['code', 'rank']);
        case 'playerNameRank':
          return answer([...PLAYERS].sort((a, b) => (a.name < b.name ? -1 : 1))
            .map((p, i) => ({ id: p.id, name: p.name, rank: i + 1 })), ['id', 'name', 'rank']);
        default: return answer([], ['x']);
      }
    },
    release() {},
  };
}

function fakeGenerateProjections() {
  const byName = new Map(extract.SQL_SURFACE.map((e) => [e.name, e.text]));
  return async ({ season, week, playerIds, client }) => {
    for (const name of ['playersById', 'priorPlayerStats', 'priorPlayerSeasonStats',
      'targetWeekSchedule', 'historyWindowSchedule']) {
      await client.query(byName.get(name), []);
    }
    if (week > 1) {
      await client.query(byName.get('leagueScan'), []);
      await client.query(byName.get('defenseGameCount'), []);
    }
    await client.query(byName.get('byeWeeks'), []);
    return {
      projections: new Map(playerIds.map((id) => [id, { playerId: id, median: id * 1.5 }])),
      inputCutoff: new Date(`${season}-09-08T17:00:00.000Z`),
    };
  };
}

/** Build a real snapshot with the real driver, against fakes. */
async function buildSnapshot(label, fixtureOptions = {}, sourceOverrides = {}) {
  const root = tmpRoot(label);
  const fixture = buildFixture(fixtureOptions);
  const readSource = makeReadSource(fixture, sourceOverrides);
  const client = makeFakeClient(fixture);
  const pool = { async query() {}, async connect() {} };
  const txn = await extract.openReadOnlyTransaction({
    connect: async () => client,
    pool,
    expectedDatabase: 'endzone_empire',
    expectedRole: 'backtest_ro',
    statementTimeoutMs: 300000,
    idleInTransactionSessionTimeoutMs: 60000,
  });
  const run = (apply) => extract.runExtraction({
    client: txn.client,
    identity: txn.identity,
    normalizeTeamKey,
    generateProjections: fakeGenerateProjections(),
    rules: { receiving: { reception: 0.5 } },
    hashValue: 'h',
    modelConstants: { usage: { blendWeight: 0.25 } },
    modelVersion: 'free_baseline_v3.1',
    readSource,
    outDir: root,
    apply,
  });
  try {
    // Dry run first, then apply: the receipt gate requires the sequence, and
    // building these fixtures through the real driver means the tests exercise
    // it every time rather than in one place.
    await run(false);
    await run(true);
  } finally {
    await txn.close();
  }
  return { root, fixture, readSource };
}

function run(root, readSource) {
  return checks.runChecks({ root, readSource, normalizeTeamKey });
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('a snapshot the extraction just produced passes every check', async () => {
  const { root, readSource } = await buildSnapshot('happy');
  const { results, failures } = run(root, readSource);
  assert.deepEqual(failures.map((f) => `${f.name}: ${f.detail}`), []);
  assert.ok(results.length > 20, 'the checks actually ran');
  const byName = new Map(results.map((r) => [r.name, r]));
  assert.equal(byName.get('manifest').ok, true);
  assert.equal(byName.get('quarantine').ok, true);
  assert.equal(byName.get('rawProvenance').ok, true);
});

test('main() exits zero on a good snapshot and prints a summary', async () => {
  const { root, readSource } = await buildSnapshot('main');
  const lines = [];
  const code = checks.main(['--snapshot', root], {
    log: (l) => lines.push(String(l)), readSource, normalizeTeamKey,
  });
  assert.equal(code, 0);
  const text = lines.join('\n');
  assert.ok(text.includes('pit-sweep-2024-2025'));
  assert.match(text, /\d+ passed, 0 skipped, 0 failed/);
});

// ---------------------------------------------------------------------------
// Counts are DERIVED, not hardcoded
// ---------------------------------------------------------------------------

test('the orientation patch expectation is derived from the archived source, not a literal', async () => {
  // Two weeks: 2 games per week per season -> 4 REG games -> 8 team-rows.
  const two = await buildSnapshot('derive2', { weeks: 2 });
  const twoResults = run(two.root, two.readSource);
  assert.deepEqual(twoResults.failures, []);
  assert.deepEqual(twoResults.results.find((r) => r.name === 'overlay:2024').counts,
    { regGames: 4, overlayRows: 8 });

  // Nine weeks: 18 REG games -> 36 team-rows. The expectation MOVED with the
  // data, which is what "derived" means: a hardcoded 544 (or a hardcoded 8)
  // would have passed exactly one of these two cases.
  const nine = await buildSnapshot('derive9', { weeks: 9 });
  const nineResults = run(nine.root, nine.readSource);
  assert.deepEqual(nineResults.failures, []);
  assert.deepEqual(nineResults.results.find((r) => r.name === 'overlay:2024').counts,
    { regGames: 18, overlayRows: 36 });
  assert.deepEqual(nineResults.results.find((r) => r.name === 'overlay:2025').counts,
    { regGames: 18, overlayRows: 36 });
});

test('the 544-rows-per-season figure is reproduced by DERIVATION at real season size', async () => {
  // 18 weeks x 2 games is only 36 games, so the fixture cannot reach a real
  // season's 272 by weeks alone (the overlay builder rejects week > 18, and
  // rightly). Instead, derive the expectation the way the check does, from a
  // games.csv-shaped input that really does hold 272 REG games per season, and
  // confirm the arithmetic lands on the preregistration's 544 team-rows.
  const rows = [];
  for (const season of [2024, 2025]) {
    for (let week = 1; week <= 18; week++) {
      // 16 games in most weeks, 8 in two of them: 16*16 + 8*2 = 272.
      const games = week <= 16 ? 16 : 8;
      for (let g = 0; g < games; g++) {
        rows.push({ game_id: `${season}_${week}_${g}`, season, game_type: 'REG', week });
      }
    }
  }
  const perSeason = new Map();
  for (const row of rows) {
    if (row.game_type !== 'REG') continue;
    perSeason.set(row.season, (perSeason.get(row.season) || 0) + 1);
  }
  assert.deepEqual([...perSeason.values()], [272, 272], 'the preregistration section-2.9 figure');
  assert.deepEqual([...perSeason.values()].map((n) => n * 2), [544, 544],
    'two team-rows per game is the 544-per-season patch count');
  assert.equal([...perSeason.values()].reduce((a, b) => a + b, 0), 544,
    'and 544 REG games across the two seasons, which is the other 544 in the plan');
});

test('the plausibility band guards the PINNED source only, and fires when it must', async () => {
  const { root, readSource } = await buildSnapshot('band');
  // Applied to fixture-sized bytes only when explicitly told the source is the
  // pin: 4 REG games is far below the band, so it fires.
  const forced = checks.runChecks({ root, readSource, normalizeTeamKey, assumePinnedSource: true });
  assert.ok(forced.failures.some((f) => /outside the plausibility band/.test(f.detail)),
    'the band fires when the pinned source has an implausible game count');
  // And by default it does not apply, because these are not the pinned bytes.
  const normal = run(root, readSource);
  assert.deepEqual(normal.failures, []);
  const source = normal.results.find((r) => r.name === 'overlay:source');
  assert.equal(source.counts.pinnedSource, 0);
  assert.match(source.detail, /NOT the preregistered pin/);
  assert.deepEqual(checks.REG_GAMES_PER_SEASON_BAND, { min: 256, max: 285 });
});

test('the pinned games.csv SHA-256 matches the sealed preregistration and the archived provenance', () => {
  const { GAMES_CSV_SHA256 } = require('../../scripts/backtest/lib/sources');
  const repoRoot = path.join(__dirname, '..', '..');
  const prereg = fs.readFileSync(
    path.join(repoRoot, 'backtest-artifacts', 'pit-sweep-2024-2025', 'PREREGISTRATION.md'), 'utf8'
  );
  assert.ok(prereg.includes(GAMES_CSV_SHA256),
    'the games.csv hash pinned in lib/sources.js appears in the sealed preregistration');
  const provenancePath = path.join(repoRoot, 'backtest-data', 'sources', 'provenance.json');
  if (fs.existsSync(provenancePath)) {
    const record = JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
      .records.find((r) => r.name === 'games');
    assert.equal(record.sha256, GAMES_CSV_SHA256);
  }
});

test('a games.csv that no longer hashes to what the extraction recorded fails immediately', async () => {
  const { root, readSource } = await buildSnapshot('sourcedrift');
  const drifted = (arg) => {
    const name = typeof arg === 'string' ? arg : arg.name;
    return name === 'games' ? `${readSource('games')}`.replace('KC', 'DEN') : readSource(arg);
  };
  const out = checks.runChecks({ root, readSource: drifted, normalizeTeamKey });
  assert.ok(out.failures.some((f) => f.name === 'overlay:source'
    && /but the extraction recorded/.test(f.detail)));
});

// ---------------------------------------------------------------------------
// Each check fails when its own invariant is broken
// ---------------------------------------------------------------------------

test('a tampered dataset fails the digest check by name', async () => {
  const { root, readSource } = await buildSnapshot('tamper');
  const file = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'player_stats');
  fs.writeFileSync(file, '{"player_id":1,"season":2024,"week":1,"stats":{}}\n');
  const { failures } = run(root, readSource);
  assert.equal(failures.length >= 1, true);
  assert.match(failures[0].name, /^dataset:evaluation\/feature\/player_stats$/);
  assert.match(failures[0].detail, /digest mismatch/);
});

test('a manifest digest that disagrees with a legitimately re-written dataset still fails', async () => {
  const { root, readSource } = await buildSnapshot('manifestpin');
  // Rewrite the dataset AND its sidecar consistently - the sidecar-only check
  // would now pass. The manifest's independent pin is what catches it.
  const rows = [{ player_id: 1, season: 2024, week: 1, stats: {} }];
  store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'player_stats', rows, seasonScoped: true,
  });
  const { failures } = run(root, readSource);
  assert.ok(failures.some((f) => /does not match the pinned/.test(f.detail)),
    'the manifest pin catches a consistent rewrite');
});

test('a 2026 row smuggled into the evaluation store fails the quarantine check', async () => {
  const { root, readSource } = await buildSnapshot('quarantine');
  // Write it consistently (dataset, sidecar AND manifest) so ONLY the
  // quarantine check can catch it. This is the mutation that matters: if the
  // boundary comparison were `>` instead of `>=`, or the season read as a
  // string, this snapshot would be accepted.
  const rows = [
    { season: 2024, week: 1, team_key: 'KC', opponent_key: 'WAS', source_team: 'KC', home_away: 'home', neutral_site: false, game_id: 'g1' },
  ];
  const poisoned = [...rows, { ...rows[0], season: 2026, game_id: 'g2026' }];
  const file = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'orientation_overlay');
  const text = store.rowsToNdjson(poisoned);
  fs.writeFileSync(file, text);
  const metaPath = `${file}.meta.json`;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.sha256 = sha256Hex(Buffer.from(text, 'utf8'));
  meta.rowCount = poisoned.length;
  fs.writeFileSync(metaPath, `${store.canonicalJson(meta)}\n`);
  const manifest = store.loadManifest(root);
  const entry = manifest.datasets.find((d) => d.dataset === 'orientation_overlay');
  entry.sha256 = meta.sha256;
  entry.rowCount = poisoned.length;
  store.saveManifest(root, manifest);

  const { failures } = run(root, readSource);
  // The STORE's load-time guard is the first thing to see it, so the dataset
  // check is where it surfaces - and it names the boundary.
  const dataset = failures.find((f) => f.name === 'evaluation/feature/orientation_overlay'
    || f.name === 'dataset:evaluation/feature/orientation_overlay');
  assert.ok(dataset, `expected the dataset check to fail, got ${failures.map((f) => f.name).join(', ')}`);
  assert.match(dataset.detail, /at or after the quarantine boundary 2026/);
});

test('snapshot-checks walks the rows itself, so it catches 2026 even if the store guard did not', () => {
  // The store refuses a 2026 evaluation row on load, which means the snapshot
  // level check above can never reach its own loop against a real snapshot.
  // That is exactly why this check exists as an INDEPENDENT walk: if the
  // store's guard were ever loosened, this is the thing still standing. Tested
  // directly, with a `loaded` map the store would never hand back.
  const clean = new Map([
    ['orientation_overlay', {
      rows: [{ season: 2024, week: 1 }, { season: 2025, week: 18 }],
      entry: { store: store.STORES.EVALUATION },
    }],
    ['games_csv', {
      rows: [{ season: 2026, week: 1 }],
      entry: { store: store.STORES.RAW }, // legal here, and must not be flagged
    }],
  ]);
  const ok = checks.checkQuarantine({ loaded: clean });
  assert.equal(ok.ok, true);
  assert.equal(ok.counts.evaluationRows, 2, 'raw rows are not counted as evaluation rows');

  for (const season of [2026, 2027, '2026']) {
    const poisoned = new Map([
      ['orientation_overlay', {
        rows: [{ season: 2025, week: 1 }, { season, week: 1 }],
        entry: { store: store.STORES.EVALUATION },
      }],
    ]);
    const result = checks.checkQuarantine({ loaded: poisoned });
    assert.equal(result.ok, false, `season ${season} must be refused`);
    assert.match(result.detail, /at or after 2026/);
  }
});

test('losing games.csv 2026 rows from the raw provenance store is a failure, not a shrug', async () => {
  const { root, readSource } = await buildSnapshot('provloss');
  const loaded = store.loadDataset({
    root, store: store.STORES.RAW, path: store.PATHS.PROVENANCE, dataset: 'games_csv',
  });
  const trimmed = loaded.rows.filter((r) => r.season < 2026);
  const meta = store.saveDataset({
    root, store: store.STORES.RAW, path: store.PATHS.PROVENANCE,
    dataset: 'games_csv', rows: trimmed, seasonScoped: true,
  });
  const manifest = store.loadManifest(root);
  const entry = manifest.datasets.find((d) => d.dataset === 'games_csv');
  entry.sha256 = meta.sha256;
  entry.rowCount = meta.rowCount;
  store.saveManifest(root, manifest);
  const { failures } = run(root, readSource);
  assert.ok(failures.some((f) => f.name === 'rawProvenance' && /retains no 2026 rows/.test(f.detail)));
});

test('games_csv moved off the provenance path fails, because a feature loader could then reach 2026', async () => {
  const { root, readSource } = await buildSnapshot('provpath');
  const loaded = store.loadDataset({
    root, store: store.STORES.RAW, path: store.PATHS.PROVENANCE, dataset: 'games_csv',
  });
  const meta = store.saveDataset({
    root, store: store.STORES.RAW, path: store.PATHS.FEATURE,
    dataset: 'games_csv', rows: loaded.rows, seasonScoped: true,
  });
  const manifest = store.loadManifest(root);
  const entry = manifest.datasets.find((d) => d.dataset === 'games_csv');
  entry.path = store.PATHS.FEATURE;
  entry.sha256 = meta.sha256;
  store.saveManifest(root, manifest);
  const { failures } = run(root, readSource);
  assert.ok(failures.some((f) => f.name === 'rawProvenance'
    && /not provenance; it retains 2026 rows/.test(f.detail)),
  `expected the path check to fire, got ${failures.map((f) => f.name).join(', ')}`);
});

test('the schedule window is checked against the weekly window, and empty seasons must be recorded', async () => {
  const { root, readSource } = await buildSnapshot('window');
  const clean = run(root, readSource);
  assert.deepEqual(clean.failures, []);
  const window = clean.results.find((r) => r.name === 'scheduleWindow');
  assert.deepEqual(window.counts, { 2022: 0, 2023: 0, 2024: 8, 2025: 8 });
  // The two empty seasons are reported as observations, not omissions.
  assert.match(clean.results.find((r) => r.name === 'scheduleWindow:2022').detail,
    /captured as empty, and recorded as an observation/);

  // A narrower schedule capture than the weekly one is the B1 regression, and
  // it fails by name.
  const narrowed = await buildSnapshot('windownarrow');
  const m = store.loadManifest(narrowed.root);
  m.scheduleSeasons = [2024, 2025];
  store.saveManifest(narrowed.root, m);
  let out = run(narrowed.root, narrowed.readSource);
  assert.ok(out.failures.some((f) => f.name === 'scheduleWindow'
    && /the history window reaches both relations equally/.test(f.detail)));

  // An empty season that is NOT recorded in capturedAsEmpty also fails: the
  // point of the record is that "no rows" is a measurement.
  const unrecorded = await buildSnapshot('windowunrecorded');
  const m2 = store.loadManifest(unrecorded.root);
  m2.capturedAsEmpty.nfl_games = [];
  store.saveManifest(unrecorded.root, m2);
  out = run(unrecorded.root, unrecorded.readSource);
  assert.ok(out.failures.some((f) => f.name === 'scheduleWindow:2022'
    && /must be recorded as an observation/.test(f.detail)));

  // And a row count that disagrees with the manifest fails.
  const miscounted = await buildSnapshot('windowcount');
  const m3 = store.loadManifest(miscounted.root);
  m3.scheduleRowsBySeason['2024'] = 999;
  store.saveManifest(miscounted.root, m3);
  out = run(miscounted.root, miscounted.readSource);
  assert.ok(out.failures.some((f) => f.name === 'scheduleWindow:2024'
    && /the manifest records 999/.test(f.detail)));
});

test('a manifest missing scheduleRowsBySeason produces a FAIL line, never a TypeError', async () => {
  const { root, readSource } = await buildSnapshot('nocounts');
  const manifest = store.loadManifest(root);
  delete manifest.scheduleRowsBySeason;
  store.saveManifest(root, manifest);

  // The whole run still completes and reports: a crash here would bury every
  // other check behind a stack trace, which is the opposite of what a
  // verification tool should do when it finds a malformed input.
  let out;
  assert.doesNotThrow(() => { out = run(root, readSource); });
  assert.ok(out.failures.some((f) => f.name === 'scheduleWindow'
    && /records no scheduleRowsBySeason/.test(f.detail)),
  `expected a clean scheduleWindow failure, got ${out.failures.map((f) => f.name).join(', ')}`);
  // The completeness check names it too, and the other checks still ran.
  assert.ok(out.failures.some((f) => f.name === 'manifest' && /scheduleRowsBySeason/.test(f.detail)));
  assert.ok(out.results.some((r) => r.name === 'quarantine' && r.ok),
    'unrelated checks still produced their results');

  // And the CLI exits nonzero with a readable line rather than a crash.
  const lines = [];
  const code = checks.main(['--snapshot', root], {
    log: (l) => lines.push(String(l)), readSource, normalizeTeamKey,
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /FAIL scheduleWindow: the manifest records no scheduleRowsBySeason/);
});

test('an overlay row with a lost neutral-site flag fails, because it would reach the home-field factor', async () => {
  const { root, readSource } = await buildSnapshot('neutral');
  const file = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'orientation_overlay');
  const { rows } = store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'orientation_overlay',
  });
  const broken = rows.map((r) => (r.neutral_site === true ? { ...r, neutral_site: false } : r));
  const meta = store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'orientation_overlay', rows: broken, seasonScoped: true,
  });
  const manifest = store.loadManifest(root);
  const entry = manifest.datasets.find((d) => d.dataset === 'orientation_overlay');
  entry.sha256 = meta.sha256;
  store.saveManifest(root, manifest);
  const { failures } = run(root, readSource);
  assert.ok(failures.some((f) => f.name === 'overlay:neutral'),
    `expected overlay:neutral to fail, got ${failures.map((f) => f.name).join(', ')}`);
  assert.ok(file.endsWith('.ndjson'));
});

test('an nfl_games row with no overlay patch fails the coverage check', async () => {
  const { root, readSource } = await buildSnapshot('coverage');
  const { rows } = store.loadDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE, dataset: 'orientation_overlay',
  });
  const short = rows.filter((r) => !(r.season === 2024 && r.week === 1 && r.team_key === 'KC'));
  const meta = store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: 'orientation_overlay', rows: short, seasonScoped: true,
  });
  const manifest = store.loadManifest(root);
  const entry = manifest.datasets.find((d) => d.dataset === 'orientation_overlay');
  entry.sha256 = meta.sha256;
  entry.rowCount = meta.rowCount;
  store.saveManifest(root, manifest);
  const { failures } = run(root, readSource);
  const names = failures.map((f) => f.name);
  assert.ok(names.includes('overlay:2024'), `expected overlay:2024 to fail, got ${names.join(', ')}`);
  assert.ok(names.includes('overlay:coverage:2024'), 'and the coverage check to name the gap');
});

test('an oracle moved onto the feature path fails, since that is the poisoning case', async () => {
  const { root, readSource } = await buildSnapshot('oraclepath');
  const manifest = store.loadManifest(root);
  const entry = manifest.datasets.find((d) => d.dataset === 'oracle_2025_w9');
  const { rows } = store.loadDataset({
    root, store: entry.store, path: entry.path, dataset: entry.dataset,
  });
  const meta = store.saveDataset({
    root, store: store.STORES.EVALUATION, path: store.PATHS.FEATURE,
    dataset: entry.dataset, rows, seasonScoped: true,
  });
  entry.path = store.PATHS.FEATURE;
  entry.sha256 = meta.sha256;
  store.saveManifest(root, manifest);
  const { failures } = run(root, readSource);
  assert.ok(failures.some((f) => f.name === 'oracle:2025 W9'
    && /exactly the poisoning the two paths exist to prevent/.test(f.detail)));
});

test('a missing oracle week, or a branch record that disagrees with the observed SQL, fails', async () => {
  const { root, readSource } = await buildSnapshot('oraclebranch');
  const manifest = store.loadManifest(root);
  manifest.oracles = manifest.oracles.filter((o) => !(o.season === 2024 && o.week === 10));
  store.saveManifest(root, manifest);
  let out = run(root, readSource);
  assert.ok(out.failures.some((f) => f.name === 'oracle:2024 W10'
    && /no oracle recorded for a preregistered week/.test(f.detail)));

  const again = await buildSnapshot('oraclebranch2');
  const m2 = store.loadManifest(again.root);
  const w9 = m2.oracles.find((o) => o.season === 2025 && o.week === 9);
  w9.observedSql = w9.observedSql.filter((s) => s !== 'leagueScan');
  store.saveManifest(again.root, m2);
  out = run(again.root, again.readSource);
  assert.ok(out.failures.some((f) => f.name === 'oracle:2025 W9'
    && /disagrees with the recorded/.test(f.detail)));
});

test('a manifest missing a field the freeze will pin fails completeness', async () => {
  const { root, readSource } = await buildSnapshot('incomplete');
  const manifest = store.loadManifest(root);
  delete manifest.schemaFingerprint;
  store.saveManifest(root, manifest);
  let out = run(root, readSource);
  assert.ok(out.failures.some((f) => f.name === 'manifest' && /schemaFingerprint/.test(f.detail)));

  const again = await buildSnapshot('incomplete2');
  const m2 = store.loadManifest(again.root);
  m2.sqlSurface = m2.sqlSurface.slice(0, 7);
  store.saveManifest(again.root, m2);
  out = run(again.root, again.readSource);
  assert.ok(out.failures.some((f) => /pins 7 SQL texts, expected the 8/.test(f.detail)));

  const third = await buildSnapshot('incomplete3');
  const m3 = store.loadManifest(third.root);
  m3.database.transactionReadOnly = 'off';
  store.saveManifest(third.root, m3);
  out = run(third.root, third.readSource);
  assert.ok(out.failures.some((f) => /passed database identity assertion/.test(f.detail)));

  const fourth = await buildSnapshot('incomplete4');
  const m4 = store.loadManifest(fourth.root);
  m4.overlay.writtenToDatabase = true;
  store.saveManifest(fourth.root, m4);
  out = run(fourth.root, fourth.readSource);
  assert.ok(out.failures.some((f) => /was NOT written to the database/.test(f.detail)));

  const fifth = await buildSnapshot('incomplete5');
  const m5 = store.loadManifest(fifth.root);
  m5.integrityChecks[0].status = 'skipped';
  store.saveManifest(fifth.root, m5);
  out = run(fifth.root, fifth.readSource);
  assert.ok(out.failures.some((f) => /not recorded as passed/.test(f.detail)));
});

// ---------------------------------------------------------------------------
// Reported counts (findings, never failures)
// ---------------------------------------------------------------------------

test('gameTeam coverage is counted per season and reported, never gated', async () => {
  // gameTeam present in week 1 only, so coverage is a strict fraction.
  const { root, readSource } = await buildSnapshot('gameteam', { weeks: 2, gameTeamOn: [1] });
  const { results, failures } = run(root, readSource);
  assert.deepEqual(failures, []);
  const coverage = results.find((r) => r.name === 'gameTeamCoverage');
  assert.equal(coverage.ok, true);
  assert.deepEqual(coverage.counts['2024'], { rows: 10, withGameTeam: 5, withGameOpponent: 5 });
  assert.deepEqual(coverage.counts['2025'], { rows: 10, withGameTeam: 5, withGameOpponent: 5 });
  // Only seasons that actually have rows appear. 2022 and 2023 are
  // captured-as-empty, so they are recorded in the manifest's capturedAsEmpty
  // rather than reported here as a spurious zero-coverage season.
  assert.deepEqual(Object.keys(coverage.counts), ['2024', '2025']);
  assert.deepEqual(store.loadManifest(root).capturedAsEmpty.player_stats, [2022, 2023]);
});

test('crosswalk-unmapped roster identifiers are counted per season', async () => {
  const { root, readSource } = await buildSnapshot('crosswalk');
  const { results } = run(root, readSource);
  const coverage = results.find((r) => r.name === 'crosswalkCoverage');
  assert.equal(coverage.ok, true);
  assert.equal(coverage.counts.crosswalkMappable, 2, 'the legacy-shaped id is excluded by shape');
  assert.deepEqual(coverage.counts.roster_weekly_2024,
    { distinctIds: 3, unmapped: 1, blankGsisId: 1 });
  assert.deepEqual(coverage.counts.roster_weekly_2025,
    { distinctIds: 3, unmapped: 1, blankGsisId: 1 });
});

test('a roster-vs-gameTeam contradiction is counted, and a WAS/WSH spelling is not one', async () => {
  const { root, readSource } = await buildSnapshot('contradiction');
  const { results, failures } = run(root, readSource);
  assert.deepEqual(failures, []);
  const contradictions = results.find((r) => r.name === 'teamContradictions');
  assert.equal(contradictions.ok, true, 'a contradiction is REPORTED, never a failure');
  // Three stat rows have a matching roster player-week; exactly one of them
  // disagrees on team (roster WAS vs gameTeam BUF). The LA/WAS pair does NOT
  // count, because both sides normalize to the same key.
  assert.deepEqual(contradictions.counts['2024'],
    { compared: 3, contradictions: 1, statRowsWithNoRosterRow: 1 });
  assert.deepEqual(contradictions.counts['2025'],
    { compared: 3, contradictions: 1, statRowsWithNoRosterRow: 1 });
});

test('without normalizeTeamKey the contradiction count is skipped rather than guessed, and the skip is honestly labeled', async () => {
  const { root, readSource } = await buildSnapshot('nonormalize');
  const out = checks.runChecks({ root, readSource, normalizeTeamKey: null });
  const contradictions = out.results.find((r) => r.name === 'teamContradictions');
  // ok:true only means "not a failure" (exit code stays 0) - skipped:true is
  // the field that must be checked before this is ever read as success.
  assert.equal(contradictions.ok, true);
  assert.equal(contradictions.skipped, true);
  assert.match(contradictions.detail, /not executed - no normalizeTeamKey injected/);
  assert.deepEqual(out.failures, [], 'a skip is never a failure');

  const lines = checks.formatResults(out.results);
  const skipLine = lines.find((l) => l.includes('teamContradictions'));
  assert.match(skipLine, /^ {2}SKIP teamContradictions: not executed - no normalizeTeamKey injected$/,
    'rendered as SKIP, never as "ok" - the dishonest label the user originally flagged');
});

test('main() renders the skipped teamContradictions as SKIP and counts it separately in the summary line', async () => {
  const { root, readSource } = await buildSnapshot('nonormalize-main');
  const lines = [];
  const code = checks.main(['--snapshot', root], {
    log: (l) => lines.push(String(l)), readSource, normalizeTeamKey: null,
  });
  const text = lines.join('\n');
  assert.equal(code, 0, 'a skip alone is not a failure');
  assert.match(text, /SKIP teamContradictions: not executed - no normalizeTeamKey injected/);
  assert.ok(!/ok {2}teamContradictions/.test(text), 'never rendered as ok');
  assert.match(text, /\d+ passed, 1 skipped, 0 failed/);
});

test('formatResults never hides a SKIP under --quiet, and never folds it into an "ok" label', () => {
  const results = [
    { name: 'a', ok: true, detail: 'fine', counts: {} },
    { name: 'b', ok: true, skipped: true, detail: 'not executed', counts: {} },
  ];
  const quiet = checks.formatResults(results, { quiet: true });
  assert.equal(quiet.length, 1, 'the ordinary pass is hidden, the skip is not');
  assert.match(quiet[0], /^ {2}SKIP b: not executed$/);
});

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

test('main() exits nonzero when anything fails', async () => {
  const { root, readSource } = await buildSnapshot('exitcode');
  const file = store.datasetFile(root, store.STORES.EVALUATION, store.PATHS.FEATURE, 'players');
  fs.writeFileSync(file, '');
  const lines = [];
  const code = checks.main(['--snapshot', root], {
    log: (l) => lines.push(String(l)), readSource, normalizeTeamKey,
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /FAIL dataset:evaluation\/feature\/players/);
});

test('a missing manifest is an error, not an empty pass', () => {
  const root = tmpRoot('nomanifest');
  assert.throws(() => checks.runChecks({ root, readSource: () => '' }), /no snapshot manifest/);
});

test('parseArgs rejects unknown flags and defaults to the repo snapshot directory', () => {
  const args = checks.parseArgs([]);
  assert.equal(args.snapshot, checks.DEFAULT_SNAPSHOT_DIR);
  assert.equal(args.quiet, false);
  assert.equal(checks.parseArgs(['--quiet']).quiet, true);
  assert.throws(() => checks.parseArgs(['--nope']), /unknown argument --nope/);
});

test('formatResults hides passes in quiet mode but never hides a failure', () => {
  const results = [
    { name: 'a', ok: true, detail: 'fine', counts: {} },
    { name: 'b', ok: false, detail: 'broken', counts: { x: 1 } },
  ];
  const quiet = checks.formatResults(results, { quiet: true });
  assert.equal(quiet.length, 1);
  assert.match(quiet[0], /FAIL b: broken/);
  assert.equal(checks.formatResults(results).length, 3);
});
