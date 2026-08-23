const test = require('node:test');
const assert = require('node:assert/strict');
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
// NOTE (#207): nothing runs this file automatically yet. CI has no eslint step
// (only `lint:colors`), `npm test`'s pinned testMatch covers `src/` only, and
// #207 was scoped to the `eslintConfig` block of package.json, so adding a
// `test:eslint-scoping` script was out of bounds. Run it with
// `node --test scripts/eslintRuleScoping.test.js`. Wiring it up is a follow-up.

const REPO_ROOT = path.resolve(__dirname, '..');

const SERVER_TEST_FILE = path.join(REPO_ROOT, 'server', 'test', 'backtestSweepReport.test.js');
const SERVER_SOURCE_FILE = path.join(REPO_ROOT, 'server', 'services', 'draft.service.js');
const CLIENT_TEST_FILE = path.join(REPO_ROOT, 'src', 'components', 'App', 'App.test.jsx');
const CLIENT_SOURCE_FILE = path.join(REPO_ROOT, 'src', 'components', 'App', 'App.jsx');

const TESTING_LIBRARY_RULE = 'testing-library/render-result-naming-convention';
const BASE_RULE = 'no-unused-vars';

const eslint = new ESLint({ cwd: REPO_ROOT });
const configFor = (filePath) => eslint.calculateConfigForFile(filePath);

test('testing-library rules do not reach a server test file', async () => {
  const config = await configFor(SERVER_TEST_FILE);
  assert.equal(config.rules[TESTING_LIBRARY_RULE], undefined);
});

test('no testing-library rule at all reaches a server test file', async () => {
  const config = await configFor(SERVER_TEST_FILE);
  const leaked = Object.keys(config.rules).filter((rule) => rule.startsWith('testing-library/'));
  assert.deepEqual(leaked, []);
});

test('client test files still get the testing-library rules', async () => {
  const config = await configFor(CLIENT_TEST_FILE);
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
  const config = await configFor(CLIENT_SOURCE_FILE);
  assert.equal(config.rules[TESTING_LIBRARY_RULE], undefined);
});

// Over-scoping is the natural way to reach "0 errors" and it breaks silently.
// Everything below is the mirror direction: server/ must still be linted.

test('the base no-unused-vars rule still applies to a server test file', async () => {
  const config = await configFor(SERVER_TEST_FILE);
  assert.ok(config.rules[BASE_RULE], 'no-unused-vars is not configured for server tests');
  assert.equal(config.rules[BASE_RULE][0], 'warn');
});

test('the base no-unused-vars rule still applies to a server source file', async () => {
  const config = await configFor(SERVER_SOURCE_FILE);
  assert.ok(config.rules[BASE_RULE], 'no-unused-vars is not configured for server sources');
  assert.equal(config.rules[BASE_RULE][0], 'warn');
});

test('server files keep the node env so no-undef does not fire on node globals', async () => {
  const config = await configFor(SERVER_TEST_FILE);
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
