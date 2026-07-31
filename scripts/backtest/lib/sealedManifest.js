'use strict';

/**
 * Shared helpers for binding untrusted, mutable manifest data to the SEALED
 * Gate-2 snapshot manifest's own `sources`/`datasets` arrays.
 *
 * Used by BOTH `package-snapshot.js` (binding a freshly-read raw source file
 * on disk against the sealed manifest at PACKAGE time) and `rehydrate.js`
 * (binding a rehydrated, chunk-reassembled source/dataset against the same
 * sealed manifest at REHYDRATE time). Written once here so the two are
 * structurally guaranteed to apply an IDENTICAL binding, rather than risk two
 * independently-invented (and possibly differently weak) versions - the
 * exact class of gap a round 4 review found between this project's packager
 * and rehydrator over root-safety checks (see `lib/rootSafety.js`'s
 * docblock: hardening one consumer never automatically hardens a sibling).
 *
 * ROUND 6 (third review round): a third-party review found that binding
 * individual sources/datasets by NAME to the sealed manifest was not enough
 * on its own - a manifest that simply OMITS an entry (a source, a dataset)
 * from the mutable, attacker-controlled publication manifest.json is never
 * iterated at all by a loop keyed off "whatever manifest.json lists," so
 * nothing ever notices the omission. The fix is a SEPARATE, explicit
 * exact-set-equality check (`assertExactNameSets`), run BEFORE anything is
 * read for either set, independent of whatever the per-entry binding checks.
 */

const { SOURCES } = require('./sources');

/**
 * Build `name -> { sha256, byteLength, file }` from the sealed manifest's OWN
 * `sources` array, and structurally validate it against the frozen `SOURCES`
 * registry (both directions: no missing, no extra, and each `file` matches)
 * as an independent THIRD anchor - not "is this internally consistent" but
 * "does this match the fixed set of ten sources this whole pipeline is
 * defined over." Throws on: a missing/empty sources array, a duplicate name,
 * or any disagreement with the frozen registry.
 */
function buildSealedSourcesMap(sealedSourcesArray, { label = 'sealed manifest' } = {}) {
  if (!Array.isArray(sealedSourcesArray) || sealedSourcesArray.length === 0) {
    throw new Error(`${label}: records no sources - it cannot be used to independently pin raw source identity`);
  }
  const map = new Map();
  for (const record of sealedSourcesArray) {
    const name = String(record.name);
    if (map.has(name)) {
      throw new Error(`${label}: duplicate source name ${JSON.stringify(name)} - refusing an ambiguous sealed record`);
    }
    map.set(name, {
      sha256: String(record.sha256),
      byteLength: Number(record.byteLength),
      file: String(record.file),
    });
  }
  const registryNames = new Set(SOURCES.map((s) => s.name));
  const sealedNames = new Set(map.keys());
  const missingFromSealed = [...registryNames].filter((n) => !sealedNames.has(n));
  const extraInSealed = [...sealedNames].filter((n) => !registryNames.has(n));
  if (missingFromSealed.length > 0 || extraInSealed.length > 0) {
    throw new Error(
      `${label}: sources ${JSON.stringify([...sealedNames].sort())} do not exactly match the frozen ` +
      `SOURCES registry ${JSON.stringify([...registryNames].sort())} - missing ` +
      `${JSON.stringify(missingFromSealed)}, extra ${JSON.stringify(extraInSealed)}`
    );
  }
  for (const source of SOURCES) {
    const sealed = map.get(source.name);
    if (sealed.file !== source.file) {
      throw new Error(
        `${label}: source ${source.name} records filename ${JSON.stringify(sealed.file)}, the frozen ` +
        `SOURCES registry (scripts/backtest/lib/sources.js) expects ${JSON.stringify(source.file)}`
      );
    }
  }
  return map;
}

/**
 * Build `dataset -> { store, path, rowCount, byteLength, sha256, seasonScoped
 * }` from the sealed manifest's OWN `datasets` array. Unlike sources, there is
 * no fixed compile-time registry of dataset names to check against (the
 * dataset list is whatever a given Gate-2 extraction actually captured -
 * oracle datasets in particular vary by which weeks were preregistered), so
 * this only guards against a missing/empty array and a duplicate name;
 * exact-set equality against the PUBLICATION manifest's own datasets is
 * enforced separately by `assertExactNameSets`, once both are available.
 */
function buildSealedDatasetsMap(sealedDatasetsArray, { label = 'sealed manifest' } = {}) {
  if (!Array.isArray(sealedDatasetsArray) || sealedDatasetsArray.length === 0) {
    throw new Error(`${label}: records no datasets - it cannot be used to independently pin dataset identity`);
  }
  const map = new Map();
  for (const record of sealedDatasetsArray) {
    const name = String(record.dataset);
    if (map.has(name)) {
      throw new Error(`${label}: duplicate dataset name ${JSON.stringify(name)} - refusing an ambiguous sealed record`);
    }
    map.set(name, {
      store: String(record.store),
      path: String(record.path),
      rowCount: Number(record.rowCount),
      byteLength: Number(record.byteLength),
      sha256: String(record.sha256),
      seasonScoped: Boolean(record.seasonScoped),
    });
  }
  return map;
}

/**
 * Require `candidateNames` (from the mutable, untrusted publication
 * manifest.json) to be EXACTLY `sealedNames` (from the sealed, independently-
 * pinned manifest) - as sets: no missing entry (which would let a whole
 * dataset/source silently go unrehydrated/unverified, since nothing else
 * iterates "what the sealed manifest says should exist," only "what the
 * candidate manifest happens to list"), no extra entry, and no duplicate on
 * either side. Checked purely against the two in-memory name lists, before
 * anything is read from disk for either one.
 */
function assertExactNameSets({ sealedNames, candidateNames, kind, label }) {
  const sealedSet = new Set(sealedNames);
  if (sealedSet.size !== sealedNames.length) {
    throw new Error(`${label}: the SEALED manifest itself has a duplicate ${kind} name - refusing an ambiguous record`);
  }
  const candidateSet = new Set(candidateNames);
  if (candidateSet.size !== candidateNames.length) {
    throw new Error(`${label}: the publication manifest has a duplicate ${kind} name`);
  }
  const missing = [...sealedSet].filter((n) => !candidateSet.has(n));
  const extra = [...candidateSet].filter((n) => !sealedSet.has(n));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label}: the publication manifest's ${kind} set does not exactly match the sealed manifest's - ` +
      `missing ${JSON.stringify(missing)}, extra ${JSON.stringify(extra)}. A publication manifest that ` +
      `silently omits a ${kind} the sealed manifest has (or invents one it does not) must be refused ` +
      'before anything is read for either, not discovered later by what happens to be missing from the output.'
    );
  }
}

module.exports = {
  buildSealedSourcesMap,
  buildSealedDatasetsMap,
  assertExactNameSets,
};
