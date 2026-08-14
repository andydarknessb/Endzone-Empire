const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const model = require('../services/projectionModel');
const projectionSvc = require('../services/projection.service');
const holdout = require('../services/holdout.service');
const { SCORING_PRESETS } = require('../services/scoring.service');
const { computeManifestDigest } = require('../services/scheduleManifest');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------
// Fake pool with REAL transaction semantics
// ---------------------------------------------------------------------------

/**
 * Models what the capture actually relies on from Postgres: writes inside a
 * transaction are BUFFERED and only become durable on COMMIT (discarded on
 * ROLLBACK), the header CHECK and the child cutoff trigger judge the FAKE
 * DATABASE CLOCK (`clock()`, a queue-able function), identities are unique,
 * and every statement is recorded. `failOn(text, params)` injects a failure
 * at any statement to prove all-or-nothing.
 */
function fakeDb({
  clock = () => new Date('2077-09-09T12:00:00Z'),
  schedule = [],
  seasonMatrix = [], // [{ team_key, weeks: [..] }] for the whole season
  cohort = [],
  existingSnapshots = [],
  existingPlayers = [],
  due = [],
  failOn = null,
} = {}) {
  const matrix = seasonMatrix;
  const committed = {
    snapshots: [...existingSnapshots],
    players: [...existingPlayers],
    status: [],
  };
  const statements = [];
  let nextId = committed.snapshots.reduce((m, s) => Math.max(m, s.id), 0) + 1;

  // Kind-aware since protocol 2: a capture writes one header per arm, and
  // the unique key includes capture_kind.
  const findSnapshot = (pools, season, week, hash, version, kind = 'scheduled') => {
    for (const list of pools) {
      const hit = list.find(
        (r) => r.season === season && r.week === week && r.scoring_hash === hash
          && r.model_version === version && r.capture_kind === kind
      );
      if (hit) return hit;
    }
    return null;
  };

  function makeConn() {
    let tx = null;
    const conn = {
      released: false,
      release() { conn.released = true; },
      async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ');
        statements.push({ text, params });
        if (failOn && failOn(text, params)) throw new Error('injected failure');
        if (text === 'BEGIN') { tx = { snapshots: [], players: [] }; return { rows: [] }; }
        if (text === 'COMMIT') {
          if (tx) { committed.snapshots.push(...tx.snapshots); committed.players.push(...tx.players); }
          tx = null;
          return { rows: [] };
        }
        if (text === 'ROLLBACK') { tx = null; return { rows: [] }; }
        if (text.startsWith('SET TRANSACTION')) return { rows: [] };
        if (text.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (text.includes('clock_timestamp()')) return { rows: [{ now: clock() }] };
        if (text.includes('array_agg(DISTINCT "week")')) return { rows: matrix };
        if (text.includes('FROM "nfl_games"') && text.includes('ORDER BY "nfl_team"')) {
          return { rows: schedule };
        }
        if (text.includes('MIN("kickoff_at")')) return { rows: due };
        if (text.includes('FROM "players"')) return { rows: cohort };
        if (text.includes('SELECT "player_id" FROM "projection_snapshot_players"')) {
          const [snapshotId] = params;
          const ids = committed.players
            .filter((p) => p.snapshot_id === snapshotId)
            .map((p) => p.player_id)
            .sort((x, y) => x - y);
          return { rows: ids.map((id) => ({ player_id: id })) };
        }
        if (text.includes('"s"."cohort_size"')) {
          const [season, week, hash, version, kinds] = params;
          const wanted = Array.isArray(kinds) ? kinds : ['scheduled'];
          const rows = [];
          for (const kind of wanted) {
            const s = findSnapshot([committed.snapshots, tx ? tx.snapshots : []], season, week, hash, version, kind);
            if (!s) continue;
            const count = committed.players.concat(tx ? tx.players : [])
              .filter((p) => p.snapshot_id === s.id).length;
            rows.push({ ...s, rows: count });
          }
          return { rows };
        }
        if (text.includes('INSERT INTO "projection_snapshots"')) {
          const [season, week, profile, hash, version, cHash, release, cohortHash, cohortSize,
            scheduleGames, scheduleHash, protocolVersion, captureKind, captureNotAfter] = params;
          const capturedAt = clock();
          if (!(capturedAt < new Date(captureNotAfter))) {
            throw new Error('violates check constraint "projection_snapshots_pre_deadline_check"');
          }
          if (findSnapshot([committed.snapshots, tx ? tx.snapshots : []], season, week, hash, version, captureKind)) {
            throw new Error('duplicate key value violates unique constraint');
          }
          const row = {
            id: nextId++, season, week, scoring_profile: profile, scoring_hash: hash,
            model_version: version, constants_hash: cHash, release_sha: release,
            cohort_hash: cohortHash, cohort_size: cohortSize, schedule_games: scheduleGames,
            schedule_hash: scheduleHash, protocol_version: protocolVersion,
            capture_kind: captureKind, capture_not_after: captureNotAfter,
            captured_at: capturedAt, is_late: false,
          };
          (tx ? tx.snapshots : committed.snapshots).push(row);
          return { rows: [{ id: row.id }] };
        }
        if (text.includes('INSERT INTO "projection_snapshot_players"')) {
          const COLS = 18;
          const target = tx ? tx.players : committed.players;
          for (let i = 0; i < params.length; i += COLS) {
            const snapshotId = params[i];
            const playerId = params[i + 1];
            const parent = [...committed.snapshots, ...(tx ? tx.snapshots : [])]
              .find((s) => s.id === snapshotId);
            if (!parent) throw new Error(`holdout child row references missing snapshot ${snapshotId}`);
            // The migration's BEFORE INSERT trigger, judged by the DB clock.
            if (!parent.is_late && clock() >= new Date(parent.capture_not_after)) {
              throw new Error(`holdout snapshot ${snapshotId} is past its capture deadline; child rows are frozen`);
            }
            if (target.concat(tx ? committed.players : []).some(
              (r) => r.snapshot_id === snapshotId && r.player_id === playerId
            )) {
              throw new Error('duplicate key value violates unique constraint');
            }
            target.push({
              snapshot_id: snapshotId, player_id: playerId,
              mean: params[i + 2], median: params[i + 3],
              position: params[i + 12], nfl_team: params[i + 13], injury_status: params[i + 14],
              opponent: params[i + 15], home_away: params[i + 16], game_kickoff_at: params[i + 17],
            });
          }
          return { rows: [], rowCount: params.length / COLS };
        }
        if (text.includes('INSERT INTO "holdout_capture_status"')) {
          const [season, week, profile, status, message, snapshotId] = params;
          const existing = committed.status.find(
            (r) => r.season === season && r.week === week && r.scoring_profile === profile
          );
          if (existing) {
            Object.assign(existing, { status, message, attempts: existing.attempts + 1 });
            if (snapshotId != null) existing.snapshot_id = snapshotId;
          } else {
            committed.status.push({ season, week, scoring_profile: profile, status, message, snapshot_id: snapshotId, attempts: 1 });
          }
          return { rows: [] };
        }
        return { rows: [] };
      },
    };
    return conn;
  }

  const conns = [];
  return {
    committed,
    statements,
    conns,
    async connect() { const c = makeConn(); conns.push(c); return c; },
    async query(sql, params) { return makeConn().query(sql, params); },
  };
}

// A fully closed synthetic season over the CANONICAL domain: 32 teams, 18
// weeks, 17 appearances each. The validator's universe is an expectation,
// not an observation, so anything smaller than the real NFL fails it.
// Season 2077 so the fixtures never collide with the real committed 2026
// manifest; the synthetic manifest is registered for the whole file.
const { buildSeason } = require('./helpers/holdoutSeason');
const KICKOFF = '2077-09-10T00:20:00Z';
const FIXTURE_SEASON = 2077;
const SEASON = buildSeason({ season: FIXTURE_SEASON, firstKickoff: KICKOFF });
const WEEK1 = SEASON.rowsByWeek.get(1);
const MATRIX = SEASON.matrixRows;
const MANIFEST_WEEK1 = SEASON.manifest.games.filter((g) => g.week === 1);
holdout.registerSeasonManifest(SEASON.manifest);
test.after(() => { holdout.SEASON_MANIFESTS.delete(FIXTURE_SEASON); });

// A second synthetic season modeling the Week 18 Saturday reserve: the
// manifest's week-18 deadline is a date-flex override 24 hours EARLIER than
// every stored (placeholder Sunday) kickoff - the real 2026 hazard, in
// fixture form.
const RESERVE_SEASON = 2076;
const SEASON18_BASE = new Date('2076-09-10T00:20:00Z').getTime();
const WK18_SUNDAY = new Date(SEASON18_BASE + 17 * 7 * 24 * 3600 * 1000); // derived earliest kickoff
const WK18_RESERVE = new Date(WK18_SUNDAY.getTime() - 24 * 3600 * 1000); // the Saturday reserve
const SEASON18 = buildSeason({
  season: RESERVE_SEASON,
  firstKickoff: new Date(SEASON18_BASE).toISOString(),
  deadlineOverrides: { 18: WK18_RESERVE.toISOString() },
});
holdout.registerSeasonManifest(SEASON18.manifest);
test.after(() => { holdout.SEASON_MANIFESTS.delete(RESERVE_SEASON); });
const COHORT = [
  { id: 7, position: 'QB', nfl_team: 'KC', injury_status: null },
  { id: 8, position: 'WR', nfl_team: 'DET', injury_status: 'Questionable' },
  { id: 9, position: 'RB', nfl_team: 'BUF', injury_status: null },
];
const DET_GAME = WEEK1.find((r) => r.nfl_team === 'DET');

function mockGenerate(t, { seen = [] } = {}) {
  t.mock.method(projectionSvc, 'generateProjections', async (args) => {
    seen.push(args);
    return {
      projections: new Map(args.playerIds.map((id) => [id, {
        mean: id + 0.5, median: id + 0.25, p10: 1, p25: 2, p75: 8, p90: 9,
        activeProbability: 1, confidence: 'high', sampleSize: 4, factors: { note: 'test' },
      }])),
      inputCutoff: new Date('2077-09-09T11:00:00Z'),
      sourceCoverage: { stats: 'ok' },
    };
  });
  return seen;
}

function withReleaseSha(t, sha = 'testsha0000') {
  const prev = process.env.APP_RELEASE;
  process.env.APP_RELEASE = sha;
  t.after(() => {
    if (prev === undefined) delete process.env.APP_RELEASE;
    else process.env.APP_RELEASE = prev;
  });
  return sha;
}

const dbArgs = (overrides = {}) => ({
  schedule: WEEK1, seasonMatrix: MATRIX, cohort: COHORT, ...overrides,
});
const captureArgs = (db) => ({
  season: FIXTURE_SEASON, week: 1, profileName: 'half_ppr', rules: SCORING_PRESETS.half_ppr, client: db,
});

// ---------------------------------------------------------------------------
// All-or-nothing transaction
// ---------------------------------------------------------------------------

test('a successful capture commits header and every child in one transaction', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const db = fakeDb(dbArgs());

  const out = await holdout.snapshotWeek(captureArgs(db));

  assert.equal(out.inserted, 3);
  assert.equal(db.committed.snapshots.length, 3, 'one header per arm: scheduled + the two candidate cells');
  assert.equal(db.committed.players.length, 9, 'every arm carries the full cohort');
  const texts = db.statements.map((s) => s.text);
  const order = ['BEGIN', 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ', 'pg_advisory_xact_lock', 'COMMIT']
    .map((needle) => texts.findIndex((s) => s.includes(needle)));
  assert.ok(order.every((i, n) => i !== -1 && (n === 0 || i > order[n - 1])),
    `tx bracket out of order: ${JSON.stringify(order)}`);
  assert.ok(db.conns.every((c) => c.released), 'the connection goes back to the pool');
  // Frozen capture-time context rides on every child row.
  const wr = db.committed.players.find((p) => p.player_id === 8);
  assert.equal(wr.position, 'WR');
  assert.equal(wr.nfl_team, 'DET');
  assert.equal(wr.injury_status, 'Questionable');
  assert.equal(wr.opponent, DET_GAME.opponent);
  assert.equal(wr.home_away, DET_GAME.home_away);
  assert.equal(wr.game_kickoff_at, DET_GAME.kickoff_at);
  // Header carries the validated schedule digest and protocol version.
  assert.equal(db.committed.snapshots[0].schedule_games, 16, 'a full no-bye week of the canonical 32');
  assert.equal(db.committed.snapshots[0].protocol_version, holdout.HOLDOUT_PROTOCOL_VERSION);
  assert.equal(typeof db.committed.snapshots[0].schedule_hash, 'string');
  // The header's deadline is the EFFECTIVE cutoff (here: manifest deadline,
  // since the observed first kickoff equals it) - the CHECK and the child
  // trigger judge against this stored instant.
  assert.equal(
    new Date(db.committed.snapshots[0].capture_not_after).toISOString(),
    new Date(KICKOFF).toISOString()
  );
});

test('an injected mid-batch failure rolls back header AND children — nothing persists', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const db = fakeDb(dbArgs({
    failOn: (text) => text.includes('INSERT INTO "projection_snapshot_players"'),
  }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /injected failure/);
  assert.equal(db.committed.snapshots.length, 0, 'no orphan header');
  assert.equal(db.committed.players.length, 0, 'no orphan children');
  assert.ok(db.statements.some((s) => s.text === 'ROLLBACK'), 'the transaction was rolled back');
  assert.ok(db.conns.every((c) => c.released), 'the connection still goes back to the pool');
});

test('a clean retry after a crashed capture starts from nothing and succeeds', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  let arm = true;
  const db = fakeDb(dbArgs({
    failOn: (text) => arm && text.includes('INSERT INTO "projection_snapshot_players"'),
  }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)));
  arm = false;
  const out = await holdout.snapshotWeek(captureArgs(db));
  assert.equal(out.inserted, 3, 'the retry captures cleanly — no conflict, no completion of a partial');
  assert.equal(db.committed.snapshots.length, 3);
  assert.equal(db.committed.players.length, 9);
});

// ---------------------------------------------------------------------------
// Conflict handling: exact match or loud failure
// ---------------------------------------------------------------------------

function seededSnapshot({ cohortHash, scheduleHash, releaseSha, constantsHashValue, cohortSize = 3 }) {
  return {
    id: 50, season: FIXTURE_SEASON, week: 1,
    scoring_hash: model.scoringHash(SCORING_PRESETS.half_ppr),
    model_version: model.MODEL_VERSION,
    constants_hash: constantsHashValue ?? holdout.constantsHash(),
    release_sha: releaseSha ?? 'testsha0000',
    cohort_hash: cohortHash ?? sha256(COHORT.map((r) => r.id).join(',')),
    schedule_hash: scheduleHash,
    protocol_version: holdout.HOLDOUT_PROTOCOL_VERSION,
    capture_kind: 'scheduled', cohort_size: cohortSize,
    capture_not_after: KICKOFF, is_late: false,
  };
}

/** The complete protocol-2 arm set: scheduled + both candidate cells, ids 50-52. */
function seededTriple({ scheduleHash }) {
  const snapshots = holdout.captureArms().map((arm, i) => ({
    ...seededSnapshot({ scheduleHash, constantsHashValue: arm.hash }),
    id: 50 + i,
    capture_kind: arm.kind,
  }));
  const players = snapshots.flatMap((snap) => COHORT.map((r) => ({ snapshot_id: snap.id, player_id: r.id })));
  return { snapshots, players };
}

function scheduleHashOf(rows) {
  // Derive the hash the service will compute, through its own validator.
  return holdout.validateSchedule({
    rows, seasonMatrix: MATRIX, manifestGames: MANIFEST_WEEK1,
    season: FIXTURE_SEASON, week: 1,
  }).scheduleHash;
}

test('an existing capture is skipped ONLY as an exact, complete match of EVERY arm', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const triple = seededTriple({ scheduleHash: scheduleHashOf(WEEK1) });
  const db = fakeDb(dbArgs({
    existingSnapshots: triple.snapshots,
    existingPlayers: triple.players,
  }));

  const out = await holdout.snapshotWeek(captureArgs(db));
  assert.equal(out.skipped, 'already complete');
  assert.equal(out.snapshotId, 50, 'the scheduled header id is the primary identity');
  assert.deepEqual(out.armSnapshotIds, {
    scheduled: 50, 'candidate:bw-20': 51, 'candidate:bw-15': 52,
  });
  assert.equal(seen.length, 0, 'no projection run for a skip');
  assert.equal(db.committed.players.length, 9, 'nothing appended');
  assert.ok(!db.statements.some((s) => s.text.includes('INSERT INTO "projection_snapshots"')),
    'no header insert attempted');
});

test('a scheduled-only capture AT THE CURRENT PROTOCOL is a loud partial-arm conflict, never appended to', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  // The scheduled arm alone, exact and complete - what a pre-arms deployment
  // would have written. Appending the candidate arms NOW would compute them
  // on a different day from a different snapshot: mixed provenance.
  const snap = seededSnapshot({ scheduleHash: scheduleHashOf(WEEK1) });
  const db = fakeDb(dbArgs({
    existingSnapshots: [snap],
    existingPlayers: COHORT.map((r) => ({ snapshot_id: 50, player_id: r.id })),
  }));

  await assert.rejects(
    holdout.snapshotWeek(captureArgs(db)),
    /partial arm set - existing \[scheduled\], missing \[candidate:bw-15, candidate:bw-20\]/
  );
  assert.equal(seen.length, 0, 'no projection run was computed for a poisoned week');
  assert.equal(db.committed.snapshots.length, 1, 'the legacy snapshot is untouched');
  assert.equal(db.committed.players.length, 3);
});

test('cohort drift against an existing snapshot fails loudly instead of skipping or appending', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const snap = seededSnapshot({
    scheduleHash: scheduleHashOf(WEEK1),
    cohortHash: sha256('7,8'), // captured before player 9 existed
    cohortSize: 2,
  });
  const db = fakeDb(dbArgs({
    existingSnapshots: [snap],
    existingPlayers: [{ snapshot_id: 50, player_id: 7 }, { snapshot_id: 50, player_id: 8 }],
  }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /provenance mismatch/);
  assert.equal(db.committed.players.length, 2, 'the old snapshot is untouched');
});

test('a skip is refused when child rows do not reproduce the header cohort digest', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  // Header claims cohort [7,8,9] and is "complete" by count, but one child
  // row belongs to a different player. The header cannot be trusted about
  // its children; the digest re-derivation catches it.
  const snap = seededSnapshot({ scheduleHash: scheduleHashOf(WEEK1) });
  const db = fakeDb(dbArgs({
    existingSnapshots: [snap],
    existingPlayers: [
      { snapshot_id: 50, player_id: 7 },
      { snapshot_id: 50, player_id: 8 },
      { snapshot_id: 50, player_id: 99 },
    ],
  }));

  await assert.rejects(
    holdout.snapshotWeek(captureArgs(db)),
    /child rows do not reproduce the header cohort digest/
  );
  assert.equal(db.committed.players.length, 3, 'the anomalous snapshot is untouched');
});

test('the capture never touches the global pool - every read shares the transaction snapshot', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const poolModule = require('../modules/pool');
  t.mock.method(poolModule, 'query', async () => {
    throw new Error('capture leaked a read to the global pool');
  });
  const db = fakeDb(dbArgs());

  const out = await holdout.snapshotWeek(captureArgs(db));
  assert.equal(out.inserted, 3, 'the whole capture ran through the injected client alone');
});

test('an incomplete existing snapshot is NEVER completed with a new projection run', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const snap = seededSnapshot({ scheduleHash: scheduleHashOf(WEEK1) });
  const db = fakeDb(dbArgs({
    existingSnapshots: [snap],
    existingPlayers: [{ snapshot_id: 50, player_id: 7 }], // 1 of 3 — a legacy partial
  }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /incomplete \(1\/3 rows\)/);
  assert.equal(seen.length, 0, 'no new projection run was even computed');
  assert.equal(db.committed.players.length, 1, 'nothing appended under the old header');
});

test('a GENUINE protocol-1 legacy row names the protocol transition, not corruption', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  // What an actual pre-arms capture left behind: protocol_version LITERALLY 1.
  // Adversarial review finding: the partial-arm test above seeds the CURRENT
  // protocol, so the transitional case never ran, and the real message was
  // "provenance mismatch" - which reads as data corruption on call. The
  // protocol check must fire first and say what actually happened.
  const snap = { ...seededSnapshot({ scheduleHash: scheduleHashOf(WEEK1) }), protocol_version: 1 };
  const db = fakeDb(dbArgs({
    existingSnapshots: [snap],
    existingPlayers: COHORT.map((r) => ({ snapshot_id: 50, player_id: r.id })),
  }));

  await assert.rejects(
    holdout.snapshotWeek(captureArgs(db)),
    /captured under protocol 1, current is 2 - a pre-arms capture cannot be completed or re-captured/
  );
  assert.equal(seen.length, 0, 'no projection run for a poisoned week');
  assert.equal(db.committed.snapshots.length, 1, 'the legacy snapshot is untouched');
});

// ---------------------------------------------------------------------------
// Candidate arms (holdout-confirm-2026)
// ---------------------------------------------------------------------------

test('a capture writes the two candidate arms with exactly the preregistered constants', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const db = fakeDb(dbArgs());

  const out = await holdout.snapshotWeek(captureArgs(db));

  // Fixed arm order, scheduled first, and one compute run per arm.
  assert.deepEqual(
    seen.map((args) => args.modelConstants.simulation.smoothingBandwidth),
    [0, 0.2, 0.15]
  );
  assert.deepEqual(
    seen.map((args) => args.modelConstants.simulation.intervalScale),
    [1.45, 1, 1]
  );
  // The candidate constants differ from production in the two named leaves
  // and NOTHING else - restoring those two must reproduce production exactly.
  for (const args of seen.slice(1)) {
    const restored = JSON.parse(JSON.stringify(args.modelConstants));
    restored.simulation.smoothingBandwidth = model.MODEL_CONSTANTS.simulation.smoothingBandwidth;
    restored.simulation.intervalScale = model.MODEL_CONSTANTS.simulation.intervalScale;
    assert.deepEqual(restored, JSON.parse(JSON.stringify(model.MODEL_CONSTANTS)));
  }

  // Headers: kinds in order, each fingerprinting its own arm's constants.
  const kinds = db.committed.snapshots.map((snap) => snap.capture_kind);
  assert.deepEqual(kinds, ['scheduled', 'candidate:bw-20', 'candidate:bw-15']);
  for (const arm of holdout.captureArms()) {
    const header = db.committed.snapshots.find((snap) => snap.capture_kind === arm.kind);
    assert.equal(header.constants_hash, arm.hash, `${arm.kind} constants_hash`);
  }
  assert.equal(
    db.committed.snapshots.find((snap) => snap.capture_kind === 'scheduled').constants_hash,
    holdout.constantsHash(),
    'the scheduled arm fingerprints the production constants'
  );
  // All three arm ids come back to the caller; the scheduled id stays primary.
  assert.equal(out.snapshotId, out.armSnapshotIds.scheduled);
  assert.equal(Object.keys(out.armSnapshotIds).length, 3);
});

test('a candidate mean diverging from the scheduled arm aborts the WHOLE capture', async (t) => {
  withReleaseSha(t);
  // The kernels touch dispersion only, so a diverged mean proves the arms
  // did not share a feature snapshot - modeled here by a compute path that
  // leaks a different mean under candidate constants.
  t.mock.method(projectionSvc, 'generateProjections', async (args) => {
    const bump = args.modelConstants.simulation.smoothingBandwidth > 0 ? 0.01 : 0;
    return {
      projections: new Map(args.playerIds.map((id) => [id, {
        mean: id + 0.5 + bump, median: id + 0.25, p10: 1, p25: 2, p75: 8, p90: 9,
        activeProbability: 1, confidence: 'high', sampleSize: 4, factors: {},
      }])),
      inputCutoff: new Date('2077-09-09T11:00:00Z'),
      sourceCoverage: {},
    };
  });
  const db = fakeDb(dbArgs());

  await assert.rejects(
    holdout.snapshotWeek(captureArgs(db)),
    /mean diverged from the scheduled arm .* did not share a feature snapshot/
  );
  assert.equal(db.committed.snapshots.length, 0, 'no arm survives - all-or-nothing holds across arms');
  assert.equal(db.committed.players.length, 0);
  assert.ok(db.statements.some((stmt) => stmt.text === 'ROLLBACK'));
});

test('resolveCandidateConstants changes only existing leaves, and every arm hash is distinct', () => {
  const resolved = holdout.resolveCandidateConstants({ smoothingBandwidth: 0.2, intervalScale: 1.0 });
  assert.equal(resolved.simulation.smoothingBandwidth, 0.2);
  assert.equal(resolved.simulation.intervalScale, 1.0);
  const restored = JSON.parse(JSON.stringify(resolved));
  restored.simulation.smoothingBandwidth = model.MODEL_CONSTANTS.simulation.smoothingBandwidth;
  restored.simulation.intervalScale = model.MODEL_CONSTANTS.simulation.intervalScale;
  assert.deepEqual(restored, JSON.parse(JSON.stringify(model.MODEL_CONSTANTS)));

  // A typo'd override must throw, never append a new key: JSON key order is
  // the hash's identity, and an appended key would corrupt the provenance.
  assert.throws(
    () => holdout.resolveCandidateConstants({ smoothingBandwith: 0.2 }),
    /not an existing simulation constant/
  );

  const hashes = holdout.captureArms().map((arm) => arm.hash);
  assert.equal(new Set(hashes).size, 3, 'three arms, three distinct constants fingerprints');
  assert.ok(Object.isFrozen(holdout.CANDIDATE_ARMS));
  assert.ok(holdout.CANDIDATE_ARMS.every((arm) => Object.isFrozen(arm) && Object.isFrozen(arm.overrides)));
});

// ---------------------------------------------------------------------------
// The deadline
// ---------------------------------------------------------------------------

test('a capture that starts after kickoff fails closed before computing anything', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const db = fakeDb(dbArgs({ clock: () => new Date('2077-09-10T00:20:00Z') })); // exactly kickoff

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /capture window .* has closed/);
  assert.equal(seen.length, 0);
  assert.equal(db.committed.snapshots.length, 0);
});

test('a capture that slides past kickoff before writing is stopped by the header CHECK', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  // First clock read (window check) passes; the header INSERT's CHECK reads
  // a post-kickoff clock and rejects.
  let calls = 0;
  const clock = () => {
    calls += 1;
    return calls === 1 ? new Date('2077-09-10T00:19:59Z') : new Date('2077-09-10T00:20:01Z');
  };
  const db = fakeDb(dbArgs({ clock }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /check constraint/);
  assert.equal(db.committed.snapshots.length, 0, 'nothing committed');
  assert.equal(db.committed.players.length, 0);
  assert.ok(db.statements.some((s) => s.text === 'ROLLBACK'));
});

test('a capture that slides past kickoff AFTER the writes is rolled back by the pre-commit recheck', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  // The window check, the header CHECK, and the child trigger all see a
  // pre-kickoff clock; ONLY the final pre-commit read is late. This is the
  // one moment where the service-layer recheck is the last line of defense,
  // so this test fails if that recheck is removed.
  // Clock reads with three arms: 1 = window, then per arm one header CHECK
  // and three child-trigger reads (3 players) = 4 x 3 arms = reads 2-13,
  // and read 14 = the pre-commit recheck - the only late one.
  let calls = 0;
  const clock = () => {
    calls += 1;
    return calls <= 13 ? new Date('2077-09-10T00:19:59Z') : new Date('2077-09-10T00:20:01Z');
  };
  const db = fakeDb(dbArgs({ clock }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /missed its deadline during computation/);
  assert.equal(db.committed.snapshots.length, 0, 'the header did not survive the rollback');
  assert.equal(db.committed.players.length, 0, 'the children did not survive the rollback');
  assert.ok(db.statements.some((s) => s.text === 'ROLLBACK'));
});

// ---------------------------------------------------------------------------
// Schedule validation (pure)
// ---------------------------------------------------------------------------

const VALID_ARGS = {
  rows: WEEK1, seasonMatrix: MATRIX, manifestGames: MANIFEST_WEEK1,
  season: FIXTURE_SEASON, week: 1,
};

test('validateSchedule rejects per-game structural problems', () => {
  const out = holdout.validateSchedule(VALID_ARGS);
  assert.equal(out.scheduleGames, 16);
  assert.equal(out.firstKickoffAt.toISOString(), new Date(KICKOFF).toISOString());

  const g0 = WEEK1.filter((r) => r.game_key === WEEK1[0].game_key);
  const rest = WEEK1.filter((r) => r.game_key !== WEEK1[0].game_key);
  assert.throws(() => holdout.validateSchedule({ ...VALID_ARGS, rows: [...rest, g0[0]] }),
    /missing manifest game .* \(one side present\)/, 'a lone half of a game');
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS,
    rows: [...rest, g0[0], { ...g0[1], opponent: rest[0].nfl_team }],
  }), /do not match the manifest pairing/, 'broken reciprocity');
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS,
    rows: [...rest, g0[0], { ...g0[1], home_away: 'home' }],
  }), /marked home, manifest says away/, 'orientation contradicting the manifest');
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS,
    rows: [...rest, g0[0], { ...g0[1], kickoff_at: '2077-09-11T01:00:00Z' }],
  }), /disagree on kickoff/, 'kickoff mismatch within one game');
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS,
    rows: [...rest, g0[0], { ...g0[1], game_key: 'different-key' }],
  }), /disagree on game key/, 'inconsistent game keys when present');
  // Absent orientation/keys are tolerated (the 2026 sync stores neither;
  // the manifest is the orientation authority) - but absent kickoffs never.
  const bare = WEEK1.map((r) => ({ ...r, home_away: null, game_key: null }));
  assert.equal(holdout.validateSchedule({ ...VALID_ARGS, rows: bare }).scheduleGames, 16);
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS,
    rows: WEEK1.map((r, i) => (i === 0 ? { ...r, kickoff_at: null } : r)),
  }), /without kickoff/, 'null kickoff');
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS,
    rows: [...rest, g0[0], { ...g0[0] }],
  }), /twice/, 'duplicate team');
});

test('the manifest catches what counts cannot: moved games and opponent swaps', () => {
  // The reviewer's full-size counterexample: the earliest week-1 game moved
  // into both teams' shared week-5 bye. Every canonical count survives -
  // appearances stay 17, byes stay even - and firstKickoffAt slides later.
  // Only identity equality against the manifest sees it.
  const g0 = WEEK1.filter((r) => r.game_key === WEEK1[0].game_key);
  const movedTeams = g0.map((r) => r.nfl_team);
  const week5Kick = SEASON.rowsByWeek.get(5)[0].kickoff_at;
  const movedRows = WEEK1.filter((r) => !movedTeams.includes(r.nfl_team));
  const movedMatrix = MATRIX.map((r) => (
    movedTeams.includes(r.team_key)
      ? { ...r, weeks: r.weeks.filter((w) => w !== 1).concat(5).sort((a, b) => a - b) }
      : r
  ));
  // Sanity: the moved teams really do share the week-5 bye, so counts hold.
  assert.ok(movedTeams.every((t) => SEASON.byeByWeek.get(5).includes(t)),
    'fixture must reproduce the shared-bye move exactly');
  assert.throws(() => holdout.validateSchedule({
    rows: movedRows, seasonMatrix: movedMatrix, manifestGames: MANIFEST_WEEK1,
    season: FIXTURE_SEASON, week: 1,
  }), /missing manifest game/, 'a moved game is a missing manifest game, whatever the counts say');
  assert.ok(week5Kick, 'week 5 exists to move into');

  // Reciprocal opponent swap: (A,B),(C,D) -> (A,C),(B,D). Shapes, counts and
  // closure all pass; the manifest pairing does not.
  const otherKey = WEEK1.find((r) => r.game_key !== WEEK1[0].game_key).game_key;
  const g1 = WEEK1.filter((r) => r.game_key === otherKey);
  const [a, b] = g0;
  const [c, d] = g1;
  const swapped = WEEK1
    .filter((r) => ![a.nfl_team, b.nfl_team, c.nfl_team, d.nfl_team].includes(r.nfl_team))
    .concat([
      { ...a, opponent: c.nfl_team }, { ...c, opponent: a.nfl_team, home_away: 'away', kickoff_at: a.kickoff_at, game_key: a.game_key },
      { ...b, opponent: d.nfl_team, home_away: 'home', kickoff_at: d.kickoff_at, game_key: d.game_key }, { ...d, opponent: b.nfl_team, home_away: 'away' },
    ]);
  assert.throws(() => holdout.validateSchedule({
    rows: swapped, seasonMatrix: MATRIX, manifestGames: MANIFEST_WEEK1,
    season: FIXTURE_SEASON, week: 1,
  }), /do not match the manifest pairing/, 'reciprocal opponent swaps are identity mismatches');
});

test('the expected domain is independent: missing teams, weeks, and masked byes all fail', () => {
  // Two franchises vanish from the season matrix entirely: the canonical
  // domain does not shrink to fit, whatever the target week's rows show.
  const dropped = WEEK1.filter((r) => r.game_key === WEEK1[0].game_key).map((r) => r.nfl_team);
  const matrixWithoutTeams = MATRIX.filter((r) => !dropped.includes(r.team_key));
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS, seasonMatrix: matrixWithoutTeams,
  }), /missing team\(s\) entirely/, '30 observed teams is not the NFL');

  // Masked bye: the teams exist in the season but one of their games was
  // never synced — 16 appearances instead of 17.
  const matrixMaskedBye = MATRIX.map((r) => (
    dropped.includes(r.team_key) ? { ...r, weeks: r.weeks.filter((w) => w !== 2) } : r
  ));
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS, seasonMatrix: matrixMaskedBye,
  }), /appears in 16 week\(s\), expected exactly 17/, 'a missing game is not a second bye');

  // Missing whole week: every team still shows 17 appearances (they "play"
  // their bye week instead), but week 3 exists for nobody — only the
  // week-universe check can see that.
  const byeOf = new Map();
  for (const [w, teams] of SEASON.byeByWeek) for (const t of teams) byeOf.set(t, w);
  const matrixNoWeek3 = MATRIX.map((r) => ({
    ...r,
    weeks: r.weeks.filter((w) => w !== 3).concat(byeOf.get(r.team_key)).sort((a, b) => a - b),
  }));
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS, seasonMatrix: matrixNoWeek3,
  }), /missing week 3 entirely/, 'a week nobody plays was never synced');

  // Unknown franchise fails as loudly as a missing one.
  const matrixUnknown = [...MATRIX, { team_key: 'XYZ', weeks: MATRIX[0].weeks }];
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS, seasonMatrix: matrixUnknown,
  }), /unknown team\(s\): XYZ/);

  // Odd bye distribution anywhere in the season fails: move one team's bye
  // from week 6 into week 5 (appearances stay 17).
  const week6Team = SEASON.byeByWeek.get(6)[0];
  const matrixOddBye = MATRIX.map((r) => (
    r.team_key === week6Team
      ? { ...r, weeks: r.weeks.filter((w) => w !== 5).concat(6).sort((a, b) => a - b) }
      : r
  ));
  assert.throws(() => holdout.validateSchedule({
    ...VALID_ARGS, seasonMatrix: matrixOddBye,
  }), /bye accounting: 5 bye team\(s\)/, 'byes come in even groups');

  // And a legitimate four-bye week validates cleanly against the same season.
  const out = holdout.validateSchedule({
    rows: SEASON.rowsByWeek.get(5), seasonMatrix: MATRIX,
    manifestGames: SEASON.manifest.games.filter((g) => g.week === 5),
    season: FIXTURE_SEASON, week: 5,
  });
  assert.equal(out.scheduleGames, 14, '28 of 32 playing, 4 on bye');
});

test('capture of an entirely absent week fails closed', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const db = fakeDb(dbArgs({ schedule: [] })); // the sync lost the whole week
  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /no schedule rows/);
  assert.equal(db.committed.snapshots.length, 0);
});

test('capture of a season with no manifest refuses before touching the database', async (t) => {
  withReleaseSha(t);
  const db = fakeDb(dbArgs());
  await assert.rejects(
    holdout.snapshotWeek({ ...captureArgs(db), season: 2078 }),
    /no schedule manifest for season 2078/
  );
  assert.equal(db.conns.length, 0);
});

// ---------------------------------------------------------------------------
// Provenance requirements
// ---------------------------------------------------------------------------

test('capture refuses to run without a release SHA', async (t) => {
  // Destructured because eslint's testing-library plugin misreads a plain
  // assignment from anything render-shaped as a component render.
  const { RENDER_GIT_COMMIT: prevSha, APP_RELEASE: prevApp } = process.env;
  delete process.env.RENDER_GIT_COMMIT;
  delete process.env.APP_RELEASE;
  t.after(() => {
    if (prevSha !== undefined) process.env.RENDER_GIT_COMMIT = prevSha;
    if (prevApp !== undefined) process.env.APP_RELEASE = prevApp;
  });
  const db = fakeDb(dbArgs());
  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /requires a release SHA/);
  assert.equal(db.conns.length, 0, 'it refuses before touching the database');
});

// ---------------------------------------------------------------------------
// Cache independence
// ---------------------------------------------------------------------------

test('the capture pipeline never touches the projection cache tables', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const db = fakeDb(dbArgs());

  await holdout.snapshotWeek(captureArgs(db));

  assert.equal(seen.length, 3, 'projections come from the COMPUTE path, once per arm');
  assert.ok(seen.every((args) => args.client === db.conns[0]),
    'every arm through the SAME transaction connection — one consistent snapshot');
  for (const s of db.statements) {
    assert.ok(
      !s.text.includes('projection_runs') && !s.text.includes('player_week_projections'),
      `cache table touched by: ${s.text.slice(0, 80)}`
    );
  }
});

test('a full correction pass emits no SQL that references the ledger tables', async (t) => {
  const poolModule = require('../modules/pool');
  const scoringSvc = require('../services/scoring.service');
  const nflverse = require('../services/nflverseSync.service');
  const correctionSvc = require('../services/correction.service');
  t.mock.method(console, 'error', () => {});

  const recorded = [];
  t.mock.method(poolModule, 'query', async (sql) => {
    recorded.push(String(sql));
    if (String(sql).includes('FROM "leagues"')) {
      return { rows: [{ id: 42, current_season: FIXTURE_SEASON, current_week: 4 }] };
    }
    return { rows: [], rowCount: 0 };
  });
  t.mock.method(nflverse, 'correctWeekFromNflverse', async () => ({ playersUpdated: 1 }));
  t.mock.method(scoringSvc, 'syncWeekStats', async () => ({ plays: [] }));

  await correctionSvc.resyncPriorWeeks();

  assert.ok(recorded.length > 0, 'the pass actually ran SQL');
  for (const sql of recorded) {
    assert.ok(!sql.includes('projection_snapshot'), `correction pass touched the ledger: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`);
    assert.ok(!sql.includes('holdout_capture_status'), 'corrections do not write holdout status either');
  }
});

// ---------------------------------------------------------------------------
// Scheduled capture + durable status
// ---------------------------------------------------------------------------

test('captureDueSnapshots captures every predeclared profile and persists each outcome', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const db = fakeDb(dbArgs({ due: [{ season: FIXTURE_SEASON, week: 1, first_kickoff: KICKOFF }] }));

  const out = await holdout.captureDueSnapshots({ now: new Date('2077-09-09T12:00:00Z'), client: db });

  assert.equal(out.failures.length, 0);
  assert.deepEqual(out.captured.map((c) => c.profileName).sort(), ['half_ppr', 'ppr', 'standard']);
  assert.equal(db.committed.snapshots.length, 9, 'three arms per profile');
  assert.equal(new Set(db.committed.snapshots.map((s) => s.scoring_hash)).size, 3);
  assert.equal(db.committed.status.length, 3, 'every attempt outcome is DURABLE, not in-memory');
  assert.ok(db.committed.status.every((r) => r.status === 'captured' && r.attempts === 1));
});

test('one profile failing is recorded durably and does not block the others; retries bump attempts', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const halfPprHash = model.scoringHash(SCORING_PRESETS.half_ppr);
  let arm = true;
  const db = fakeDb(dbArgs({
    due: [{ season: FIXTURE_SEASON, week: 1, first_kickoff: KICKOFF }],
    failOn: (text, params) => arm
      && text.includes('INSERT INTO "projection_snapshots"')
      && params[3] === halfPprHash,
  }));

  const first = await holdout.captureDueSnapshots({ now: new Date('2077-09-09T12:00:00Z'), client: db });
  assert.equal(first.captured.length, 2);
  assert.deepEqual(first.failures.map((f) => f.profileName), ['half_ppr']);
  const failedRow = db.committed.status.find((r) => r.scoring_profile === 'half_ppr');
  assert.equal(failedRow.status, 'failed');
  assert.equal(failedRow.attempts, 1);

  arm = false;
  const second = await holdout.captureDueSnapshots({ now: new Date('2077-09-09T12:00:00Z'), client: db });
  assert.equal(second.failures.length, 0);
  assert.equal(failedRow.status, 'captured', 'the durable row heals when the retry succeeds');
  assert.equal(failedRow.attempts, 2, 'and counts its attempts');
  const skips = db.committed.status.filter((r) => r.scoring_profile !== 'half_ppr');
  assert.ok(skips.every((r) => r.status === 'skipped' && r.attempts === 2), 'complete profiles record skips');
});

test('outside the capture window there is nothing to do and nothing is computed', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const db = fakeDb(dbArgs({ due: [] }));
  const out = await holdout.captureDueSnapshots({ now: new Date('2026-06-01T00:00:00Z'), client: db });
  assert.deepEqual(out, { captured: [], failures: [] });
  assert.equal(seen.length, 0);
});

// ---------------------------------------------------------------------------
// Obligation reconciliation: missed captures are visible, not silent
// ---------------------------------------------------------------------------

/**
 * Scope the registry to the synthetic season alone for a reconciliation
 * test: with the real 2026 manifest also registered, obligation counts
 * would mix seasons.
 */
function withOnlyFixtureManifest(t) {
  const saved = [...holdout.SEASON_MANIFESTS.entries()];
  holdout.SEASON_MANIFESTS.clear();
  holdout.SEASON_MANIFESTS.set(FIXTURE_SEASON, SEASON.manifest);
  t.after(() => {
    holdout.SEASON_MANIFESTS.clear();
    for (const [k, v] of saved) holdout.SEASON_MANIFESTS.set(k, v);
  });
}

/** All season rows as the runtime `nfl_games` would return them. */
function dbRowsForSeason(season = FIXTURE_SEASON, mutate = (rows) => rows, fixture = SEASON) {
  const rows = [];
  for (const [week, weekRows] of fixture.rowsByWeek) {
    for (const r of weekRows) {
      rows.push({ season, week, nfl_team: r.nfl_team, opponent: r.opponent, kickoff_at: r.kickoff_at });
    }
  }
  return mutate(rows);
}

/**
 * A minimal fake for the reconciliation reads: obligations derive from the
 * MANIFEST, so nothing has to have RUN for a debt to show. Records which
 * relations were probed, and can make any of them unreadable.
 */
/**
 * Every snapshot row a COMPLETE protocol-2 capture writes for one
 * season-week-profile: the scheduled arm plus each sealed candidate arm, at the
 * current protocol version. Built from `CANDIDATE_ARMS` rather than restated, so
 * adding or removing an arm cannot leave this fixture silently stale.
 */
function completeCapture(season, week, scoring_profile) {
  return ['scheduled', ...holdout.CANDIDATE_ARMS.map((a) => a.kind)].map((capture_kind) => ({
    season, week, scoring_profile, capture_kind, protocol_version: holdout.HOLDOUT_PROTOCOL_VERSION,
  }));
}

function reconcileFake({ scheduleRows = [], snapshots = [], statuses = [], failSnapshots = false, failStatus = false }) {
  const probed = [];
  return {
    probed,
    lastSnapshotSql: null,
    lastScheduleSql: null,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ');
      if (text.includes('FROM "projection_snapshots"')) {
        probed.push('snapshots');
        this.lastSnapshotSql = text;
        if (failSnapshots) throw new Error('relation "projection_snapshots" does not exist');
        return { rows: snapshots };
      }
      if (text.includes('FROM "holdout_capture_status"')) {
        probed.push('status');
        if (failStatus) throw new Error('relation "holdout_capture_status" does not exist');
        return { rows: statuses };
      }
      if (text.includes('FROM "nfl_games"')) {
        probed.push('schedule');
        this.lastScheduleSql = text;
        return { rows: scheduleRows };
      }
      throw new Error(`unexpected reconciliation query: ${text.slice(0, 60)}`);
    },
  };
}

test('all 18x3 obligations derive from the manifest, and a never-started capture reconciles as MISSED', async (t) => {
  withOnlyFixtureManifest(t);
  const now = new Date('2077-09-12T00:00:00Z'); // after week 1, before week 2
  const client = reconcileFake({
    scheduleRows: dbRowsForSeason(),
    snapshots: [], // the worker was down: no snapshot...
    statuses: [], // ...and no status row either - the silent case
  });

  const out = await holdout.reconcileObligations({ now, client });
  assert.equal(out.obligations.length, 18 * 3, 'the manifest owes every week, run or not');
  const week1 = out.obligations.filter((o) => o.week === 1);
  assert.equal(week1.length, 3);
  assert.ok(week1.every((o) => o.state === 'missed'), 'silence is not health');
  assert.ok(out.obligations.filter((o) => o.week > 2).every((o) => o.state === 'scheduled'));
  assert.equal(out.ok, false);
});

test('reconciliation distinguishes captured, failed, and pending states - and never republishes stored failure text', async (t) => {
  withOnlyFixtureManifest(t);
  const now = new Date('2077-09-09T12:00:00Z'); // window open, pre-deadline
  const client = reconcileFake({
    scheduleRows: dbRowsForSeason(),
    // Satisfaction is by the STORED profile name, never today's scoring hash -
    // and, under protocol 2, only a COMPLETE capture satisfies: the scheduled
    // arm plus every candidate arm, all at the current protocol version.
    snapshots: completeCapture(FIXTURE_SEASON, 1, 'half_ppr'),
    statuses: [
      { season: FIXTURE_SEASON, week: 1, scoring_profile: 'ppr', status: 'failed', message: 'connect failed at 10.0.0.7:5432', attempts: 2 },
    ],
  });

  const out = await holdout.reconcileObligations({ now, client });
  const week1 = new Map(out.obligations.filter((o) => o.week === 1).map((o) => [o.profile, o]));
  assert.equal(week1.get('half_ppr').state, 'captured', 'the immutable snapshot is the truth');
  assert.equal(week1.get('ppr').state, 'failed');
  assert.equal(week1.get('ppr').message, undefined,
    'durable failure text can embed raw database errors - it is not public vocabulary');
  assert.ok(!JSON.stringify(out).includes('10.0.0.7'), 'no stored error detail escapes the result');
  assert.equal(week1.get('ppr').attempts, 2);
  assert.equal(week1.get('standard').state, 'pending', 'window open, deadline not yet passed');
  assert.equal(out.ok, false, 'a failed obligation is alertable');
});

test('a protocol-1 capture does NOT satisfy a protocol-2 obligation', async (t) => {
  withOnlyFixtureManifest(t);
  // The exact shape production writes when the worker was never redeployed:
  // a scheduled arm, complete and on time, under the OLD protocol. It can never
  // be re-captured, so reporting it as satisfied would hide a permanent loss.
  const client = reconcileFake({
    scheduleRows: dbRowsForSeason(),
    snapshots: [{
      season: FIXTURE_SEASON, week: 1, scoring_profile: 'half_ppr',
      capture_kind: 'scheduled', protocol_version: 1,
    }],
  });
  const out = await holdout.reconcileObligations({ now: new Date('2077-09-09T12:00:00Z'), client });
  const week1 = out.obligations.find((o) => o.week === 1 && o.profile === 'half_ppr');
  assert.notEqual(week1.state, 'captured', 'a protocol-1 week carries no candidate arms and cannot serve the study');
  // It must ALERT, not merely fail to count. An earlier revision of this check
  // left such a week at `pending`, which is `ok` - reporting HTTP 200 for the
  // entire window in which a redeploy could still have saved the season, and
  // turning `missed` only once nothing could be done.
  assert.equal(week1.state, 'protocol-conflict', 'a lost week must alert while action is still possible');
  assert.deepEqual(week1.foreignProtocols, [1], 'the observed protocol version is named');
  assert.equal(out.ok, false, 'a permanently lost week is never ok');
});

test('a partial capture reports incomplete-arms and names what is missing', async (t) => {
  withOnlyFixtureManifest(t);
  // The scheduled arm landed and the candidate arms did not: what an aborting
  // capture transaction leaves behind. Inside an open window this must NOT read
  // as `pending`, which would say "not fired yet" about a capture that fired
  // and failed.
  const client = reconcileFake({
    scheduleRows: dbRowsForSeason(),
    snapshots: completeCapture(FIXTURE_SEASON, 1, 'half_ppr')
      .filter((r) => r.capture_kind === 'scheduled'),
  });
  const out = await holdout.reconcileObligations({ now: new Date('2077-09-09T12:00:00Z'), client });
  const week1 = out.obligations.find((o) => o.week === 1 && o.profile === 'half_ppr');
  assert.equal(week1.state, 'incomplete-arms');
  assert.deepEqual(week1.missingArms, holdout.CANDIDATE_ARMS.map((a) => a.kind));
  assert.equal(out.ok, false, 'an incomplete capture is alertable, not ok');
});

test('a supplemental row on a future week does not turn it red', async (t) => {
  withOnlyFixtureManifest(t);
  // `supplemental` is a sanctioned capture kind (this module's docblock and the
  // ledger migration's own `scheduled | supplemental`). Counting any row at all
  // as partial progress would report `incomplete-arms` - and take the health
  // route to 503 - on a week whose deadline is months away and whose scheduled
  // capture has not been attempted yet.
  const client = reconcileFake({
    scheduleRows: dbRowsForSeason(),
    snapshots: [{
      season: FIXTURE_SEASON, week: 12, scoring_profile: 'ppr',
      capture_kind: 'supplemental', protocol_version: holdout.HOLDOUT_PROTOCOL_VERSION,
    }],
  });
  const out = await holdout.reconcileObligations({ now: new Date('2077-08-13T00:00:00Z'), client });
  const wk12 = out.obligations.find((o) => o.week === 12 && o.profile === 'ppr');
  assert.notEqual(wk12.state, 'incomplete-arms', 'a supplemental row is not partial progress');
  assert.equal(wk12.state, 'scheduled', 'the window has not opened yet');
  assert.equal(out.ok, true, 'a healthy future season stays ok');

  // An unplanned kind - a future arm rename, say - behaves the same way.
  const client2 = reconcileFake({
    scheduleRows: dbRowsForSeason(),
    snapshots: [{
      season: FIXTURE_SEASON, week: 12, scoring_profile: 'ppr',
      capture_kind: 'candidate:bw-25', protocol_version: holdout.HOLDOUT_PROTOCOL_VERSION,
    }],
  });
  const out2 = await holdout.reconcileObligations({ now: new Date('2077-08-13T00:00:00Z'), client: client2 });
  assert.equal(out2.obligations.find((o) => o.week === 12 && o.profile === 'ppr').state, 'scheduled');
  assert.equal(out2.ok, true);
});

test('a complete capture is ok and names no missing arms', async (t) => {
  withOnlyFixtureManifest(t);
  const snapshots = [];
  for (let week = 1; week <= holdout.SEASON_WEEKS; week++) {
    for (const profile of holdout.HOLDOUT_SCORING_PROFILES) {
      snapshots.push(...completeCapture(FIXTURE_SEASON, week, profile.name));
    }
  }
  const client = reconcileFake({ scheduleRows: dbRowsForSeason(), snapshots });
  const out = await holdout.reconcileObligations({ now: new Date('2077-09-09T12:00:00Z'), client });
  assert.ok(out.obligations.every((o) => o.state === 'captured'), 'every arm present at the current protocol');
  assert.ok(out.obligations.every((o) => o.missingArms === undefined));
  assert.equal(out.ok, true);
});

test('a game moved between weeks and an entirely absent week both surface as schedule-invalid', async (t) => {
  withOnlyFixtureManifest(t);
  const movedTeams = WEEK1.filter((r) => r.game_key === WEEK1[0].game_key).map((r) => r.nfl_team);
  const movedRows = dbRowsForSeason(FIXTURE_SEASON, (rows) => rows
    // The moved game: its two week-1 rows reappear as week-5 rows...
    .map((r) => (r.week === 1 && movedTeams.includes(r.nfl_team) ? { ...r, week: 5 } : r))
    // ...and week 3 is lost entirely - the sync never wrote it.
    .filter((r) => r.week !== 3 || movedTeams.includes('__never__')));
  const client = reconcileFake({ scheduleRows: movedRows.filter((r) => r.week !== 3) });

  const out = await holdout.reconcileObligations({ now: new Date('2077-09-01T00:00:00Z'), client });
  const stateOf = (week) => out.obligations.filter((o) => o.week === week).map((o) => o.state);
  assert.ok(stateOf(1).every((s) => s === 'schedule-invalid'), 'the moved game breaks week 1');
  assert.ok(stateOf(5).every((s) => s === 'schedule-invalid'), 'and pollutes week 5');
  assert.ok(stateOf(3).every((s) => s === 'schedule-invalid'), 'the absent week is a debt, not a blind spot');
  const week1 = out.obligations.find((o) => o.week === 1);
  assert.ok(week1.scheduleIssues.some((i) => /missing manifest game/.test(i)), 'week 1 reports the missing manifest game');
  const week5 = out.obligations.find((o) => o.week === 5);
  assert.ok(week5.scheduleIssues.some((i) => /manifest does not/.test(i)), 'week 5 reports the intruding game');
  assert.equal(out.ok, false);
});

test('probes run before any verdict, and an unreadable relation fails reconciliation', async (t) => {
  withOnlyFixtureManifest(t);
  const healthy = reconcileFake({ scheduleRows: dbRowsForSeason() });
  await holdout.reconcileObligations({ now: new Date('2077-06-01T00:00:00Z'), client: healthy });
  assert.ok(healthy.probed.indexOf('snapshots') === 0, 'the ledger is probed FIRST');
  assert.ok(healthy.probed.includes('status'));

  const badLedger = reconcileFake({ scheduleRows: dbRowsForSeason(), failSnapshots: true });
  await assert.rejects(
    holdout.reconcileObligations({ now: new Date('2077-06-01T00:00:00Z'), client: badLedger }),
    /does not exist/,
    '"I cannot read the ledger" must never resolve as healthy'
  );
  const badStatus = reconcileFake({ scheduleRows: dbRowsForSeason(), failStatus: true });
  await assert.rejects(
    holdout.reconcileObligations({ now: new Date('2077-06-01T00:00:00Z'), client: badStatus }),
    /does not exist/
  );
});

test('missed obligations are retained for the whole season, and queries are week-bounded and version-agnostic', async (t) => {
  withOnlyFixtureManifest(t);
  const client = reconcileFake({ scheduleRows: dbRowsForSeason() });
  // Months after a September miss, the debt is still on the books.
  const out = await holdout.reconcileObligations({ now: new Date('2078-01-30T00:00:00Z'), client });
  assert.ok(out.obligations.filter((o) => o.week === 1).every((o) => o.state === 'missed'));
  assert.equal(out.ok, false);
  // Captured-ness lives in the SQL: non-late, child-complete, NONEMPTY, by
  // the STORED scoring profile, and with NO model version filter - versioned
  // activation means the snapshot captured under the version active before
  // the deadline satisfies the obligation forever, and a preset whose rules
  // change later cannot orphan history because today's hash is never used.
  assert.match(client.lastSnapshotSql, /"is_late" = false/);
  assert.match(client.lastSnapshotSql, /"cohort_size" > 0/, 'an empty cohort satisfies nothing');
  assert.match(client.lastSnapshotSql, /"cohort_size" = \( SELECT COUNT\(\*\) FROM "projection_snapshot_players"/);
  assert.match(client.lastSnapshotSql, /"scoring_profile"/, 'satisfaction is by stored profile name');
  assert.ok(!client.lastSnapshotSql.includes('scoring_hash'), 'today\'s scoring hash never judges history');
  assert.ok(!client.lastSnapshotSql.includes('model_version'), 'no model-version filter on satisfaction');
  assert.match(client.lastScheduleSql, /BETWEEN 1 AND 18/, 'schedule reads are bounded to the regular season');
});

// ---------------------------------------------------------------------------
// The deadline is independent: timestamp-shift attacks
// ---------------------------------------------------------------------------

const DAY = 24 * 3600 * 1000;
const BASE = new Date(KICKOFF).getTime();
const shiftRows = (rows, ms, match = () => true) => rows.map((r) => (
  match(r)
    ? { ...r, kickoff_at: new Date(new Date(r.kickoff_at).getTime() + ms).toISOString() }
    : r
));

test('shifting both rows of the earliest game later cannot extend the capture window', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  // The reviewer's reproduction: the earliest game's two rows agree with
  // each other, one day late. Every structural check passes; only an
  // independent deadline can refuse the capture that follows.
  const g0Key = WEEK1[0].game_key;
  const shifted = shiftRows(WEEK1, DAY, (r) => r.game_key === g0Key);
  const db = fakeDb(dbArgs({
    schedule: shifted,
    clock: () => new Date(BASE + 5 * 60 * 1000), // after the manifest deadline, before every stored kickoff
  }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /capture window .* has closed/);
  assert.equal(seen.length, 0, 'nothing was computed, let alone written');
  assert.equal(db.committed.snapshots.length, 0);

  // A capture BEFORE the deadline against the same shifted rows succeeds -
  // and its header records the MANIFEST deadline as `capture_not_after`, not
  // the later observed kickoff, so the database CHECK and the child trigger
  // hold the independent line too.
  const okDb = fakeDb(dbArgs({ schedule: shifted, clock: () => new Date(BASE - 3600 * 1000) }));
  const out = await holdout.snapshotWeek(captureArgs(okDb));
  assert.equal(out.inserted, 3);
  assert.equal(
    new Date(okDb.committed.snapshots[0].capture_not_after).toISOString(),
    new Date(BASE).toISOString(),
    'the stored deadline is the tighter manifest instant, never the drifted kickoff'
  );
});

test('shifting EVERY stored kickoff later cannot extend the capture window either', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const db = fakeDb(dbArgs({
    schedule: shiftRows(WEEK1, DAY),
    clock: () => new Date(BASE + 3600 * 1000),
  }));

  await assert.rejects(holdout.snapshotWeek(captureArgs(db)), /capture window .* has closed/);
  assert.equal(seen.length, 0);
  assert.equal(db.committed.snapshots.length, 0);
});

test('an observed kickoff EARLIER than the manifest deadline tightens the cutoff', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  const earlier = shiftRows(WEEK1, -2 * 3600 * 1000);
  // Between the observed first kickoff and the manifest deadline: too late.
  const lateDb = fakeDb(dbArgs({ schedule: earlier, clock: () => new Date(BASE - 3600 * 1000) }));
  await assert.rejects(holdout.snapshotWeek(captureArgs(lateDb)), /capture window .* has closed/);
  assert.equal(lateDb.committed.snapshots.length, 0);

  // Before both: the tightened window is still usable, and the header
  // records the OBSERVED kickoff as its deadline - the tighter of the two.
  const okDb = fakeDb(dbArgs({ schedule: earlier, clock: () => new Date(BASE - 3 * 3600 * 1000) }));
  const out = await holdout.snapshotWeek(captureArgs(okDb));
  assert.equal(out.inserted, 3);
  assert.equal(
    new Date(okDb.committed.snapshots[0].capture_not_after).toISOString(),
    new Date(BASE - 2 * 3600 * 1000).toISOString()
  );
});

test('reconciliation judges missed against the manifest deadline, not stored kickoffs', async (t) => {
  withOnlyFixtureManifest(t);
  const g0Key = WEEK1[0].game_key;
  const pairShifted = dbRowsForSeason(FIXTURE_SEASON, (rows) => rows.map((r) => (
    r.week === 1 && WEEK1.some((w) => w.game_key === g0Key && w.nfl_team === r.nfl_team)
      ? { ...r, kickoff_at: new Date(new Date(r.kickoff_at).getTime() + DAY).toISOString() }
      : r
  )));
  // Five minutes past the manifest deadline: the stored rows still claim the
  // week has not kicked off. Nothing was captured, so the obligation is
  // MISSED - a schedule that drifted later cannot hold health open.
  const outPair = await holdout.reconcileObligations({
    now: new Date(BASE + 5 * 60 * 1000),
    client: reconcileFake({ scheduleRows: pairShifted }),
  });
  assert.ok(
    outPair.obligations.filter((o) => o.week === 1).every((o) => o.state === 'missed'),
    'both rows agreeing on a later kickoff is still a passed deadline'
  );
  assert.equal(outPair.ok, false);

  // The whole-schedule variant: every row a day late, same verdict.
  const allShifted = dbRowsForSeason(FIXTURE_SEASON, (rows) => rows.map((r) => (
    r.week === 1
      ? { ...r, kickoff_at: new Date(new Date(r.kickoff_at).getTime() + DAY).toISOString() }
      : r
  )));
  const outAll = await holdout.reconcileObligations({
    now: new Date(BASE + 3600 * 1000),
    client: reconcileFake({ scheduleRows: allShifted }),
  });
  assert.ok(outAll.obligations.filter((o) => o.week === 1).every((o) => o.state === 'missed'));
  assert.equal(outAll.ok, false);
});

test('reconciliation runs capture-equivalent validation: mismatched paired kickoffs are not green', async (t) => {
  withOnlyFixtureManifest(t);
  // One row of one game an hour late: the capture path would refuse this
  // schedule, so health must not certify it. The old pair-count diff saw
  // nothing wrong here.
  const g0 = WEEK1.filter((r) => r.game_key === WEEK1[0].game_key);
  const oneSide = dbRowsForSeason(FIXTURE_SEASON, (rows) => rows.map((r) => (
    r.week === 1 && r.nfl_team === g0[1].nfl_team
      ? { ...r, kickoff_at: new Date(new Date(r.kickoff_at).getTime() + 3600 * 1000).toISOString() }
      : r
  )));

  const out = await holdout.reconcileObligations({
    now: new Date('2077-09-01T00:00:00Z'),
    client: reconcileFake({ scheduleRows: oneSide }),
  });
  const week1 = out.obligations.filter((o) => o.week === 1);
  assert.ok(week1.every((o) => o.state === 'schedule-invalid'));
  assert.ok(week1[0].scheduleIssues.some((i) => /disagree on kickoff/.test(i)));
  assert.equal(out.ok, false);
});

test('a manifest that cannot prove itself is refused at registration', () => {
  const clone = (mutate) => {
    const m = JSON.parse(JSON.stringify(SEASON.manifest));
    m.season = 2099;
    m.games = m.games.map((g) => ({ ...g }));
    mutate(m);
    return m;
  };

  // Correct shape, wrong digest: tampered or hand-edited.
  const tampered = clone((m) => { m.digest = 'f'.repeat(64); });
  assert.throws(() => holdout.registerSeasonManifest(tampered), /digest check/);

  // A week with no deadline has no trustworthy cutoff at all.
  const noDeadline = clone((m) => {
    delete m.captureNotAfter['7'];
    m.digest = computeManifestDigest(m);
  });
  assert.throws(() => holdout.registerSeasonManifest(noDeadline),
    /no valid captureNotAfter deadline for week 7/);

  // A week with no games cannot anchor obligations.
  const noWeek = clone((m) => {
    m.games = m.games.filter((g) => g.week !== 3);
    m.digest = computeManifestDigest(m);
  });
  assert.throws(() => holdout.registerSeasonManifest(noWeek), /no games in week 3/);

  // The digest binds PROVENANCE, not just games: recompute an honest digest
  // first, THEN edit the source claim - the edit must be tamper-evident.
  const sourceSwap = clone((m) => {
    m.digest = computeManifestDigest(m);
    m.source = 'a different origin story';
  });
  assert.throws(() => holdout.registerSeasonManifest(sourceSwap), /digest check/);

  // Full-season invariants hold at registration even with a FRESH digest -
  // a malformed schedule that hashes honestly is still not an authority.
  const missingGame = clone((m) => {
    m.games = m.games.slice(1);
    m.digest = computeManifestDigest(m);
  });
  assert.throws(() => holdout.registerSeasonManifest(missingGame), /expected exactly 272/);

  const unknownTeam = clone((m) => {
    m.games[0].home = 'XYZ';
    m.digest = computeManifestDigest(m);
  });
  assert.throws(() => holdout.registerSeasonManifest(unknownTeam), /unknown team XYZ/);

  const doubled = clone((m) => {
    m.games[1].away = m.games[0].away; // one franchise, two week-1 games
    m.digest = computeManifestDigest(m);
  });
  assert.throws(() => holdout.registerSeasonManifest(doubled), /in two games/);

  // Date-flex overrides are bound and enforced: edited terms are tamper-
  // evident, and a stored deadline may tighten its override, never exceed it.
  const clone18 = (mutate) => {
    const m = JSON.parse(JSON.stringify(SEASON18.manifest));
    m.season = 2098;
    mutate(m);
    return m;
  };
  const overrideSwap = clone18((m) => {
    m.digest = computeManifestDigest(m);
    m.deadlineOverrides['18'].authority = 'trust me';
  });
  assert.throws(() => holdout.registerSeasonManifest(overrideSwap), /digest check/);

  const exceeded = clone18((m) => {
    m.captureNotAfter['18'] = new Date(
      new Date(m.deadlineOverrides['18'].captureNotAfter).getTime() + 3600 * 1000
    ).toISOString();
    m.digest = computeManifestDigest(m);
  });
  assert.throws(() => holdout.registerSeasonManifest(exceeded), /exceeds its date-flex override/);

  assert.ok(
    !holdout.SEASON_MANIFESTS.has(2099) && !holdout.SEASON_MANIFESTS.has(2098),
    'nothing was registered by the failed attempts'
  );
});

test('the committed 2026 manifest verifies, pins its source, and covers all 18 deadlines', () => {
  const manifest = require('../data/nfl-schedule-2026.json');
  const { verifySeasonManifest } = require('../services/scheduleManifest');
  verifySeasonManifest(manifest); // digest + shape, the same gate the service runs at load
  assert.equal(manifest.games.length, 272);
  // Provenance is pinned, not narrated: exact source revision + generator.
  assert.match(manifest.source.url, /^https:\/\/raw\.githubusercontent\.com\/nflverse\/nfldata\/[0-9a-f]{40}\/data\/games\.csv$/);
  assert.match(manifest.source.commit, /^[0-9a-f]{40}$/);
  assert.match(manifest.source.blobSha, /^[0-9a-f]{40}$/);
  assert.equal(manifest.source.generator, 'server/scripts/generate-schedule-manifest.js');
  for (let week = 1; week <= 18; week++) {
    const deadline = new Date(manifest.captureNotAfter[String(week)]);
    assert.ok(!Number.isNaN(deadline.getTime()), `week ${week} has a deadline`);
  }
  // Spot-check the timezone conversion at both DST regimes: week 1 is EDT
  // (UTC-4), week 18's dates are EST (UTC-5).
  assert.equal(manifest.captureNotAfter['1'], '2026-09-10T00:20:00.000Z');
  // Week 18 must close at the SATURDAY reserve (Jan 9, 1:00 p.m. ET) - the
  // official Week 18 schedule lists three Saturday games there, assigned
  // after Week 17, and the source's Sunday times are placeholders until
  // then. The authority is pinned EXACTLY: it must be the page that states
  // the slot the cutoff asserts.
  assert.equal(manifest.captureNotAfter['18'], '2027-01-09T18:00:00.000Z');
  assert.equal(manifest.deadlineOverrides['18'].captureNotAfter, '2027-01-09T18:00:00.000Z');
  assert.equal(manifest.deadlineOverrides['18'].sourceDerived, '2027-01-10T18:00:00.000Z');
  assert.equal(
    manifest.deadlineOverrides['18'].authority,
    'https://www.nfl.com/schedules/2026/by-week/week-18'
  );
});

test('a week the sync lost entirely is still ATTEMPTED on the manifest schedule, and fails durably', async (t) => {
  withReleaseSha(t);
  mockGenerate(t);
  // No observed kickoffs anywhere: the old due-selection (derived from
  // nfl_games) would find nothing to do and the miss would be silent.
  const db = fakeDb(dbArgs({ schedule: [], due: [] }));

  const out = await holdout.captureDueSnapshots({ now: new Date('2077-09-09T12:00:00Z'), client: db });

  assert.equal(out.captured.length, 0);
  assert.equal(out.failures.length, 3, 'every profile was attempted and failed loudly');
  assert.ok(out.failures.every((f) => /no schedule rows/.test(f.message)));
  assert.equal(db.committed.status.length, 3, 'the failures are durable, not just returned');
  assert.ok(db.committed.status.every((r) => r.status === 'failed'));
});

test('stored kickoffs shifted later cannot reopen a closed capture window in due selection', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  // The database claims week 1 kicks off tomorrow; the manifest knows the
  // deadline passed an hour ago. Nothing is due, nothing is attempted.
  const db = fakeDb(dbArgs({
    due: [{ season: FIXTURE_SEASON, week: 1, first_kickoff: new Date(BASE + DAY).toISOString() }],
  }));

  const out = await holdout.captureDueSnapshots({ now: new Date(BASE + 3600 * 1000), client: db });

  assert.deepEqual(out, { captured: [], failures: [] });
  assert.equal(seen.length, 0, 'no computation for a window the manifest says is closed');
  assert.equal(db.committed.status.length, 0, 'no attempt was even recorded');
});

// ---------------------------------------------------------------------------
// Week 18: the Saturday reserve vs placeholder Sunday rows
// ---------------------------------------------------------------------------

const WK18_ROWS = SEASON18.rowsByWeek.get(18);
const wk18Args = (db) => ({
  season: RESERVE_SEASON, week: 18, profileName: 'half_ppr', rules: SCORING_PRESETS.half_ppr, client: db,
});
const wk18Db = (overrides = {}) => fakeDb({
  schedule: WK18_ROWS, seasonMatrix: SEASON18.matrixRows, cohort: COHORT, ...overrides,
});

test('week 18 capture closes at the Saturday reserve, not the placeholder Sunday kickoffs', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  // Sanity: the fixture reproduces the hazard - every stored kickoff is a
  // full day AFTER the manifest deadline, and the deadline IS the override.
  assert.equal(SEASON18.manifest.captureNotAfter['18'], WK18_RESERVE.toISOString());
  assert.ok(WK18_ROWS.every((r) => new Date(r.kickoff_at) > WK18_RESERVE));

  // One hour past the earliest possible Saturday kickoff: refused, whatever
  // the Sunday rows claim.
  const late = wk18Db({ clock: () => new Date(WK18_RESERVE.getTime() + 3600 * 1000) });
  await assert.rejects(holdout.snapshotWeek(wk18Args(late)), /capture window .* has closed/);
  assert.equal(seen.length, 0, 'a post-reserve capture never computes');
  assert.equal(late.committed.snapshots.length, 0);

  // Before the reserve: captures fine, and the DATABASE guards inherit the
  // reserve deadline - the header stores it, so the CHECK constraint and
  // the child trigger judge Saturday, not the placeholder Sunday.
  const ok = wk18Db({ clock: () => new Date(WK18_RESERVE.getTime() - 2 * 3600 * 1000) });
  const out = await holdout.snapshotWeek(wk18Args(ok));
  assert.equal(out.inserted, 3);
  assert.equal(
    new Date(ok.committed.snapshots[0].capture_not_after).toISOString(),
    WK18_RESERVE.toISOString()
  );
});

test('week 18 due selection closes at the reserve deadline despite Sunday observed kickoffs', async (t) => {
  withReleaseSha(t);
  const seen = mockGenerate(t);
  const observed = [{ season: RESERVE_SEASON, week: 18, first_kickoff: WK18_ROWS[0].kickoff_at }];

  // Past the reserve: nothing is due, nothing attempted, nothing recorded -
  // the Sunday observed kickoff cannot hold the window open.
  const closed = wk18Db({ due: observed });
  const after = await holdout.captureDueSnapshots({
    now: new Date(WK18_RESERVE.getTime() + 3600 * 1000), client: closed,
  });
  assert.deepEqual(after, { captured: [], failures: [] });
  assert.equal(closed.committed.status.length, 0);
  assert.equal(seen.length, 0);

  // Inside the reserve window: every predeclared profile is captured.
  const open = wk18Db({ due: observed, clock: () => new Date(WK18_RESERVE.getTime() - 2 * 3600 * 1000) });
  const before = await holdout.captureDueSnapshots({
    now: new Date(WK18_RESERVE.getTime() - 2 * 3600 * 1000), client: open,
  });
  assert.equal(before.failures.length, 0);
  assert.equal(before.captured.length, 3);
  assert.equal(open.committed.snapshots.length, 9, 'three arms per profile');
});

test('week 18 reconciliation judges missed and pending at the reserve deadline with stale Sunday rows', async (t) => {
  const saved = [...holdout.SEASON_MANIFESTS.entries()];
  holdout.SEASON_MANIFESTS.clear();
  holdout.SEASON_MANIFESTS.set(RESERVE_SEASON, SEASON18.manifest);
  t.after(() => {
    holdout.SEASON_MANIFESTS.clear();
    for (const [k, v] of saved) holdout.SEASON_MANIFESTS.set(k, v);
  });
  const rows = dbRowsForSeason(RESERVE_SEASON, (r) => r, SEASON18);

  // An hour past the reserve, the fully synced placeholder-Sunday schedule
  // insists kickoff is tomorrow. The obligation is MISSED anyway.
  const after = await holdout.reconcileObligations({
    now: new Date(WK18_RESERVE.getTime() + 3600 * 1000),
    client: reconcileFake({ scheduleRows: rows }),
  });
  assert.ok(
    after.obligations.filter((o) => o.week === 18).every((o) => o.state === 'missed'),
    'a valid schedule with placeholder times cannot outvote the reserve deadline'
  );
  assert.equal(after.ok, false);

  // Two hours before the reserve the window is OPEN (pending). Under a
  // Sunday-based cutoff this would read scheduled (26h out), so this pins
  // WHICH instant reconciliation uses, not just the state ordering.
  const before = await holdout.reconcileObligations({
    now: new Date(WK18_RESERVE.getTime() - 2 * 3600 * 1000),
    client: reconcileFake({ scheduleRows: rows }),
  });
  assert.ok(before.obligations.filter((o) => o.week === 18).every((o) => o.state === 'pending'));
});

// ---------------------------------------------------------------------------
// Scheduler placement + duty
// ---------------------------------------------------------------------------

test('the scheduler duty logs failures with season/week/profile context', async (t) => {
  const scheduler = require('../modules/scheduler');
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });
  t.mock.method(holdout, 'captureDueSnapshots', async () => ({
    captured: [],
    failures: [{ season: FIXTURE_SEASON, week: 3, profileName: 'ppr', message: 'boom' }],
  }));

  await scheduler.runHoldoutSnapshots();

  const line = logs.find((l) => String(l[0]).includes('holdout snapshot failed'));
  assert.ok(line, 'a failure line is emitted (repeats of this line are the actionable signal)');
  assert.deepEqual(line.slice(1), [FIXTURE_SEASON, 3, 'ppr', 'boom']);
});

test('the tick runs corrections, finalization, then holdout BEFORE waivers/trades/live work', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'modules', 'scheduler.js'), 'utf8');
  const body = source.slice(source.indexOf('async function tickUnlocked'));
  const at = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i !== -1, `tickUnlocked does not call ${needle}`);
    return i;
  };
  const corrections = at('runDailyStatCorrections()');
  const finalization = at('runNflverseFinalization()');
  const holdoutCall = at('runHoldoutSnapshots()');
  const waivers = at('processAllDueWaivers()');
  const trades = at('processDueTrades()');
  const live = at('syncAndScoreLiveWeeks()');
  assert.ok(corrections < finalization, 'fresh inputs: corrections before finalization');
  assert.ok(finalization < holdoutCall, 'fresh inputs: finalization before capture');
  assert.ok(holdoutCall < waivers && holdoutCall < trades && holdoutCall < live,
    'the deadline duty must not sit behind throwable non-deadline work');
});

// ---------------------------------------------------------------------------
// Migration smoke
// ---------------------------------------------------------------------------

test('the ledger migration carries the load-bearing DDL', () => {
  const file = path.join(__dirname, '..', 'db', 'migrations', '20260730000001_projection_holdout_ledger.js');
  const migration = require(file);
  assert.equal(typeof migration.up, 'function');
  assert.equal(typeof migration.down, 'function');

  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /CHECK \("is_late" OR "captured_at" < "capture_not_after"\)/);
  assert.match(source, /clock_timestamp\(\) >= parent\."capture_not_after"/,
    'the child trigger judges the stored deadline');
  assert.match(source, /BEFORE UPDATE OR DELETE ON "\$\{table\}"/);
  assert.match(source, /BEFORE TRUNCATE ON "\$\{table\}"/);
  assert.match(source, /RAISE EXCEPTION/);
  assert.match(source, /\['projection_snapshots', 'projection_snapshot_players'\]/);
  assert.match(source, /fn_reject_late_holdout_child/, 'the child cutoff trigger exists');
  assert.match(source, /BEFORE INSERT ON "projection_snapshot_players"/);
  assert.match(source, /'season', 'week', 'scoring_hash', 'model_version', 'capture_kind'/);
  assert.match(source, /refusing to roll back a NONEMPTY holdout ledger/);
  assert.match(source, /schedule_games/);
  assert.match(source, /schedule_hash/);
  assert.match(source, /protocol_version/);
  assert.match(source, /holdout_capture_status/);
  assert.match(source, /"projection_snapshots" ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /"projection_snapshot_players" ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /"holdout_capture_status" ENABLE ROW LEVEL SECURITY/);
});
