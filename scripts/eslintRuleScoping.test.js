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

// A server file that actually carries a `'use strict'` directive (#246). The
// assertions below are about what the config does to that directive, so this
// one has to be a file where the directive is really present, not a shape.
const SERVER_STRICT_DIRECTIVE_FILE = path.join(
  REPO_ROOT,
  'server',
  'scripts',
  'run-backtest-package.js'
);

const TESTING_LIBRARY_RULE = 'testing-library/render-result-naming-convention';
const BASE_RULE = 'no-unused-vars';
const STRICT_RULE = 'strict';

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
    SERVER_STRICT_DIRECTIVE_FILE,
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

// ---------------------------------------------------------------------------
// Issue #246: the same failure shape as #207, one preset layer down.
//
// `eslint-config-react-app` is a create-react-app config. Its base
// (eslint-config-react-app/base.js) sets `parserOptions.sourceType: 'module'`
// for every file it sees, and its index sets `strict: ['warn', 'never']`.
// Together those say "this tree is ES modules, so a 'use strict' directive is
// dead weight" -- true of `src/`, false of `server/`, which is CommonJS run
// straight by node. There is no `"type": "module"` in package.json, no
// `import`/`export` anywhere under `server/`, and CommonJS is NOT implicitly
// strict, so the 21 `'use strict'` directives in the server tree are load
// bearing. The preset reported all 21 as unnecessary.
//
// The wrong repair is the one `--fix` offers: strip all 21 directives, which
// silently moves those files into sloppy mode. The right one is to tell the
// config the truth about the tree -- `sourceType: 'script'` -- and to turn off
// a rule that has no setting matching this repo's policy.
//
// On WHY the rule is off rather than retuned, since "off" deserves an argument:
// ESLint's `strict` rule offers 'never' (ban the directive everywhere),
// 'global'/'safe' (REQUIRE one per file), and 'function' (require one per
// function). It has no "permitted, not required" mode, which is what this tree
// actually practises: 21 files opt in, the rest do not. Measured on the server
// tree at the time of #246: 'never' reported 21, 'global' and 'safe' reported
// 354, 'function' reported 4905. Every non-off setting demands a sweeping code
// change in service of a stylistic preference nobody here has adopted. The rule
// is therefore scoped off for `server/**/*.js` and left ON everywhere else,
// which the mirror assertions further down pin in place.
//
// WHAT #246 DELIBERATELY DID NOT FIX, so nobody reads the green below as
// covering more than it does. `scripts/` is CommonJS too, run straight by
// node, and it has the identical defect: `npx eslint scripts` reports 64
// `strict` warnings, every one of them "fixable" by the same directive strip
// -- including in THIS file. The override is keyed on `server/**/*.js`
// because #246's acceptance is `npx eslint src server`, and `scripts/` sits
// outside that surface (it also carries 28 pre-existing errors, which is why
// it sits outside). So the footgun is still armed over there: `npx eslint
// scripts --fix` still performs the wrong repair. Widening this glob is a
// one-line follow-up that costs the `src server` check nothing. It was left
// out to hold #246 to its stated scope, NOT because that tree does not need
// it.
// ---------------------------------------------------------------------------

test('the representative server file still carries the directive #246 is about', () => {
  const source = fs.readFileSync(SERVER_STRICT_DIRECTIVE_FILE, 'utf8');
  assert.match(
    source,
    /^'use strict';$/m,
    `${path.relative(REPO_ROOT, SERVER_STRICT_DIRECTIVE_FILE)} no longer has a ` +
      "'use strict' directive, so it cannot stand for what #246 fixed; repoint " +
      'this at a server file that does.'
  );
});

test('server files are parsed as CommonJS scripts, not ES modules', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_SOURCE_FILE);
  assert.equal(config.parserOptions.sourceType, 'script');
});

test('server test files are parsed as CommonJS scripts too', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_TEST_FILE);
  assert.equal(config.parserOptions.sourceType, 'script');
});

test('the strict rule does not reach server files', async () => {
  const config = await eslint.calculateConfigForFile(SERVER_STRICT_DIRECTIVE_FILE);
  assert.ok(
    !isEnabled(config.rules[STRICT_RULE]),
    `${STRICT_RULE} is still on for server/, so the CommonJS 'use strict' ` +
      'directives are still being reported as mistakes'
  );
});

test("a 'use strict' directive in a server file is reported by nothing", async () => {
  const source = ["'use strict';", '', 'module.exports = { ok: true };', ''].join('\n');
  const [result] = await eslint.lintText(source, { filePath: SERVER_SOURCE_FILE });
  const ruleIds = result.messages.map((message) => message.ruleId);
  assert.deepEqual(
    ruleIds,
    [],
    `a CommonJS file with a 'use strict' directive should lint clean; got: ${ruleIds.join(', ')}`
  );
});

// Mirror direction. Scoping `strict` off for the whole repo would also make the
// four assertions above pass, and would be exactly the silent under-lint #207
// warned about. `src/` is genuinely ES modules, so there the preset's opinion
// holds and a stray directive must still be reported.

test('the strict rule is still on for client source files', async () => {
  const config = await eslint.calculateConfigForFile(CLIENT_SOURCE_FILE);
  assert.ok(
    isEnabled(config.rules[STRICT_RULE]),
    `${STRICT_RULE} is off for src/, so the server override is too broad`
  );
});

test('client files are still parsed as ES modules', async () => {
  const config = await eslint.calculateConfigForFile(CLIENT_SOURCE_FILE);
  assert.equal(config.parserOptions.sourceType, 'module');
});

// The `.js` extension here is load bearing, and is the one detail in this file
// that is not self-evident. The over-broad override this test exists to catch
// would be written `**/*.js`, so the fixture has to be a `.js` path to fall
// inside it; the other mirror assertions all point at `App.jsx`, which such an
// override would miss, and the failure would go unreported. The path itself is
// deliberately not a real file -- calculateConfigForFile and lintText both
// resolve by path SHAPE, never touching the disk.
test("a deliberate 'use strict' in a client file is still reported", async () => {
  const [result] = await eslint.lintText("'use strict';\n\nexport const ok = true;\n", {
    filePath: path.join(REPO_ROOT, 'src', 'lib', 'eslintScopingFixture.js'),
  });
  const ruleIds = result.messages.map((message) => message.ruleId);
  assert.ok(
    ruleIds.includes(STRICT_RULE),
    `src/ produced no ${STRICT_RULE} report, so the server override reaches the ` +
      `client tree; got: ${ruleIds.join(', ') || '(nothing)'}`
  );
});
