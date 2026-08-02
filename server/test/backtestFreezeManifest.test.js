const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const freezeManifest = require('../../scripts/backtest/lib/freezeManifest');
const { canonicalJson } = require('../../scripts/backtest/lib/snapshotStore');

const SHA_A = 'a'.repeat(40);
const SHA_M = 'b'.repeat(40);
const TREE_A = 'c'.repeat(40);
const BLOB_M = 'd'.repeat(40);

/** A well-formed { name, rules, sha256, primary } entry, hash genuinely matching. */
function scoringProfile(name, { reception, primary = false } = {}) {
  const rules = canonicalJson({ receiving: { reception } });
  return {
    name,
    rules,
    sha256: crypto.createHash('sha256').update(rules, 'utf8').digest('hex'),
    primary,
  };
}

function validScoringProfiles() {
  return [
    scoringProfile('standard', { reception: 0 }),
    scoringProfile('half_ppr', { reception: 0.5, primary: true }),
    scoringProfile('ppr', { reception: 1 }),
  ];
}

function validManifest(overrides = {}) {
  return {
    commitA: { sha: SHA_A, treeSha: TREE_A },
    commitM: { sha: SHA_M, blobSha: BLOB_M },
    node: { version: '24.4.0', npmVersion: '10.8.0' },
    os: { platform: 'linux', arch: 'x64' },
    image: { ref: 'node@sha256:'.concat('e'.repeat(64)), platform: 'linux/amd64' },
    scoringProfiles: validScoringProfiles(),
    ...overrides,
  };
}

test('a well-formed manifest validates', () => {
  assert.equal(freezeManifest.assertValidManifest(validManifest()), true);
});

test('buildManifest assembles and validates in one step', () => {
  const m = validManifest();
  const built = freezeManifest.buildManifest({
    commitA: m.commitA,
    commitM: m.commitM,
    node: m.node,
    os: m.os,
    image: m.image,
    scoringProfiles: m.scoringProfiles,
  });
  assert.deepEqual(built, m);
});

// ---------------------------------------------------------------------------
// Required fields
// ---------------------------------------------------------------------------

test('every required top-level field is enforced', () => {
  for (const field of Object.keys(freezeManifest.REQUIRED_FIELDS)) {
    const bad = validManifest();
    delete bad[field];
    assert.throws(() => freezeManifest.assertValidManifest(bad), new RegExp(field));
  }
});

test('a non-object manifest is refused', () => {
  assert.throws(() => freezeManifest.assertValidManifest(null), /must be an object/);
  assert.throws(() => freezeManifest.assertValidManifest('nope'), /must be an object/);
});

// ---------------------------------------------------------------------------
// git SHA shape
// ---------------------------------------------------------------------------

test('commit SHAs must be well-formed git object ids', () => {
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    commitA: { sha: 'not-a-sha', treeSha: TREE_A },
  })), /not a well-formed git object SHA/);
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    commitM: { sha: SHA_M, blobSha: 'zz' },
  })), /not a well-formed git object SHA/);
  // A 64-hex SHA-256 object id is also accepted (forward compatibility).
  assert.equal(freezeManifest.assertShaShape('f'.repeat(64), { label: 'x' }), 'f'.repeat(64));
});

test('commitA.sha and commitM.sha must be distinct - A and M are two different commits', () => {
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    commitM: { sha: SHA_A, blobSha: BLOB_M },
  })), /commitA\.sha and commitM\.sha are identical/);
});

// ---------------------------------------------------------------------------
// Image pinning
// ---------------------------------------------------------------------------

test('the image ref must be pinned BY DIGEST, never a floating tag', () => {
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    image: { ref: 'node:24-slim', platform: 'linux/amd64' },
  })), /not pinned by digest/);
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    image: { ref: 'node@sha256:tooshort', platform: 'linux/amd64' },
  })), /not pinned by digest/);
  assert.equal(freezeManifest.IMAGE_DIGEST_SHAPE.test(`node@sha256:${'a'.repeat(64)}`), true);
  assert.equal(freezeManifest.IMAGE_DIGEST_SHAPE.test('node:24-slim'), false);
  // The pipeline's own real reference: tag AND digest together, exactly what
  // backtest.Dockerfile's FROM line and the runtime-identity sidecar's
  // imageRef both carry - a bare "name@sha256:..." with no tag is a fixture
  // convenience, never what this pipeline actually produces or validates
  // against in practice, so this shape must pass too.
  assert.equal(freezeManifest.IMAGE_DIGEST_SHAPE.test(`node:24-slim@sha256:${'a'.repeat(64)}`), true);
  assert.doesNotThrow(() => freezeManifest.assertValidManifest(validManifest({
    image: { ref: `node:24-slim@sha256:${'a'.repeat(64)}`, platform: 'linux/amd64' },
  })));
});

test('the image platform must be exactly linux/amd64', () => {
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    image: { ref: `node@sha256:${'a'.repeat(64)}`, platform: 'linux/arm64' },
  })), /image\.platform is "linux\/arm64", expected "linux\/amd64"/);
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

test('serializeManifest produces canonical, sorted-key, LF-terminated JSON', () => {
  const serialized = freezeManifest.serializeManifest(validManifest());
  assert.equal(serialized.endsWith('\n'), true);
  assert.equal(serialized.endsWith('\n\n'), false);
  const reparsed = JSON.parse(serialized);
  assert.deepEqual(reparsed, validManifest());
  // Sorted keys: "commitA" sorts before "commitM" sorts before "image" ... sorts before "os".
  const keys = Object.keys(reparsed);
  assert.deepEqual(keys, [...keys].sort());
});

test('serializeManifest refuses to serialize an invalid manifest', () => {
  assert.throws(
    () => freezeManifest.serializeManifest({ commitA: { sha: 'nope' } }),
    /missing or malformed required field/
  );
});

// ---------------------------------------------------------------------------
// Scoring profiles (prereg 4.3, Commit B)
// ---------------------------------------------------------------------------

test('a well-formed scoringProfiles block validates', () => {
  assert.equal(freezeManifest.assertScoringProfiles(validScoringProfiles(), { label: 'x' }), true);
});

test('scoringProfiles must be an array', () => {
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    scoringProfiles: { standard: {} },
  })), /scoringProfiles: must be an array/);
});

test('scoringProfiles must have exactly three entries', () => {
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    scoringProfiles: validScoringProfiles().slice(0, 2),
  })), /must have exactly 3 entries/);
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    scoringProfiles: [...validScoringProfiles(), scoringProfile('ppr', { reception: 1 })],
  })), /must have exactly 3 entries/);
});

test('every profile name must be one of the three preregistered names, with no duplicates', () => {
  const bad = validScoringProfiles();
  bad[0] = { ...bad[0], name: 'quarter_ppr' };
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: bad })),
    /is not one of \[standard, half_ppr, ppr\]/);

  const dup = validScoringProfiles();
  dup[0] = { ...dup[0], name: 'ppr' }; // now "ppr" appears twice, "standard" not at all
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: dup })),
    /appears more than once/);
});

test('rules must be the CANONICAL serialization, not merely valid JSON', () => {
  const bad = validScoringProfiles();
  // Same content, non-canonical whitespace - a real-world "looks equivalent" mistake.
  bad[0] = { ...bad[0], rules: JSON.stringify(JSON.parse(bad[0].rules), null, 2) };
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: bad })),
    /is not the CANONICAL serialization/);

  const malformed = validScoringProfiles();
  malformed[0] = { ...malformed[0], rules: '{not json' };
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: malformed })),
    /not valid JSON/);
});

test('sha256 must be well-formed AND must genuinely hash .rules', () => {
  const malformedHash = validScoringProfiles();
  malformedHash[0] = { ...malformedHash[0], sha256: 'not-hex' };
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: malformedHash })),
    /not a well-formed lowercase SHA-256 hex digest/);

  const wrongHash = validScoringProfiles();
  wrongHash[0] = { ...wrongHash[0], sha256: 'f'.repeat(64) };
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: wrongHash })),
    /does not match the SHA-256 of \.rules/);
});

test('exactly one profile must be marked primary, and it must be half_ppr', () => {
  const noPrimary = validScoringProfiles().map((p) => ({ ...p, primary: false }));
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: noPrimary })),
    /exactly one profile must be marked primary/);

  // Marking every profile primary is caught earlier and more specifically:
  // any entry whose primary=true but whose name isn't half_ppr fails on ITS
  // OWN per-entry check (below) before the aggregate count is even reached -
  // there is no way to have two primaries without also having a wrong-named
  // one, so that is the case actually exercised, not a generic "count" error.
  const everyonePrimary = validScoringProfiles().map((p) => ({ ...p, primary: true }));
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({ scoringProfiles: everyonePrimary })),
    /preregistration 4\.3 names "half_ppr" as the formal primary/);

  // Primary on "standard" instead of "half_ppr" - wrong profile, not just wrong count.
  const wrongProfilePrimary = validScoringProfiles().map((p) => ({
    ...p, primary: p.name === 'standard',
  }));
  assert.throws(() => freezeManifest.assertValidManifest(validManifest({
    scoringProfiles: wrongProfilePrimary,
  })), /preregistration 4\.3 names "half_ppr" as the formal primary/);
});

test('SCORING_PROFILE_NAMES and PRIMARY_SCORING_PROFILE are the preregistered values', () => {
  assert.deepEqual(freezeManifest.SCORING_PROFILE_NAMES, ['standard', 'half_ppr', 'ppr']);
  assert.equal(freezeManifest.PRIMARY_SCORING_PROFILE, 'half_ppr');
});

// ---------------------------------------------------------------------------
// The real wiring: run-backtest-freeze-manifest.js's buildScoringProfiles,
// built from server/services/scoring.service.js's ACTUAL rule sets - the same
// module run-backtest-rosters.js scores every candidate through - rather than
// a hand-typed stand-in.
// ---------------------------------------------------------------------------

const runFreezeManifest = require('../scripts/run-backtest-freeze-manifest');
const { SCORING_PRESETS } = require('../services/scoring.service');

test('buildScoringProfiles() produces a scoringProfiles block that validates against the real rules', () => {
  const profiles = runFreezeManifest.buildScoringProfiles();
  assert.equal(freezeManifest.assertScoringProfiles(profiles, { label: 'x' }), true);
  assert.deepEqual(profiles.map((p) => p.name).sort(), ['half_ppr', 'ppr', 'standard']);
  assert.equal(profiles.find((p) => p.name === 'half_ppr').primary, true);
  assert.equal(profiles.filter((p) => p.primary).length, 1);
});

test('buildScoringProfiles() pins the REAL SCORING_PRESETS, not a stand-in - the reception rate round-trips', () => {
  const profiles = runFreezeManifest.buildScoringProfiles();
  for (const profile of profiles) {
    const rules = JSON.parse(profile.rules);
    assert.equal(
      rules.receiving.reception,
      SCORING_PRESETS[profile.name].receiving.reception,
      `${profile.name}'s pinned reception rate must match the real preset`
    );
  }
});

test('buildScoringProfiles() is sorted by name, independent of SCORING_PRESETS insertion order', () => {
  const profiles = runFreezeManifest.buildScoringProfiles({ ppr: {}, standard: {}, half_ppr: {} });
  assert.deepEqual(profiles.map((p) => p.name), ['half_ppr', 'ppr', 'standard']);
});
