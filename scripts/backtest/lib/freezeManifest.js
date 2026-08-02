'use strict';

/**
 * The shape and validation of `FREEZE_MANIFEST.json` - freeze Commit B, and the
 * last thing the freeze sequence writes.
 *
 * WHAT THIS FILE PROVES. Nothing here talks to git, a filesystem, or a clock -
 * that is `server/scripts/run-backtest-freeze-manifest.js`'s job. This module
 * answers one question: given a candidate manifest object, is its SHAPE
 * complete and internally sane? "Sane" means: every required identity field is
 * present and the right type, Commit M's recorded SHA is not Commit A's (the
 * two are the freeze's two distinct outputs and a manifest that names the same
 * commit for both would mean the freeze copy-pasted an identity rather than
 * recording two real facts), and the Docker image reference is pinned BY
 * DIGEST, never by a floating tag - the whole point of Commit B is to let a
 * stranger re-run Commit A inside the same image and get Commit M back
 * byte-for-byte, and a tag can move under them.
 *
 * WHAT THIS FILE DOES NOT PROVE, ON PURPOSE. It cannot verify that the A/M SHAs
 * it is handed are the REAL commit SHAs, that the recorded tree hash actually
 * matches Commit A's tree, or that the runtime-identity fields actually came
 * from the container that produced M rather than from this host. Those are
 * facts about the outside world, and proving them is real wiring's job - `git
 * rev-parse`/`git cat-file`, and reading a sidecar the container wrote,
 * neither of which belongs in a module this tree's own tests can run with no
 * git repository and no container anywhere near them.
 *
 * Pure: no `child_process`, no filesystem, no clock, no `process.env`.
 */

const crypto = require('crypto');

const { canonicalJson } = require('./snapshotStore');

/** A lowercase, full-length git SHA-1 (or SHA-256, forward-compatible) object id. */
const GIT_SHA_SHAPE = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;

/**
 * A base-image reference pinned BY DIGEST: `name[:tag]@sha256:<64 hex>`,
 * exactly the shape `backtest.Dockerfile` hardcodes (plan section 5: "the
 * digest is resolved once, while authoring the Dockerfile, and hardcoded into
 * it") - `node:24-slim@sha256:...`, tag AND digest together, which is what
 * `docker build`/`docker run` actually accept and what this pipeline's own
 * `FROM` line uses everywhere. The `:tag` segment is OPTIONAL (a bare
 * `name@sha256:...` is also accepted) but a reference with NO digest at all
 * (`node:24-slim`) is still refused - see `assertPinnedByDigest`'s docblock
 * for why a tag alone defeats the whole point of recording this field. An
 * earlier version of this shape omitted the optional `:tag` entirely, which
 * made it reject the pipeline's own real, correctly-pinned reference and
 * made Commit B unproducible - caught only by actually generating one, not
 * by code review or by the shape tests that existed before this fix (both
 * only ever exercised the bare, tagless form).
 */
const IMAGE_DIGEST_SHAPE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127})?@sha256:[0-9a-f]{64}$/;

/** `linux/amd64`, the platform every real run in this pipeline is pinned to (plan sections 5-6). */
const REQUIRED_PLATFORM = 'linux/amd64';

/** The manifest's required top-level fields and their expected JS type. */
const REQUIRED_FIELDS = Object.freeze({
  commitA: 'object',
  commitM: 'object',
  node: 'object',
  os: 'object',
  image: 'object',
  // `typeof [] === 'object'`, so an array satisfies this shape check; the
  // ARRAY shape itself (exactly 3 entries, the 3 preregistered names, no
  // duplicates) is `assertScoringProfiles`'s job below.
  scoringProfiles: 'object',
});

/**
 * The three scoring profiles preregistration 4.3 names, in the order that
 * section lists them. `half-PPR is the formal primary. Standard and full-PPR
 * are no-harm sensitivities. The three profiles differ only in the
 * per-reception value (0.5, 0.0, 1.0)` - these names are exactly
 * `server/services/scoring.service.js`'s `SCORING_PRESETS` keys, so the real
 * wiring (`run-backtest-freeze-manifest.js`) can build this field directly
 * from that export with no translation layer to drift out of step.
 */
const SCORING_PROFILE_NAMES = Object.freeze(['standard', 'half_ppr', 'ppr']);

/** Preregistration 4.3: half-PPR is the formal primary. */
const PRIMARY_SCORING_PROFILE = 'half_ppr';

/** A lowercase SHA-256 hex digest, exactly - not the looser `GIT_SHA_SHAPE` (which also accepts SHA-1). */
const SHA256_HEX_SHAPE = /^[0-9a-f]{64}$/;

function assertShaShape(value, { label }) {
  if (typeof value !== 'string' || !GIT_SHA_SHAPE.test(value)) {
    throw new Error(`${label}: ${JSON.stringify(value)} is not a well-formed git object SHA`);
  }
  return value;
}

/**
 * Fail loud unless `image.ref` is pinned BY DIGEST, at the required platform.
 *
 * A floating tag (`node:24-slim`) is not itself wrong - the Dockerfile HAS to
 * name one to build from - but it is the wrong thing to RECORD here: a tag can
 * be repointed at a different base image tomorrow, silently invalidating the
 * claim "commit A, built inside this exact image, reproduces commit M" for
 * every future reader who cannot know the tag ever moved. Recording the
 * resolved digest is what makes that claim checkable forever.
 */
function assertPinnedByDigest(image, { label = 'freeze manifest' } = {}) {
  if (!image || typeof image !== 'object') throw new Error(`${label}: image must be an object`);
  if (typeof image.ref !== 'string' || !IMAGE_DIGEST_SHAPE.test(image.ref)) {
    throw new Error(
      `${label}: image.ref ${JSON.stringify(image.ref)} is not pinned by digest ` +
      '(expected "name@sha256:<64 hex>"). A floating tag can be repointed at a different base image '
      + 'later, which would silently invalidate the reproducibility claim this manifest exists to record.'
    );
  }
  if (image.platform !== REQUIRED_PLATFORM) {
    throw new Error(
      `${label}: image.platform is ${JSON.stringify(image.platform)}, expected `
      + `${JSON.stringify(REQUIRED_PLATFORM)} - the platform every real run in this pipeline is pinned to`
    );
  }
  return true;
}

/**
 * Validate one commit's identity block: `{ sha, treeSha }` for Commit A, or
 * `{ sha, blobSha }` for Commit M (the MDE artifact's own git blob, not a
 * tree - M is a single-file commit).
 */
function assertCommitIdentity(commit, { label, extraField }) {
  if (!commit || typeof commit !== 'object') throw new Error(`${label}: must be an object`);
  assertShaShape(commit.sha, { label: `${label}.sha` });
  assertShaShape(commit[extraField], { label: `${label}.${extraField}` });
  return true;
}

/**
 * Fail loud unless `scoringProfiles` is exactly the three preregistered
 * entries, each with the exact serialized rules AND a SHA-256 hash that
 * genuinely matches them (prereg 4.3: "their exact serialized rules and
 * SHA-256 hashes are pinned in freeze manifest Commit B").
 *
 * `rules` is stored as the CANONICAL serialization (`canonicalJson`'s own
 * sorted-key, no-whitespace convention) rather than a nested object, so the
 * pinned string is byte-identical to whatever `sha256` was computed over -
 * two representations of the same rules that could drift apart (a re-ordered
 * object vs. its hash) would defeat the point of pinning both. The round-trip
 * check below (`canonicalJson(JSON.parse(rules)) === rules`) is what catches
 * a caller that pinned some OTHER serialization of the same rules.
 */
function assertScoringProfiles(scoringProfiles, { label = 'freeze manifest' } = {}) {
  const where = `${label}.scoringProfiles`;
  if (!Array.isArray(scoringProfiles)) throw new Error(`${where}: must be an array`);
  if (scoringProfiles.length !== SCORING_PROFILE_NAMES.length) {
    throw new Error(
      `${where}: must have exactly ${SCORING_PROFILE_NAMES.length} entries `
      + `(${SCORING_PROFILE_NAMES.join(', ')}), got ${scoringProfiles.length}`
    );
  }
  const seenNames = new Set();
  let primaryCount = 0;
  scoringProfiles.forEach((profile, i) => {
    const entryLabel = `${where}[${i}]`;
    if (!profile || typeof profile !== 'object') throw new Error(`${entryLabel}: must be an object`);
    if (!SCORING_PROFILE_NAMES.includes(profile.name)) {
      throw new Error(
        `${entryLabel}.name: ${JSON.stringify(profile.name)} is not one of `
        + `[${SCORING_PROFILE_NAMES.join(', ')}]`
      );
    }
    if (seenNames.has(profile.name)) {
      throw new Error(`${where}: profile "${profile.name}" appears more than once`);
    }
    seenNames.add(profile.name);

    if (typeof profile.rules !== 'string' || profile.rules.trim() === '') {
      throw new Error(`${entryLabel}.rules: must be a non-empty string - the exact serialized rules`);
    }
    let parsedRules;
    try {
      parsedRules = JSON.parse(profile.rules);
    } catch (err) {
      throw new Error(`${entryLabel}.rules: not valid JSON (${err.message})`);
    }
    if (canonicalJson(parsedRules) !== profile.rules) {
      throw new Error(
        `${entryLabel}.rules: is not the CANONICAL serialization of its own parsed value - key order `
        + 'and formatting must match canonicalJson exactly, or the pinned string and its hash could '
        + 'describe two different byte sequences for what looks like "the same" rules'
      );
    }

    if (typeof profile.sha256 !== 'string' || !SHA256_HEX_SHAPE.test(profile.sha256)) {
      throw new Error(
        `${entryLabel}.sha256: ${JSON.stringify(profile.sha256)} is not a well-formed lowercase `
        + 'SHA-256 hex digest'
      );
    }
    const actualHash = crypto.createHash('sha256').update(profile.rules, 'utf8').digest('hex');
    if (actualHash !== profile.sha256) {
      throw new Error(
        `${entryLabel}.sha256: ${profile.sha256} does not match the SHA-256 of .rules (${actualHash}) - `
        + 'the pinned hash must genuinely be a hash of the pinned bytes, not a stale or hand-typed one'
      );
    }

    if (typeof profile.primary !== 'boolean') {
      throw new Error(`${entryLabel}.primary: must be a boolean`);
    }
    if (profile.primary) {
      primaryCount++;
      if (profile.name !== PRIMARY_SCORING_PROFILE) {
        throw new Error(
          `${entryLabel}: primary=true is set on "${profile.name}", but preregistration 4.3 names `
          + `"${PRIMARY_SCORING_PROFILE}" as the formal primary - standard and full-PPR are no-harm `
          + 'sensitivities, never the primary'
        );
      }
    }
  });
  if (primaryCount !== 1) {
    throw new Error(
      `${where}: exactly one profile must be marked primary (${PRIMARY_SCORING_PROFILE}), found `
      + `${primaryCount}`
    );
  }
  return true;
}

/**
 * Validate the manifest's shape end to end. Throws on the first problem found;
 * returns `true` on success (never a boolean-typed "is it valid", so a caller
 * cannot mistake a missing check for a passing one - the same fail-closed shape
 * every other `assert*` function in this tree uses).
 */
function assertValidManifest(manifest, { label = 'freeze manifest' } = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error(`${label}: must be an object`);
  for (const [field, type] of Object.entries(REQUIRED_FIELDS)) {
    if (typeof manifest[field] !== type || manifest[field] === null) {
      throw new Error(`${label}: missing or malformed required field "${field}" (expected ${type})`);
    }
  }
  assertCommitIdentity(manifest.commitA, { label: `${label}.commitA`, extraField: 'treeSha' });
  assertCommitIdentity(manifest.commitM, { label: `${label}.commitM`, extraField: 'blobSha' });

  // Commit A and Commit M are the freeze's two distinct outputs (plan section
  // 7: "Commit A: ... the control-cell evaluator + MDE CLI code (code only,
  // not its output) ..."; "Commit M (parent = A): only freeze/mde-artifact.json").
  // A manifest naming the same commit SHA for both did not record two facts -
  // it copy-pasted one, which is exactly the kind of self-consistent-but-wrong
  // manifest a byte-compare against it would never catch on its own.
  if (manifest.commitA.sha === manifest.commitM.sha) {
    throw new Error(
      `${label}: commitA.sha and commitM.sha are identical (${manifest.commitA.sha}). They are the `
      + 'freeze sequence\'s two distinct commits - A is the code, M is A\'s child carrying only the '
      + 'MDE artifact - and a manifest naming the same SHA for both has not actually recorded two facts.'
    );
  }

  if (typeof manifest.node.version !== 'string' || manifest.node.version.trim() === '') {
    throw new Error(`${label}: node.version must be a non-empty string`);
  }
  if (typeof manifest.os.platform !== 'string' || typeof manifest.os.arch !== 'string') {
    throw new Error(`${label}: os.platform and os.arch must both be strings`);
  }
  assertPinnedByDigest(manifest.image, { label });
  assertScoringProfiles(manifest.scoringProfiles, { label });

  return true;
}

/**
 * Build the manifest object from its already-gathered parts, validate it, and
 * return the canonical serialization the caller writes to disk.
 *
 * Deliberately takes fully-formed identity blocks rather than raw git/OS
 * strings scattered across parameters, so the REAL-WIRING caller
 * (`run-backtest-freeze-manifest.js`) owns exactly where each fact came from
 * (git, the sidecar, ...) and this function owns only "is the resulting shape
 * complete and self-consistent."
 */
function buildManifest({
  commitA, commitM, node, os, image, scoringProfiles, label = 'freeze manifest',
}) {
  const manifest = {
    commitA, commitM, node, os, image, scoringProfiles,
  };
  assertValidManifest(manifest, { label });
  return manifest;
}

/** The canonical, sorted-key, environment-free-EXCEPT-here serialization written to disk. */
function serializeManifest(manifest) {
  assertValidManifest(manifest);
  return `${canonicalJson(manifest)}\n`;
}

module.exports = {
  GIT_SHA_SHAPE,
  IMAGE_DIGEST_SHAPE,
  REQUIRED_PLATFORM,
  REQUIRED_FIELDS,
  SCORING_PROFILE_NAMES,
  PRIMARY_SCORING_PROFILE,
  SHA256_HEX_SHAPE,
  assertShaShape,
  assertPinnedByDigest,
  assertCommitIdentity,
  assertScoringProfiles,
  assertValidManifest,
  buildManifest,
  serializeManifest,
};
