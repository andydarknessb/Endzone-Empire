const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const poolModule = require('../modules/pool');
const model = require('../services/projectionModel');
const projectionSvc = require('../services/projection.service');
const holdout = require('../services/holdout.service');
const { SCORING_PRESETS } = require('../services/scoring.service');

// ---------------------------------------------------------------------------
// Fake ledger store
// ---------------------------------------------------------------------------

/**
 * Applies the ledger's REAL database semantics in memory: the snapshot
 * identity's ON CONFLICT DO NOTHING, the player rows' ON CONFLICT DO
 * NOTHING, and the pre-kickoff CHECK judged against the store's own clock
 * (`dbNow`), exactly as Postgres judges `captured_at` by its clock and not
 * the caller's. Every statement is recorded so tests can assert what the
 * service NEVER touches as strongly as what it does.
 */
function fakeLedgerStore({ dbNow = () => new Date('2026-09-09T12:00:00Z'), cohort = [1, 2, 3], dueRows = [], failIdentityHash = null } = {}) {
  const snapshots = [];
  const playerRows = [];
  const statements = [];
  let nextId = 1;
  return {
    snapshots,
    playerRows,
    statements,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, ' ');
      statements.push({ text, params });
      if (text.includes('FROM "players"')) {
        return { rows: cohort.map((id) => ({ id })) };
      }
      if (text.includes('MIN("kickoff_at")')) {
        return { rows: dueRows };
      }
      if (text.includes('"s"."cohort_size"')) {
        const [season, week, hash, version] = params;
        const s = snapshots.find(
          (r) => r.season === season && r.week === week && r.scoring_hash === hash
            && r.model_version === version && r.capture_kind === 'scheduled'
        );
        if (!s) return { rows: [] };
        const rows = playerRows.filter((p) => p.snapshot_id === s.id).length;
        return { rows: [{ id: s.id, cohort_size: s.cohort_size, rows }] };
      }
      if (text.includes('INSERT INTO "projection_snapshots"')) {
        const [season, week, profile, hash, version, , , , cohortSize, firstKickoffAt] = params;
        if (hash === failIdentityHash) throw new Error('simulated insert failure');
        const capturedAt = dbNow();
        // The migration's CHECK: is_late OR captured_at < first_kickoff_at.
        // The scheduled writer never sets is_late, so the write must be early.
        if (!(capturedAt < new Date(firstKickoffAt))) {
          throw new Error(
            'new row for relation "projection_snapshots" violates check constraint "projection_snapshots_pre_kickoff_check"'
          );
        }
        const exists = snapshots.find(
          (r) => r.season === season && r.week === week && r.scoring_hash === hash
            && r.model_version === version && r.capture_kind === 'scheduled'
        );
        if (exists) {
          // Postgres semantics, not courtesy: without the conflict clause a
          // duplicate identity is an ERROR, so a mutant that drops ON
          // CONFLICT fails the retry tests instead of passing politely.
          if (!text.includes('ON CONFLICT')) {
            throw new Error('duplicate key value violates unique constraint "projection_snapshots_identity"');
          }
          return { rows: [], rowCount: 0 };
        }
        const row = {
          id: nextId++, season, week, scoring_profile: profile, scoring_hash: hash,
          model_version: version, capture_kind: 'scheduled', cohort_size: cohortSize,
          first_kickoff_at: firstKickoffAt, captured_at: capturedAt,
        };
        snapshots.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (text.includes('SELECT "id" FROM "projection_snapshots"')) {
        const [season, week, hash, version] = params;
        const s = snapshots.find(
          (r) => r.season === season && r.week === week && r.scoring_hash === hash
            && r.model_version === version && r.capture_kind === 'scheduled'
        );
        return { rows: s ? [{ id: s.id }] : [] };
      }
      if (text.includes('INSERT INTO "projection_snapshot_players"')) {
        const COLS = 12;
        let count = 0;
        for (let i = 0; i < params.length; i += COLS) {
          const snapshotId = params[i];
          const playerId = params[i + 1];
          if (playerRows.some((r) => r.snapshot_id === snapshotId && r.player_id === playerId)) {
            if (!text.includes('ON CONFLICT')) {
              throw new Error('duplicate key value violates unique constraint "projection_snapshot_players_unique"');
            }
            continue;
          }
          playerRows.push({
            snapshot_id: snapshotId, player_id: playerId,
            mean: params[i + 2], median: params[i + 3],
          });
          count += 1;
        }
        return { rows: [], rowCount: count };
      }
      return { rows: [] };
    },
  };
}

function mockGenerate(t, { seen = [] } = {}) {
  t.mock.method(projectionSvc, 'generateProjections', async (args) => {
    seen.push(args);
    const projections = new Map(
      args.playerIds.map((id) => [id, {
        mean: id + 0.5, median: id + 0.25, p10: 1, p25: 2, p75: 8, p90: 9,
        activeProbability: 1, confidence: 'high', sampleSize: 4, factors: { note: 'test' },
      }])
    );
    return {
      projections,
      inputCutoff: new Date('2026-09-09T11:00:00Z'),
      sourceCoverage: { stats: 'ok' },
    };
  });
  return seen;
}

const KICKOFF = '2026-09-10T00:20:00Z'; // fake week's first kickoff
const baseArgs = (store) => ({
  season: 2026, week: 1, profileName: 'half_ppr',
  rules: SCORING_PRESETS.half_ppr, firstKickoffAt: KICKOFF, client: store,
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('a capture retry creates no duplicate header and no duplicate player rows', async (t) => {
  mockGenerate(t);
  const store = fakeLedgerStore({ cohort: [7, 8, 9] });

  const first = await holdout.snapshotWeek(baseArgs(store));
  assert.equal(first.inserted, 3);
  assert.equal(store.snapshots.length, 1);
  assert.equal(store.playerRows.length, 3);

  const second = await holdout.snapshotWeek(baseArgs(store));
  assert.equal(second.skipped, 'already complete', 'a complete snapshot is skipped, not rewritten');
  assert.equal(store.snapshots.length, 1, 'no duplicate header');
  assert.equal(store.playerRows.length, 3, 'no duplicate player rows');
  assert.ok(
    store.statements.every((s) => !/\b(UPDATE|DELETE)\b/i.test(s.text)),
    'the writer never issues UPDATE or DELETE — append-only means INSERT only'
  );
});

test('a partial capture is completed in place, inserting only the missing rows', async (t) => {
  mockGenerate(t);
  const store = fakeLedgerStore({ cohort: [7, 8, 9] });

  await holdout.snapshotWeek(baseArgs(store));
  // Simulate a partial write: drop one player row as if the process died
  // mid-chunk. (Only the fake does this — the real table cannot be deleted
  // from, but a crash between chunks leaves exactly this state.)
  store.playerRows.pop();

  const retry = await holdout.snapshotWeek(baseArgs(store));
  assert.equal(retry.inserted, 1, 'exactly the missing row, nothing rewritten');
  assert.equal(store.snapshots.length, 1);
  assert.equal(store.playerRows.length, 3);
});

// ---------------------------------------------------------------------------
// Cache independence
// ---------------------------------------------------------------------------

test('the snapshot pipeline never touches the projection cache tables', async (t) => {
  const seen = mockGenerate(t);
  const store = fakeLedgerStore();

  await holdout.snapshotWeek(baseArgs(store));

  assert.equal(seen.length, 1, 'projections come from the COMPUTE path (generateProjections)');
  assert.equal(seen[0].client, store, 'and the injected client is threaded through');
  for (const s of store.statements) {
    assert.ok(
      !s.text.includes('projection_runs') && !s.text.includes('player_week_projections'),
      `cache table touched by: ${s.text.slice(0, 80)}`
    );
  }
});

test('a populated or empty cache changes nothing in what the ledger records', async (t) => {
  // The strong form of "cache hit versus miss does not change the ledger":
  // the pipeline reads no cache table at all (asserted above), so the only
  // way cache state could leak in is through generateProjections' inputs —
  // pinned here to the compute signature, which carries no cache handle.
  const seen = mockGenerate(t);
  const store = fakeLedgerStore();
  await holdout.snapshotWeek(baseArgs(store));
  const argKeys = Object.keys(seen[0]).sort();
  assert.deepEqual(
    argKeys,
    ['client', 'hashValue', 'playerIds', 'rules', 'season', 'week'],
    'generateProjections receives inputs only — no refresh flag, no cached run'
  );
});

// ---------------------------------------------------------------------------
// Corrections cannot reach the ledger
// ---------------------------------------------------------------------------

test('a full correction pass emits no SQL that references the ledger tables', async (t) => {
  const scoringSvc = require('../services/scoring.service');
  const nflverse = require('../services/nflverseSync.service');
  const correctionSvc = require('../services/correction.service');
  t.mock.method(console, 'error', () => {});

  const recorded = [];
  t.mock.method(poolModule, 'query', async (sql, params) => {
    recorded.push(String(sql));
    if (String(sql).includes('FROM "leagues"')) {
      return { rows: [{ id: 42, current_season: 2026, current_week: 4 }] };
    }
    return { rows: [], rowCount: 0 };
  });
  t.mock.method(nflverse, 'correctWeekFromNflverse', async () => ({ playersUpdated: 1 }));
  t.mock.method(scoringSvc, 'syncWeekStats', async () => ({ plays: [] }));

  await correctionSvc.resyncPriorWeeks();

  assert.ok(recorded.length > 0, 'the pass actually ran SQL');
  for (const sql of recorded) {
    assert.ok(
      !sql.includes('projection_snapshot'),
      `correction pass touched the ledger: ${sql.replace(/\s+/g, ' ').slice(0, 80)}`
    );
  }
  const invalidation = recorded.find((sql) => sql.includes('DELETE FROM "projection_runs"'));
  assert.ok(invalidation, 'cache invalidation ran — against the CACHE table, not the ledger');
});

// ---------------------------------------------------------------------------
// Late captures fail closed
// ---------------------------------------------------------------------------

test('a capture at or after first kickoff is rejected by the database and writes nothing', async (t) => {
  mockGenerate(t);
  const store = fakeLedgerStore({ dbNow: () => new Date('2026-09-10T00:20:00Z') }); // exactly kickoff

  await assert.rejects(
    holdout.snapshotWeek(baseArgs(store)),
    /pre_kickoff_check/,
    'the CHECK constraint is the rejector — not service-layer politeness'
  );
  assert.equal(store.snapshots.length, 0, 'no header');
  assert.equal(store.playerRows.length, 0, 'no player rows — fail CLOSED, not partial');
});

// ---------------------------------------------------------------------------
// Scheduled capture
// ---------------------------------------------------------------------------

test('captureDueSnapshots snapshots every predeclared profile for a due week', async (t) => {
  mockGenerate(t);
  const store = fakeLedgerStore({
    dueRows: [{ season: 2026, week: 1, first_kickoff: KICKOFF }],
  });

  const out = await holdout.captureDueSnapshots({ now: new Date('2026-09-09T12:00:00Z'), client: store });

  assert.equal(out.failures.length, 0);
  assert.deepEqual(
    out.captured.map((c) => c.profileName).sort(),
    ['half_ppr', 'ppr', 'standard'],
    'all three predeclared profiles, nothing traffic-dependent'
  );
  assert.equal(store.snapshots.length, 3, 'one header per profile (distinct scoring hashes)');
  assert.equal(new Set(store.snapshots.map((s) => s.scoring_hash)).size, 3);
});

test('one profile failing does not block the other profiles', async (t) => {
  mockGenerate(t);
  const store = fakeLedgerStore({
    dueRows: [{ season: 2026, week: 1, first_kickoff: KICKOFF }],
    failIdentityHash: model.scoringHash(SCORING_PRESETS.half_ppr),
  });

  const out = await holdout.captureDueSnapshots({ now: new Date('2026-09-09T12:00:00Z'), client: store });

  assert.equal(out.captured.length, 2, 'the other two profiles still captured');
  assert.equal(out.failures.length, 1);
  assert.equal(out.failures[0].profileName, 'half_ppr');
  assert.equal(out.failures[0].season, 2026);
  assert.equal(out.failures[0].week, 1);
});

test('outside the capture window there is nothing to do and nothing is computed', async (t) => {
  const seen = mockGenerate(t);
  const store = fakeLedgerStore({ dueRows: [] });
  const out = await holdout.captureDueSnapshots({ now: new Date('2026-06-01T00:00:00Z'), client: store });
  assert.deepEqual(out, { captured: [], failures: [] });
  assert.equal(seen.length, 0, 'no projection run outside the window');
});

// ---------------------------------------------------------------------------
// Scheduler duty
// ---------------------------------------------------------------------------

test('the scheduler duty logs failures with season/week/profile context', async (t) => {
  const scheduler = require('../modules/scheduler');
  const logs = [];
  t.mock.method(console, 'error', (...args) => { logs.push(args); });
  t.mock.method(holdout, 'captureDueSnapshots', async () => ({
    captured: [],
    failures: [{ season: 2026, week: 3, profileName: 'ppr', message: 'boom' }],
  }));

  await scheduler.runHoldoutSnapshots();

  const line = logs.find((l) => String(l[0]).includes('holdout snapshot failed'));
  assert.ok(line, 'a failure line is emitted (repeats of this line are the actionable signal)');
  assert.deepEqual(line.slice(1), [2026, 3, 'ppr', 'boom']);
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
  // The pre-kickoff cutoff lives in the DATABASE.
  assert.match(source, /CHECK \("is_late" OR "captured_at" < "first_kickoff_at"\)/);
  // Both tables are append-only via triggers, including TRUNCATE.
  assert.match(source, /BEFORE UPDATE OR DELETE ON "\$\{table\}"/);
  assert.match(source, /BEFORE TRUNCATE ON "\$\{table\}"/);
  assert.match(source, /RAISE EXCEPTION/);
  assert.match(
    source,
    /\['projection_snapshots', 'projection_snapshot_players'\]/,
    'the trigger loop covers both ledger tables'
  );
  // Retry identity for idempotent inserts.
  assert.match(source, /'season', 'week', 'scoring_hash', 'model_version', 'capture_kind'/);
  // Server-only: RLS enabled with no policies.
  assert.match(source, /"projection_snapshots" ENABLE ROW LEVEL SECURITY/);
  assert.match(source, /"projection_snapshot_players" ENABLE ROW LEVEL SECURITY/);
});
