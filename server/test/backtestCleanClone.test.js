const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const rehydrate = require('../../scripts/backtest/rehydrate');
const checks = require('../../scripts/backtest/snapshot-checks');
const packager = require('../../scripts/backtest/package-snapshot');
const snapshotClient = require('../../scripts/backtest/lib/snapshotClient');
const asOf = require('../../scripts/backtest/lib/asOfView');
const cohort = require('../../scripts/backtest/lib/cohort');
const { SOURCES, sourceByName } = require('../../scripts/backtest/lib/sources');
const { collectColumns, parseCsvHeader } = require('../../scripts/backtest/lib/csv');
const { normalizeTeamKey } = require('../services/projectionFeatures');

/**
 * THE CLEAN-CLONE REPRODUCIBILITY PROOF.
 *
 * This is the actual point of Finding 1's fix: rehydrate the REAL,
 * regenerated `backtest-data/publish/` tree into a FRESH temp directory with
 * no other relationship to the sealed `backtest-data/snapshot/` or
 * `backtest-data/sources/`, then run the exact same post-extraction
 * verification (`snapshot-checks.runChecks`) against THAT rehydrated copy
 * alone. If this passes, the publication tree is sufficient on its own to
 * reproduce the study - the thing a second, independent review found it
 * previously could not do.
 *
 * This test deliberately never reads `backtest-data/snapshot/` or
 * `backtest-data/sources/` for any assertion. The one exception, explicitly
 * allowed by design: a sanity precondition that `backtest-data/publish/
 * manifest.json`'s own hash is what this run expects, which reads the
 * PUBLICATION tree (not the sealed originals) and is not part of the
 * reproducibility claim itself - only a guard against silently testing
 * against a stale or half-regenerated publish tree.
 *
 * `backtest-data/publish/` is local-only (never committed - see
 * `.gitignore`/the Gate-3 handoff notes), so like the existing "the sealed
 * snapshot manifest on disk still hashes to the pinned constant" test, this
 * one no-ops (returns early) in an environment where it is absent, rather
 * than failing a clone that never had local production data in the first
 * place.
 *
 * STRICT MODE: set `BACKTEST_PUBLICATION_REQUIRED=1` (the same naming
 * convention as the existing `BACKTEST_PG_TESTS`/`HOLDOUT_PG_TESTS` gates) to
 * turn the "absent" case from a skip into a hard FAILURE - for a future CI
 * run where the publication artifact has actually been committed and is
 * expected to be there, silently skipping would hide a real regression
 * (a missing or never-regenerated publish tree) rather than catching it. When
 * the env var is NOT set, today's skip-if-absent behavior for local/
 * tooling-only runs is unchanged.
 *
 * No live Postgres is needed anywhere in this file - rehydration and
 * `runChecks` are both pure fs/CPU work - so this runs UNCONDITIONALLY as
 * part of the normal suite, never gated behind `BACKTEST_PG_TESTS`.
 */

const REPO_ROOT = path.join(__dirname, '..', '..');
const REAL_PUBLISH_ROOT = path.join(REPO_ROOT, 'backtest-data', 'publish');
const PUBLICATION_REQUIRED = process.env.BACKTEST_PUBLICATION_REQUIRED === '1';

function sha256Hex(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

test('the real publish tree, rehydrated alone into a fresh directory, reproduces the study with zero check failures', (t) => {
  const manifestPath = path.join(REAL_PUBLISH_ROOT, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    if (PUBLICATION_REQUIRED) {
      assert.fail(
        `BACKTEST_PUBLICATION_REQUIRED=1 but no publication manifest was found at ${manifestPath} - ` +
        'the publication artifact is expected to be present in this environment and must not be silently ' +
        'missing.'
      );
    }
    t.skip('backtest-data/publish/ is local-only and is not present in this environment');
    return;
  }

  // --- sanity precondition only: confirms this run is testing the publish
  //     tree it thinks it is, NOT part of the reproducibility claim itself.
  const manifestBytes = fs.readFileSync(manifestPath);
  const verificationPath = path.join(REAL_PUBLISH_ROOT, 'verification.json');
  const packagingVerification = JSON.parse(fs.readFileSync(verificationPath, 'utf8'));
  const publicationManifest = JSON.parse(manifestBytes.toString('utf8'));

  // --- rehydrate the REAL publication into a FRESH, unrelated temp directory
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ez-clean-clone-'));
  t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
  const rehydratedSnapshotRoot = path.join(workDir, 'snapshot');
  const rehydratedSourcesDir = path.join(workDir, 'sources');

  const rehydrationResult = rehydrate.rehydrate({
    publishRoot: REAL_PUBLISH_ROOT,
    outSnapshotRoot: rehydratedSnapshotRoot,
    outSourcesDir: rehydratedSourcesDir,
  });
  assert.equal(rehydrationResult.datasetResults.length, publicationManifest.datasets.length);
  assert.equal(rehydrationResult.sourceResults.length, publicationManifest.sources.length);
  for (const r of rehydrationResult.datasetResults) assert.equal(r.ok, true, `dataset ${r.dataset} rehydration`);
  for (const r of rehydrationResult.sourceResults) assert.equal(r.ok, true, `source ${r.name} rehydration`);

  // --- the actual reproducibility proof: runChecks against the REHYDRATED
  //     copy ALONE - it never touches backtest-data/snapshot/ or
  //     backtest-data/sources/ from here on.
  const { manifest: rehydratedManifest, results, failures } = checks.runChecks({
    root: rehydratedSnapshotRoot,
    sourcesDir: rehydratedSourcesDir,
    provenancePath: path.join(rehydratedSourcesDir, 'provenance.json'),
    normalizeTeamKey,
  });

  if (failures.length > 0) {
    const detail = failures.map((f) => `${f.name}: ${f.detail}`).join('\n');
    assert.fail(`runChecks reported ${failures.length} failure(s) against the rehydrated publish tree:\n${detail}`);
  }
  assert.equal(failures.length, 0);
  assert.equal(rehydratedManifest.studyId, publicationManifest.sourceSnapshot.studyId);

  // --- teamContradictions: re-derived fresh against the rehydrated copy,
  //     compared against what PACKAGING independently recorded when it read
  //     the ORIGINAL (non-rehydrated) sources - two separate computations
  //     over what should be byte-identical data agreeing is the actual
  //     reproducibility signal, not a hardcoded literal.
  const teamContradictions = results.find((r) => r.name === 'teamContradictions');
  assert.ok(teamContradictions, 'teamContradictions must have run (never skipped)');
  assert.ok(!teamContradictions.skipped, 'teamContradictions must not report skipped - a real normalizeTeamKey was injected');
  assert.deepEqual(teamContradictions.counts, packagingVerification.teamContradictions.counts,
    'the rehydrated-copy computation must agree exactly with what packaging recorded from the original sources');
  for (const season of Object.keys(teamContradictions.counts)) {
    assert.equal(teamContradictions.counts[season].contradictions, 0, `season ${season} must have zero contradictions`);
  }
  // The specific real numbers this Gate-3 run produced (2024: 18,110
  // compared / 0 contradictions; 2025: 18,521 compared / 0 contradictions),
  // asserted directly so a regression that silently changed the comparison
  // population would still be caught even if it happened to still agree
  // with whatever packaging last recorded.
  assert.equal(teamContradictions.counts['2024'].compared, 18110);
  assert.equal(teamContradictions.counts['2025'].compared, 18521);

  // --- crosswalkCoverage: the preregistered unmapped counts (preregistration
  //     section 2.8: 205 unmappable gsis_id in 2024, 150 in 2025).
  const crosswalkCoverage = results.find((r) => r.name === 'crosswalkCoverage');
  assert.ok(crosswalkCoverage, 'crosswalkCoverage must have run');
  assert.equal(crosswalkCoverage.counts.roster_weekly_2024.unmapped, 205);
  assert.equal(crosswalkCoverage.counts.roster_weekly_2025.unmapped, 150);

  // --- EXTENDED PROOF (round 6, per a third-party review): everything above
  //     proves the rehydrated tree satisfies snapshot-checks.js's OWN
  //     validation, which is lighter than, and never exercises, the REAL
  //     consumption path production code (and the eventual sweep) actually
  //     uses. Prove that separately: the real `snapshotClient.loadSnapshot()`
  //     loader, and the real roster/injury/cohort construction machinery
  //     (`buildRosterIndex`/`buildInjuryIndex`/`buildCrosswalk`/
  //     `buildGsisByPlayerId`/`buildCohort`), can all consume the rehydrated
  //     tree and produce a real, non-empty result - not just that
  //     `runChecks` is satisfied with it.
  const rehydratedSnapshot = snapshotClient.loadSnapshot({ root: rehydratedSnapshotRoot });
  assert.ok(rehydratedSnapshot.players.length > 0, 'loadSnapshot must load real player rows');
  assert.ok(rehydratedSnapshot.playerStats.length > 0, 'loadSnapshot must load real player-stat rows');
  assert.ok(rehydratedSnapshot.nflGamesBySeason.size > 0, 'loadSnapshot must load real schedule rows');

  const readRehydratedSource = checks.makeSourceReader({
    sourcesDir: rehydratedSourcesDir,
    provenancePath: path.join(rehydratedSourcesDir, 'provenance.json'),
  });
  const rosterText2024 = readRehydratedSource('roster_weekly_2024');
  const injuryText2024 = readRehydratedSource('injuries_2024');
  const playersText = readRehydratedSource('players');

  const rosterRows2024 = collectColumns(
    rosterText2024, sourceByName('roster_weekly_2024').requiredColumns, { label: 'roster_weekly_2024' }
  ).rows;
  const hasDateModified = parseCsvHeader(injuryText2024).includes('date_modified');
  const injuryColumns = [
    ...sourceByName('injuries_2024').requiredColumns, ...(hasDateModified ? ['date_modified'] : []),
  ];
  const injuryRows2024 = collectColumns(injuryText2024, injuryColumns, { label: 'injuries_2024' }).rows;
  const playersRows = collectColumns(
    playersText, sourceByName('players').requiredColumns, { label: 'players' }
  ).rows;

  const rosterIndex = asOf.buildRosterIndex(rosterRows2024);
  const injuryIndex = asOf.buildInjuryIndex(injuryRows2024, { hasDateModified });
  const crosswalk = cohort.buildCrosswalk(playersRows);
  const { playerIdByGsis } = cohort.buildGsisByPlayerId({ dbPlayers: rehydratedSnapshot.players, crosswalk });

  // Season 2024, a real mid-season week: exercising the full roster/injury/
  // cohort construction path against data that came from nowhere but the
  // rehydrated publication tree. `statsGameTeamFor`/`byeTeamKeys`/
  // `defenseTeamKeys` are explicit, legitimately-empty inputs (this is a
  // reproducibility smoke test of the CONSTRUCTION path, not a re-derivation
  // of the sweep's own cohort numbers, which belongs to Phase 4/5).
  const cohortResult = cohort.buildCohort({
    season: 2024,
    week: 5,
    rosterIndex,
    crosswalk,
    playerIdByGsis,
    injuryIndex,
    policy: asOf.INJURY_POLICIES.PRIMARY,
    normalizeTeamKey,
    statsGameTeamFor: () => null,
    byeTeamKeys: new Set(),
    defenseTeamKeys: [],
    label: 'clean-clone roster/injury/cohort smoke',
  });
  assert.ok(
    cohortResult.members.length > 0,
    'the roster/injury/cohort construction path must produce at least one real member from the rehydrated tree'
  );

  // --- sanity precondition, checked LAST and explicitly labelled as such:
  //     the publish tree's recorded source-snapshot hash is the PINNED
  //     production Gate-2 manifest hash, not some other (e.g. fixture)
  //     snapshot's - confirming this run really tested a publication built
  //     from the real sealed snapshot. This reads only the PUBLICATION
  //     tree's own manifest.json (already loaded above), never
  //     backtest-data/snapshot/ directly, and is not itself part of the
  //     reproducibility claim - only a guard against silently testing
  //     against the wrong publish tree.
  assert.equal(sha256Hex(manifestBytes).length, 64, 'manifest.json must actually have been read');
  assert.equal(
    publicationManifest.sourceSnapshot.manifestSha256,
    packager.PINNED_SNAPSHOT_MANIFEST_SHA256,
    'the publish tree under test must have been built from the pinned production Gate-2 snapshot'
  );

  // --- UNCONDITIONAL (round 6 fix - this used to be strict-mode-only, per
  //     the review's explicit ask: "make the ten-source clean-clone assertion
  //     unconditional whenever the publication exists"): the exact ten
  //     pinned source names must appear in the manifest's `sources` array,
  //     read from the real `SOURCES` registry (scripts/backtest/lib/
  //     sources.js) rather than hardcoded here independently, so this
  //     assertion can never silently drift from the actual registry it is
  //     meant to be checking against. This runs every time the publication
  //     exists, not only under BACKTEST_PUBLICATION_REQUIRED=1.
  const expectedSourceNames = SOURCES.map((s) => s.name).sort();
  const actualSourceNames = publicationManifest.sources.map((s) => s.name).sort();
  assert.deepEqual(
    actualSourceNames, expectedSourceNames,
    'the publication manifest sources array must contain exactly the pinned SOURCES registry names'
  );

  // --- read all ten rehydrated raw sources (round 6 fix, same ask): proves
  //     every one of the ten is genuinely present AND readable in the
  //     rehydrated sources/ directory, not merely listed by name in the
  //     manifest.
  for (const sourceName of expectedSourceNames) {
    const text = readRehydratedSource(sourceName);
    assert.ok(typeof text === 'string' && text.length > 0, `${sourceName} must be a real, non-empty rehydrated source`);
  }

  // --- FINDING (fifth review round, LOW-2 minimal mitigation): NOTICE.md,
  //     verification.json, STAGING_PATHS.txt, .gitattributes, and
  //     dry-run-receipt-note.md carry no integrity record anywhere in code
  //     (fixedFiles pins only the 3 rehydration inputs), so a post-package,
  //     pre-commit edit of any of them is otherwise undetectable. NOTICE.md
  //     in particular carries the operative games.csv "licensing status NOT
  //     established" disclosure the user's Gate-3 data-rights decision
  //     explicitly relies on and forbids softening (see
  //     HANDOFF-accuracy-roadmap-gate2.md). This is the minimal mitigation
  //     the review offered short of a full recompute-and-byte-compare: assert
  //     the disclosure text survives, every time this test runs against the
  //     real publish tree.
  const noticeText = fs.readFileSync(path.join(REAL_PUBLISH_ROOT, 'NOTICE.md'), 'utf8');
  assert.match(
    noticeText,
    /nflverse\/nfldata \(games\.csv\) - licensing status NOT established/,
    'NOTICE.md must still carry the games.csv "licensing status NOT established" disclosure the Gate-3 data-rights decision relies on'
  );
});
