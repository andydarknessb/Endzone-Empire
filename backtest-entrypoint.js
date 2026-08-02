'use strict';

/**
 * The container's own orchestration script (plan Step 5), baked into
 * `backtest.Dockerfile` at `/entrypoint/backtest-entrypoint.js` - the one
 * file this image carries that is not supplied by a run-time mount. Runs the
 * freeze sequence's offline steps, IN THIS ORDER, and aborts the container on
 * the first failure:
 *
 *   1. canaries (`run-backtest-canaries.js`) - if ANY route out is reachable,
 *      nothing else in this container may run at all.
 *   2. rehydrate the mounted `backtest-data/publish/` tree to a WRITABLE
 *      container-local scratch path - both other mounts (`/worktree`, and
 *      the dependency volume mounted at `/worktree/node_modules`) are
 *      read-only, so rehydration cannot write back into either.
 *   3. write the runtime-identity sidecar into the writable OUTPUT mount -
 *      Node/npm versions read from INSIDE this running container, plus the
 *      base image digest and platform baked into `backtest.Dockerfile`. This
 *      is the ONLY legitimate source of "what actually produced M" for
 *      Commit B's manifest; `run-backtest-freeze-manifest.js` runs on the
 *      HOST afterward and must never substitute its own `process.version`/
 *      OS-arch for this, which would assert a falsehood.
 *   4. `run-backtest-rosters.js` against the rehydrated tree, writing into a
 *      subdirectory of the output mount (`<output>/artifacts/`) - the
 *      `roster-weeks/` and `cohort-weeks/` directories `run-backtest-mde.js`
 *      consumes next.
 *   5. byte-compare every regenerated roster/cohort/index byte against the
 *      committed Commit-A artifact tree, rejecting missing or extra files.
 *   6. `run-backtest-mde.js` against the rehydrated tree plus the COMMITTED,
 *      byte-verified roster/cohort artifacts, writing
 *      `<output>/mde-artifact.json` - the file that becomes freeze Commit M
 *      once copied out of this mount into the working tree, on the host,
 *      after the container exits.
 *
 * MOUNT CONTRACT (fixed paths, matching `backtest-reproduction.yml` and any
 * local `docker run` invocation of this image):
 *   /worktree                - the detached worktree checked out at Commit A, READ-ONLY
 *   /worktree/node_modules   - the dependency volume, READ-ONLY
 *   /output                  - a dedicated, writable, host-bound directory
 *
 * Every real script this file shells out to already enforces its own
 * required-argument, no-defaults discipline (see each script's own
 * docblock); this file supplies the concrete paths for the fixed mount
 * contract above and nothing else. It does not itself touch
 * `scripts/backtest/**` (which may not depend on `child_process` or
 * `process.env`) - it lives outside that guarded tree, alongside
 * `server/scripts/*`, for the same reason those files do.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKTREE = '/worktree';
const OUTPUT = '/output';
const SCRATCH = '/tmp/backtest-rehydrated';
const COMMITTED_ARTIFACTS = path.join(
  WORKTREE, 'backtest-artifacts', 'pit-sweep-2024-2025'
);

/**
 * The base image digest and platform, HARDCODED here to match
 * `backtest.Dockerfile`'s `FROM` line exactly - the same coupling the
 * Dockerfile's own docblock documents. This is the one piece of "runtime
 * identity" that cannot be read off `process.*` from inside the running
 * container (nothing in Node exposes the image it is running in), so it is
 * duplicated by hand rather than invented. If `backtest.Dockerfile`'s base
 * image ever changes, this line must change with it - not asserted by any
 * automated check, so a reviewer changing one must remember the other.
 */
const IMAGE_REF = 'node:24-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7';
const IMAGE_PLATFORM = 'linux/amd64';

function assertDockerfileImageIdentity(dockerfileText, { label = 'backtest.Dockerfile' } = {}) {
  const fromLines = String(dockerfileText).match(/^FROM\s+(\S+)\s*$/gm) || [];
  if (fromLines.length !== 1) {
    throw new Error(`${label}: expected exactly one FROM line, found ${fromLines.length}`);
  }
  const actualRef = fromLines[0].replace(/^FROM\s+/, '').trim();
  if (actualRef !== IMAGE_REF) {
    throw new Error(
      `${label}: base image ${actualRef} does not match the runtime-identity pin ${IMAGE_REF}`
    );
  }
  return true;
}

function run(label, command, args) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);
  // command is always a hardcoded literal ('node') at every call site in this
  // file, never external/user-supplied input.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, { cwd: WORKTREE, stdio: 'inherit' });
  if (result.error) {
    console.error(`FAILED: ${label} could not be spawned: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`FAILED: ${label} exited ${result.status}`);
    process.exit(result.status || 1);
  }
}

function readCapturedVersion(command, args) {
  // command is always a hardcoded literal ('npm') at every call site in this
  // file, never external/user-supplied input.
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const result = spawnSync(command, args, { cwd: WORKTREE, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`could not read ${command} ${args.join(' ')} version: ${result.error ? result.error.message : result.stderr}`);
  }
  return result.stdout.trim();
}

function filesBelow(root, relative = '', result = []) {
  // relative accumulates only from entry.name below, a dirent name
  // fs.readdirSync itself just reported as existing under directory - not
  // external input.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  const directory = path.join(root, relative);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    // entry.name is a dirent name fs.readdirSync itself just reported as
    // existing under directory - not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) filesBelow(root, child, result);
    else if (entry.isFile()) result.push(child.split(path.sep).join('/'));
    else throw new Error(`artifact tree ${root} contains unsupported entry ${child}`);
  }
  return result.sort();
}

function assertArtifactTreesByteIdentical({ committedDir, regeneratedDir }) {
  const committedFiles = filesBelow(committedDir).filter((file) => (
    file === 'index.json' || file.startsWith('roster-weeks/') || file.startsWith('cohort-weeks/')
  ));
  const regeneratedFiles = filesBelow(regeneratedDir);
  if (JSON.stringify(committedFiles) !== JSON.stringify(regeneratedFiles)) {
    throw new Error(
      `Commit-A artifact paths differ from regenerated paths: committed=${JSON.stringify(committedFiles)} `
      + `regenerated=${JSON.stringify(regeneratedFiles)}`
    );
  }
  for (const relative of committedFiles) {
    // relative comes from filesBelow(committedDir) above, itself built only
    // from dirent names - not external input.
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const committed = fs.readFileSync(path.join(committedDir, relative));
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
    const regenerated = fs.readFileSync(path.join(regeneratedDir, relative));
    if (!committed.equals(regenerated)) {
      throw new Error(`Commit-A artifact is not byte-identical after regeneration: ${relative}`);
    }
  }
  return committedFiles.length;
}

function main() {
  assertDockerfileImageIdentity(
    fs.readFileSync(path.join(WORKTREE, 'backtest.Dockerfile'), 'utf8')
  );

  // --- 1. Canaries: must all report BLOCKED, or this container aborts before
  // touching anything else. Real socket/pool/pg-client probes; see
  // server/scripts/run-backtest-canaries.js. ---
  run(
    'canaries',
    'node',
    [path.join(WORKTREE, 'server/scripts/run-backtest-canaries.js')]
  );

  // --- 2. Rehydrate the committed publication tree to a writable scratch
  // path. Both /worktree and /worktree/node_modules are read-only mounts. ---
  fs.mkdirSync(SCRATCH, { recursive: true });
  const rehydratedSnapshot = path.join(SCRATCH, 'snapshot');
  const rehydratedSources = path.join(SCRATCH, 'sources');
  run(
    'rehydrate',
    'node',
    [
      path.join(WORKTREE, 'server/scripts/run-backtest-rehydrate.js'),
      '--publish', path.join(WORKTREE, 'backtest-data/publish'),
      '--out-snapshot', rehydratedSnapshot,
      '--out-sources', rehydratedSources,
    ]
  );

  // --- 3. Runtime-identity sidecar, written into the OUTPUT mount. This is
  // the only place Node/npm versions and the image digest+platform are ever
  // recorded for the freeze - never inside mde-artifact.json itself (which
  // must be environment-free), and never re-derived on the host later. ---
  fs.mkdirSync(OUTPUT, { recursive: true });
  const sidecar = {
    nodeVersion: process.version,
    npmVersion: readCapturedVersion('npm', ['--version']),
    platform: process.platform,
    arch: process.arch,
    imageRef: IMAGE_REF,
    imagePlatform: IMAGE_PLATFORM,
  };
  for (const [field, value] of Object.entries(sidecar)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`backtest-entrypoint: runtime-identity field "${field}" resolved empty - refusing to write a sidecar with a hole in it`);
    }
  }
  const sidecarPath = path.join(OUTPUT, 'runtime-identity.json');
  fs.writeFileSync(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
  console.log(`\n=== runtime-identity sidecar ===\nwrote ${sidecarPath}`);
  console.log(JSON.stringify(sidecar, null, 2));

  // --- 4. Rosters + cohort artifacts (Step 1), against the rehydrated tree,
  // into a scratch subdirectory of the output mount. ---
  const artifactsDir = path.join(OUTPUT, 'artifacts');
  run(
    'run-backtest-rosters',
    'node',
    [
      path.join(WORKTREE, 'server/scripts/run-backtest-rosters.js'),
      '--rehydrated-snapshot', rehydratedSnapshot,
      '--rehydrated-sources', rehydratedSources,
      '--out', artifactsDir,
    ]
  );

  const comparedArtifactCount = assertArtifactTreesByteIdentical({
    committedDir: COMMITTED_ARTIFACTS,
    regeneratedDir: artifactsDir,
  });
  console.log(`\n=== Commit-A artifact byte-compare ===\nverified ${comparedArtifactCount} files`);

  // --- 6. The blinded, control-only MDE artifact (Step 3) - the file that
  // becomes freeze Commit M once the host copies it out of /output. ---
  const mdeOut = path.join(OUTPUT, 'mde-artifact.json');
  run(
    'run-backtest-mde',
    'node',
    [
      path.join(WORKTREE, 'server/scripts/run-backtest-mde.js'),
      '--rehydrated-snapshot', rehydratedSnapshot,
      '--rehydrated-sources', rehydratedSources,
      '--rosters', path.join(COMMITTED_ARTIFACTS, 'roster-weeks'),
      '--cohort', path.join(COMMITTED_ARTIFACTS, 'cohort-weeks'),
      '--out', mdeOut,
    ]
  );

  console.log('\n=== backtest-entrypoint: complete ===');
}

if (require.main === module) main();

module.exports = {
  IMAGE_REF,
  IMAGE_PLATFORM,
  assertDockerfileImageIdentity,
  filesBelow,
  assertArtifactTreesByteIdentical,
  main,
};
