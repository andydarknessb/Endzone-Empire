# Stale worktree directories

A worktree directory that has been emptied (e.g. by manually deleting its
files) but not properly removed still exists as a registered worktree on
disk. `npm` run from inside a directory with no `package.json` walks *up*
the directory tree looking for one — so a command run inside an emptied
worktree directory finds and runs the **parent** repository's
`package.json` against the **main checkout**, not the worktree path you
think you're standing in.

This produced a false negative during the #171 investigation: a plain
`npm test` from inside an emptied `.claude/worktrees/<name>` directory
reported the main checkout's full suite passing, exit 0 — which looked
like the bug (see below) being path-dependent, when in fact the command
never touched that path at all.

Before trusting a test run's working directory, confirm the directory
still holds real worktree content (`git status` from inside it, or `git
worktree list` from the main checkout). Clear a stale entry with:

```
git worktree prune
```

## Related: test discovery inside a worktree (issue #171)

Before `package.json` pinned a `jest.testMatch`, `npm test`'s discovery
came entirely from Create React App's defaults, which are derived from
`<rootDir>` — an absolute path built from the caller's working directory.
On Windows, a worktree path nested under a dot-prefixed directory
(`...\Endzone-Empire\.claude\worktrees\<name>`) broke that derivation: the
path separator immediately before `.claude` looks like an intentional
glob escape (`\.`) to jest-util's `replacePathSepForGlob`, so it survives
un-converted while every other separator becomes `/`. micromatch then
reads that same backslash as an escape character while compiling the
resulting glob, which drops it from the pattern entirely — so the
compiled pattern requires "Endzone-Empire.claude" with no separator at
all, which no real path has. Discovery silently found zero tests and
`npm test` exited 1.

`package.json`'s `jest.testMatch` is now pinned to relative, `**/`-prefixed
patterns (`**/src/**/*.{spec,test}.{js,jsx,ts,tsx}` and the `__tests__`
form) instead of the `<rootDir>`-based defaults, so discovery no longer
depends on where the repo is checked out. `scripts/jestTestMatch.test.js`
guards against a regression back to a `<rootDir>`-based pattern.
