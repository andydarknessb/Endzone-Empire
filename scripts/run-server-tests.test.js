const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { REPO_ROOT, buildNodeTestSpawn } = require('./run-server-tests');

// Issue #1049. From a `.claude/worktrees/<slug>/` checkout the absolute test
// paths pushed the `node --test` argv to ~34 KB, over the Windows command-length
// limit, so `spawn` threw ENAMETOOLONG synchronously and `npm run test:server`
// died with a stack trace before running a single test. The runner now passes
// each file as a path relative to REPO_ROOT and spawns with `cwd: REPO_ROOT`,
// which `node --test` resolves to the same files with a much shorter argv.
//
// This guard binds that shape so a future edit that reintroduces absolute paths
// (e.g. `path.join(TEST_DIR, name)`) or drops the `cwd` goes red here, in CI's
// `guards` job, rather than only on a developer's deep worktree.
//
// It exercises the real builder for every mode, so the assertion is over the
// paths the runner would actually spawn, not a hand-built sample.
for (const mode of ['fast', 'sweep', 'all']) {
  test(`node:test ${mode} set: no absolute path in argv, and spawn cwd is REPO_ROOT`, () => {
    const { command, args, options } = buildNodeTestSpawn(mode);

    assert.equal(command, process.execPath, 'node:test set must spawn the node binary');
    assert.equal(options && options.cwd, REPO_ROOT, `mode "${mode}" must spawn with cwd === REPO_ROOT`);

    // Every argument that names a test file must be relative. The flags
    // (--test, --test-timeout=...) are not paths; the file arguments are the
    // ones under server/test.
    const fileArgs = args.filter((a) => a.includes(`server${path.sep}test`) || a.includes('server/test'));
    assert.ok(fileArgs.length > 0, `mode "${mode}" selected no test files`);
    for (const arg of fileArgs) {
      assert.ok(
        !path.isAbsolute(arg),
        `mode "${mode}" built an absolute test path: ${arg}. Pass files relative to ` +
          'REPO_ROOT (path.join(\'server\', \'test\', name)) and keep cwd: REPO_ROOT, or a deep ' +
          '.claude/worktrees checkout will ENAMETOOLONG on spawn again (issue #1049).'
      );
    }

    // And the relative paths must resolve, against REPO_ROOT, back to real
    // server/test files -- relative + wrong cwd would silently run nothing.
    for (const arg of fileArgs) {
      const resolved = path.resolve(options.cwd, arg);
      assert.ok(
        resolved.startsWith(path.join(REPO_ROOT, 'server', 'test') + path.sep),
        `resolved test path escaped server/test: ${resolved}`
      );
    }
  });
}
