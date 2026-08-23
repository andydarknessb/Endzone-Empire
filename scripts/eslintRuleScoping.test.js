const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ESLint } = require('eslint');

// Issue #207: the `eslintConfig` block in package.json extended `react-app/jest`
// at the top level. That preset declares the `testing-library/*` rules inside an
// override whose file globs are unanchored -- `**/__tests__/**/*` and
// `**/*.{spec,test}.*` -- so they matched `server/test/*.test.js` just as
// readily as anything under `src/`. Server tests run under `node --test` with
// no DOM and no React, so a pure server function named `renderMarkdown` tripped
// `testing-library/render-result-naming-convention` and `npx eslint src server`
// exited non-zero on a clean checkout, before the tree was touched at all.
//
// The fix moves `react-app/jest` out of the top-level `extends` into an
// `overrides` entry scoped to client test globs under `src/`. That is an
// allowlist: when the preset gains a rule, the rule lands only where the
// override already points, instead of leaking into `server/` until someone
// remembers to add it to an off-list.
//
// These tests assert BOTH directions, because the failure mode of a bad fix
// here is silent under-linting. Scoping the preset too broadly -- or dropping
// `server/` from the lint run altogether -- also reports "0 errors", so the
// error count is never the evidence. What follows checks that client tests
// still get the testing-library rules AND that `server/` is still linted by
// the base rules and can still be made to fail on demand.
//
// READ THIS BEFORE TRUSTING THIS FILE (#207).
//
// NO CI STEP RUNS THESE ASSERTIONS. Run them deliberately:
//
//     npm run test:eslint-scoping
//
// The script makes this guard RUNNABLE, not RUN. As of #207 no workflow in
// .github/workflows/ invokes eslint at all: ci.yml's only lint step is
// `npm run lint:colors`, which is the bespoke color-literal checker in
// scripts/check-color-literals.js, not eslint. `npm test`'s pinned testMatch
// covers `src/` only, so it never reaches this file either.
//
// So: ten passing assertions below are evidence only for whoever actually ran
// them. Do not read the presence of this file as proof that the rule scoping
// is protected -- until an eslint step exists in CI, nothing enforces it on a
// pull request. Wiring one up is a follow-up ticket.

const REPO_ROOT = path.resolve(__dirname, '..');

const SERVER_TEST_FILE = path.join(REPO_ROOT, 'server', 'test', 'backtestSweepReport.test.js');
const SERVER_SOURCE_FILE = path.join(REPO_ROOT, 'server', 'services', 'draft.service.js');
const CLIENT_TEST_FILE = path.join(REPO_ROOT, 'src', 'components', 'App', 'App.test.jsx');
const CLIENT_SOURCE_FILE = path.join(REPO_ROOT, 'src', 'components', 'App', 'App.jsx');

const TESTING_LIBRARY_RULE = 'testing-library/render-result-naming-convention';
const BASE_RULE = 'no-unused-vars';

const eslint = new ESLint({ cwd: REPO_ROOT });

// calculateConfigForFile resolves purely by path SHAPE -- it never touches the
// disk, and happily answers for a path that does not exist. That is what makes
// these checks fast, but it also means the four paths above are shapes rather
// than fixtures: rename them all away and the scoping assertions would still
// pass while proving nothing about this repo. Anchor them to reality first.
test('the representative files these assertions stand on still exist', () => {
  for (const filePath of [
    SERVER_TEST_FILE,
    SERVER_SOURCE_FILE,
    CLIENT_TEST_FILE,
    CLIENT_SOURCE_FILE,
  ]) {
    assert.ok(
      fs.existsSync(filePath),
      `${path.relative(REPO_ROOT, filePath)} is gone, so the path shape it ` +
        'represents is no longer evidence about this repo; repoint it at a ' +
        'current file of the same shape.'
    );
  }
});

test('testing-library rules do not reach a server test file', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_TEST_FILE);
  assert.equal(config.rules[TESTING_LIBRARY_RULE], undefined);
});

test('no testing-library rule at all reaches a server test file', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_TEST_FILE);
  const leaked = Object.keys(config.rules).filter((rule) => rule.startsWith('testing-library/'));
  assert.deepEqual(leaked, []);
});

test('client test files still get the testing-library rules', async () => {
  const config = await eslint.calculateConfigForFile(CLIENT_TEST_FILE);
  assert.deepEqual(config.rules[TESTING_LIBRARY_RULE], ['error']);
});

test('a deliberate violation in a client test is still reported', async () => {
  const source = [
    "import { render } from '@testing-library/react';",
    '',
    "it('deliberate', () => {",
    '  const wrapper = render(<div />);',
    '  expect(wrapper).toBeTruthy();',
    '});',
    '',
  ].join('\n');
  const [result] = await eslint.lintText(source, { filePath: CLIENT_TEST_FILE });
  const ruleIds = result.messages.map((message) => message.ruleId);
  assert.ok(
    ruleIds.includes(TESTING_LIBRARY_RULE),
    `expected ${TESTING_LIBRARY_RULE}, got: ${ruleIds.join(', ') || '(nothing)'}`
  );
});

test('testing-library rules do not reach a client source file either', async () => {
  const config = await eslint.calculateConfigForFile(CLIENT_SOURCE_FILE);
  assert.equal(config.rules[TESTING_LIBRARY_RULE], undefined);
});

// Over-scoping is the natural way to reach "0 errors" and it breaks silently.
// Everything below is the mirror direction: server/ must still be linted.

// Assert the rule is ON, not which severity the preset picked. Pinning 'warn'
// would redden this guard the day react-app bumps the rule to 'error', for a
// reason that has nothing to do with rule scoping.
const isEnabled = (entry) => {
  const severity = Array.isArray(entry) ? entry[0] : entry;
  return severity !== undefined && severity !== 'off' && severity !== 0;
};

test('the base no-unused-vars rule still applies to a server test file', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_TEST_FILE);
  assert.ok(isEnabled(config.rules[BASE_RULE]), 'no-unused-vars is off for server tests');
});

test('the base no-unused-vars rule still applies to a server source file', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_SOURCE_FILE);
  assert.ok(isEnabled(config.rules[BASE_RULE]), 'no-unused-vars is off for server sources');
});

test('server files keep the node env so no-undef does not fire on node globals', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_TEST_FILE);
  assert.equal(config.env.node, true);
});

test('a deliberate violation in a server file is still reported', async () => {
  const [result] = await eslint.lintText('const unusedByDesign = 1;\n', {
    filePath: SERVER_SOURCE_FILE,
  });
  const ruleIds = result.messages.map((message) => message.ruleId);
  assert.ok(
    ruleIds.includes(BASE_RULE),
    `server/ produced no ${BASE_RULE} report, so the override is too broad and ` +
      `the lint check is decorative; got: ${ruleIds.join(', ') || '(nothing)'}`
  );
});
