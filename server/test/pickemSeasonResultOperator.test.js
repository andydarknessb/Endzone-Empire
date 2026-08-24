const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const { recover, correct, auditTrailOf } = require('../services/pickemSeasonResult.service');

const champion = {
  teamId: 71,
  teamName: 'Recovered Team',
  avatarUrl: 'https://cdn.example/recovered.png',
  avatarStaticUrl: null,
  points: 19,
  correct: 16,
  mode: 'straight',
};

test('recovery dry-run reports the exact missing-to-declared change without writing', async () => {
  const db = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 7, pickem_only: true }] })],
    [select('pickem_season_results'), () => ({ rows: [] })],
  ]);

  const plan = await recover({
    db,
    leagueId: 7,
    season: 2026,
    operatorId: 9001,
    reason: 'Archived commissioner record verified',
    source: 'support-case-1842',
    proposed: { outcome: 'champions', mode: 'straight', champions: [champion] },
  });

  assert.deepEqual(plan, {
    operation: 'recovery',
    dryRun: true,
    applied: false,
    idempotent: false,
    before: {
      leagueId: 7,
      season: 2026,
      outcome: 'missing',
      mode: null,
      champions: [],
      provenance: null,
      declaredAt: null,
    },
    after: {
      leagueId: 7,
      season: 2026,
      outcome: 'champions',
      mode: 'straight',
      champions: [champion],
      provenance: {
        source: 'operator_recovery',
        evidenceSource: 'support-case-1842',
        operatorId: 9001,
      },
      declaredAt: null,
    },
    audit: null,
    awarded: [],
  });
  assert.equal(db.calls.some(({ text }) => /^(INSERT|UPDATE|DELETE|BEGIN|COMMIT)/.test(text)), false);
});

test('recovery apply commits the result, reconciled trophy, and audit together', async () => {
  let stored = null;
  const trophies = [];
  const audits = [];
  const db = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 7, pickem_only: true }] })],
    [select('pickem_season_results'), () => ({ rows: stored ? [stored] : [] })],
    [select('pickem_season_result_audits'), (text, params) => ({
      rows: audits.filter((row) => row.request_fingerprint === params[0]),
    })],
    [insert('pickem_season_results'), (text, params) => {
      stored = {
        league_id: params[0],
        season: params[1],
        outcome: params[2],
        scoring_mode: params[3],
        champions: JSON.parse(params[4]),
        provenance: JSON.parse(params[5]),
        declared_at: '2027-01-12T06:00:00.000Z',
      };
      return { rows: [stored] };
    }],
    [remove('trophies'), () => ({ rows: [] })],
    [select('teams'), () => ({ rows: [{ id: 71 }] })],
    [insert('trophies'), (text, params) => {
      trophies.push({
        leagueId: params[0], teamId: params[1], season: params[2],
        label: params[5], data: JSON.parse(params[6]),
      });
      return { rows: [{ id: trophies.length }] };
    }],
    [insert('pickem_season_result_audits'), (text, params) => {
      const row = {
        id: 1,
        league_id: params[0],
        season: params[1],
        operation: params[2],
        operator_id: params[3],
        reason: params[4],
        source: params[5],
        before_result: JSON.parse(params[6]),
        after_result: JSON.parse(params[7]),
        request_fingerprint: params[8],
        created_at: '2027-01-12T06:00:01.000Z',
      };
      audits.push(row);
      return { rows: [row] };
    }],
  ]);

  const outcome = await recover({
    db,
    apply: true,
    leagueId: 7,
    season: 2026,
    operatorId: 9001,
    reason: 'Archived commissioner record verified',
    source: 'support-case-1842',
    proposed: { outcome: 'champions', mode: 'straight', champions: [champion] },
  });

  const expectedAfter = {
    leagueId: 7,
    season: 2026,
    outcome: 'champions',
    mode: 'straight',
    champions: [champion],
    provenance: {
      source: 'operator_recovery',
      evidenceSource: 'support-case-1842',
      operatorId: 9001,
    },
    declaredAt: '2027-01-12T06:00:00.000Z',
  };
  assert.deepEqual(outcome, {
    operation: 'recovery',
    dryRun: false,
    applied: true,
    idempotent: false,
    before: {
      leagueId: 7, season: 2026, outcome: 'missing', mode: null,
      champions: [], provenance: null, declaredAt: null,
    },
    after: expectedAfter,
    audit: {
      id: 1,
      leagueId: 7,
      season: 2026,
      operation: 'recovery',
      operatorId: 9001,
      reason: 'Archived commissioner record verified',
      source: 'support-case-1842',
      before: {
        leagueId: 7, season: 2026, outcome: 'missing', mode: null,
        champions: [], provenance: null, declaredAt: null,
      },
      after: expectedAfter,
      createdAt: '2027-01-12T06:00:01.000Z',
    },
    awarded: [{ type: 'pickem_champion', teamId: 71, label: "2026 Pick'em Champion" }],
  });
  assert.equal(audits.length, 1);
  assert.deepEqual(trophies, [{
    leagueId: 7,
    teamId: 71,
    season: 2026,
    label: "2026 Pick'em Champion",
    data: { points: 19, correct: 16, mode: 'straight' },
  }]);
  assert.deepEqual(
    db.calls.filter(({ text }) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(text)).map(({ text }) => text),
    ['BEGIN', 'COMMIT']
  );

  const retry = await recover({
    db,
    apply: true,
    leagueId: 7,
    season: 2026,
    operatorId: 9001,
    reason: 'Archived commissioner record verified',
    source: 'support-case-1842',
    proposed: { outcome: 'champions', mode: 'straight', champions: [champion] },
  });
  assert.deepEqual(retry, {
    ...outcome,
    applied: false,
    idempotent: true,
    awarded: [],
  });
  assert.equal(audits.length, 1, 'an identical retry does not append another audit row');
  assert.equal(trophies.length, 1, 'an identical retry does not rebuild an unchanged trophy');
  db.assertClean();
});

test('correction dry-run reports an exact before/after plan without writing', async () => {
  const before = {
    leagueId: 8,
    season: 2026,
    outcome: 'champions',
    mode: 'straight',
    champions: [champion],
    provenance: { source: 'season_completion' },
    declaredAt: '2027-01-11T06:00:00.000Z',
  };
  const correctedChampion = {
    teamId: 72,
    teamName: 'Corrected Team',
    avatarUrl: null,
    avatarStaticUrl: null,
    points: 20,
    correct: 17,
    mode: 'straight',
  };
  const db = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 8, pickem_only: true }] })],
    [select('pickem_season_results'), () => ({ rows: [{
      league_id: 8,
      season: 2026,
      outcome: before.outcome,
      scoring_mode: before.mode,
      champions: before.champions,
      provenance: before.provenance,
      declared_at: before.declaredAt,
    }] })],
  ]);

  const plan = await correct({
    db,
    leagueId: 8,
    season: 2026,
    operatorId: 9002,
    reason: 'Original declaration omitted the verified winner',
    source: 'incident-77',
    expected: before,
    proposed: { outcome: 'champions', mode: 'straight', champions: [correctedChampion] },
  });

  assert.deepEqual(plan, {
    operation: 'correction',
    dryRun: true,
    applied: false,
    idempotent: false,
    before,
    after: {
      leagueId: 8,
      season: 2026,
      outcome: 'champions',
      mode: 'straight',
      champions: [correctedChampion],
      provenance: {
        source: 'operator_correction',
        evidenceSource: 'incident-77',
        operatorId: 9002,
      },
      declaredAt: before.declaredAt,
    },
    audit: null,
    awarded: [],
  });
  assert.equal(db.calls.some(({ text }) => /^(INSERT|UPDATE|DELETE|BEGIN|COMMIT)/.test(text)), false);
});

test('correction apply replaces the result and records immutable before/after evidence', async () => {
  const audits = [];
  let stored = {
    league_id: 8,
    season: 2026,
    outcome: 'champions',
    scoring_mode: 'straight',
    champions: [champion],
    provenance: { source: 'season_completion' },
    declared_at: '2027-01-11T06:00:00.000Z',
  };
  const before = {
    leagueId: 8,
    season: 2026,
    outcome: 'champions',
    mode: 'straight',
    champions: [champion],
    provenance: { source: 'season_completion' },
    declaredAt: '2027-01-11T06:00:00.000Z',
  };
  const db = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 8, pickem_only: true }] })],
    [select('pickem_season_results'), () => ({ rows: [stored] })],
    [select('pickem_season_result_audits'), (text, params) => ({
      rows: audits.filter((row) => row.request_fingerprint === params[0]),
    })],
    [update('pickem_season_results'), (text, params) => {
      stored = {
        ...stored,
        outcome: params[0],
        scoring_mode: params[1],
        champions: JSON.parse(params[2]),
        provenance: JSON.parse(params[3]),
      };
      return { rows: [stored] };
    }],
    [remove('trophies'), () => ({ rows: [] })],
    [insert('pickem_season_result_audits'), (text, params) => {
      const row = {
        id: 2,
        league_id: params[0],
        season: params[1],
        operation: params[2],
        operator_id: params[3],
        reason: params[4],
        source: params[5],
        before_result: JSON.parse(params[6]),
        after_result: JSON.parse(params[7]),
        request_fingerprint: params[8],
        created_at: '2027-01-13T06:00:00.000Z',
      };
      audits.push(row);
      return { rows: [row] };
    }],
  ]);

  const outcome = await correct({
    db,
    apply: true,
    leagueId: 8,
    season: 2026,
    operatorId: 9002,
    reason: 'No qualifying winner remained after evidence review',
    source: 'incident-77',
    expected: before,
    proposed: { outcome: 'no_champion', mode: 'straight', champions: [] },
  });

  const after = {
    leagueId: 8,
    season: 2026,
    outcome: 'no_champion',
    mode: 'straight',
    champions: [],
    provenance: {
      source: 'operator_correction',
      evidenceSource: 'incident-77',
      operatorId: 9002,
    },
    declaredAt: before.declaredAt,
  };
  assert.deepEqual(outcome, {
    operation: 'correction',
    dryRun: false,
    applied: true,
    idempotent: false,
    before,
    after,
    audit: {
      id: 2,
      leagueId: 8,
      season: 2026,
      operation: 'correction',
      operatorId: 9002,
      reason: 'No qualifying winner remained after evidence review',
      source: 'incident-77',
      before,
      after,
      createdAt: '2027-01-13T06:00:00.000Z',
    },
    awarded: [],
  });
  assert.equal(db.matching(insert('trophies')).length, 0);
  assert.deepEqual(
    db.calls.filter(({ text }) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(text)).map(({ text }) => text),
    ['BEGIN', 'COMMIT']
  );

  const retry = await correct({
    db,
    apply: true,
    leagueId: 8,
    season: 2026,
    operatorId: 9002,
    reason: 'No qualifying winner remained after evidence review',
    source: 'incident-77',
    expected: before,
    proposed: { outcome: 'no_champion', mode: 'straight', champions: [] },
  });
  assert.deepEqual(retry, {
    ...outcome,
    applied: false,
    idempotent: true,
    awarded: [],
  });
  assert.equal(audits.length, 1, 'an identical correction retry does not append another audit row');
  db.assertClean();
});

test('auditTrailOf returns the append order with actor, reason, source, and snapshots', async () => {
  const before = {
    leagueId: 9, season: 2026, outcome: 'missing', mode: null,
    champions: [], provenance: null, declaredAt: null,
  };
  const after = {
    leagueId: 9, season: 2026, outcome: 'champions', mode: 'straight',
    champions: [champion],
    provenance: { source: 'operator_recovery', evidenceSource: 'case-9', operatorId: 9003 },
    declaredAt: '2027-01-14T06:00:00.000Z',
  };
  const db = createFakePool([
    [select('pickem_season_result_audits'), () => ({ rows: [{
      id: 3,
      league_id: 9,
      season: 2026,
      operation: 'recovery',
      operator_id: 9003,
      reason: 'Recovered from signed archive',
      source: 'case-9',
      before_result: before,
      after_result: after,
      created_at: '2027-01-14T06:00:01.000Z',
    }] })],
  ]);

  assert.deepEqual(await auditTrailOf({ db, leagueId: 9, season: 2026 }), [{
    id: 3,
    leagueId: 9,
    season: 2026,
    operation: 'recovery',
    operatorId: 9003,
    reason: 'Recovered from signed archive',
    source: 'case-9',
    before,
    after,
    createdAt: '2027-01-14T06:00:01.000Z',
  }]);
});

test('recovery and correction require scalar operator metadata before any database read', async () => {
  const proposed = { outcome: 'champions', mode: 'straight', champions: [champion] };
  const attempts = [
    ['recovery operator identity', recover, {
      leagueId: 10, season: 2026, operatorId: [9004], reason: 'Verified', source: 'case-10', proposed,
    }],
    ['correction source', correct, {
      leagueId: 10, season: 2026, operatorId: 9004, reason: 'Verified', source: '   ',
      expected: {}, proposed,
    }],
  ];

  for (const [label, operation, input] of attempts) {
    const db = createFakePool([]);
    await assert.rejects(
      operation({ db, ...input }),
      (error) => error.code === 'PICKEM_SEASON_RESULT_OPERATOR_INPUT_REQUIRED',
      label
    );
    assert.deepEqual(db.calls, [], `${label}: invalid metadata must not reach the database`);
  }
});

test('operator workflows refuse a non-boolean apply flag before any database read', async () => {
  const db = createFakePool([]);
  await assert.rejects(
    recover({
      db,
      apply: 'true',
      leagueId: 10,
      season: 2026,
      operatorId: 9004,
      reason: 'Verified',
      source: 'case-10',
      proposed: { outcome: 'champions', mode: 'straight', champions: [champion] },
    }),
    (error) => error.code === 'PICKEM_SEASON_RESULT_OPERATOR_INPUT_REQUIRED'
  );
  assert.deepEqual(db.calls, []);
});

test('operator proposals reject contradictory or duplicate co-champion evidence before reading', async () => {
  const cases = [
    ['different scores', [champion, { ...champion, teamId: 72, teamName: 'Other', points: 18 }]],
    ['duplicate Team', [champion, { ...champion }]],
    ['conflicting mode', [{ ...champion, mode: 'confidence' }]],
    ['non-scalar Team id', [{ ...champion, teamId: [71] }]],
  ];
  for (const [label, champions] of cases) {
    const db = createFakePool([]);
    await assert.rejects(
      recover({
        db,
        leagueId: 11,
        season: 2026,
        operatorId: 9005,
        reason: 'Evidence reviewed',
        source: 'case-11',
        proposed: { outcome: 'champions', mode: 'straight', champions },
      }),
      (error) => error.code === 'PICKEM_SEASON_RESULT_INVALID',
      label
    );
    assert.deepEqual(db.calls, [], `${label}: invalid evidence must not reach the database`);
  }
});

test('recovery refuses an existing result and correction refuses a missing result', async () => {
  const existingDb = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 12, pickem_only: true }] })],
    [select('pickem_season_results'), () => ({ rows: [{
      league_id: 12,
      season: 2026,
      outcome: 'champions',
      scoring_mode: 'straight',
      champions: [champion],
      provenance: { source: 'season_completion' },
      declared_at: '2027-01-11T06:00:00.000Z',
    }] })],
  ]);
  await assert.rejects(
    recover({
      db: existingDb,
      leagueId: 12,
      season: 2026,
      operatorId: 9006,
      reason: 'Should not replace',
      source: 'case-12',
      proposed: { outcome: 'champions', mode: 'straight', champions: [champion] },
    }),
    (error) => error.code === 'PICKEM_SEASON_RESULT_INVALID_STATE'
  );

  const missingDb = createFakePool([
    [select('leagues'), () => ({ rows: [{ id: 13, pickem_only: true }] })],
    [select('pickem_season_results'), () => ({ rows: [] })],
  ]);
  await assert.rejects(
    correct({
      db: missingDb,
      leagueId: 13,
      season: 2026,
      operatorId: 9006,
      reason: 'Cannot correct missing',
      source: 'case-13',
      expected: {},
      proposed: { outcome: 'no_champion', mode: 'straight', champions: [] },
    }),
    (error) => error.code === 'PICKEM_SEASON_RESULT_INVALID_STATE'
  );
  assert.equal(existingDb.calls.some(({ text }) => /^(INSERT|UPDATE|DELETE)/.test(text)), false);
  assert.equal(missingDb.calls.some(({ text }) => /^(INSERT|UPDATE|DELETE)/.test(text)), false);
});
