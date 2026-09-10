const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Source-form guard (#1136, in the #745/#633 style): every wire payload that
 * carries an NFL opponent read from `nfl_games.opponent` folds it through
 * `normalizeNflTeam` before assignment, so the wire speaks one vocabulary,
 * Team code (CONTEXT.md, Team code), never the schedule's raw Tank01
 * spelling.
 *
 * SCOPE. Three sites read `nfl_games.opponent` and put it straight onto a
 * wire payload's `opponent:` field, the same three the issue's triage named:
 * the matchup-detail starter row (league.router.js), the lineup entry
 * (lineup.service.js) and the scoring play (scoring.service.js). This is a
 * targeted read of exactly those files' opponent-map construction, not a
 * repo-wide sweep - other `opponent:` object keys exist for unrelated
 * concepts (a projection factor's name, the schedule writer's own INSERT, a
 * public recent-games row) that this ticket does not touch.
 */
const SERVER_DIR = path.join(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(SERVER_DIR, relPath), 'utf8');
}

/** How many `normalizeNflTeam(` calls appear inside a snippet of source. */
function foldCount(snippet) {
  return (snippet.match(/normalizeNflTeam\(/g) || []).length;
}

/**
 * The source text of a named function's body, found by brace-counting from
 * its declaration rather than a `\n}\n` line match, which a CRLF checkout
 * (this repo's own line endings) silently fails to match at all.
 */
function functionBody(source, declaration) {
  assert.ok(declaration.endsWith('('), `${declaration} must end with '('`);
  const start = source.indexOf(declaration);
  assert.ok(start !== -1, `${declaration} not found`);
  // Skip past the parameter list by paren-counting (it may itself destructure
  // with braces, e.g. `{ season, week }`, which a naive first-`{` search would
  // stop at instead of the function body's own opening brace).
  let parenDepth = 0;
  let i = start + declaration.length - 1; // the parameter list's '('
  for (; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) break;
    }
  }
  const braceStart = source.indexOf('{', i);
  let depth = 0;
  i = braceStart;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

/** The source text of a `new Map(...)` (or similar) call statement, found by
 * paren-counting from the `(` that ends `declaration`. */
function parenBody(source, declaration) {
  assert.ok(declaration.endsWith('('), `${declaration} must end with '('`);
  const start = source.indexOf(declaration);
  assert.ok(start !== -1, `${declaration} not found`);
  let depth = 0;
  let i = start + declaration.length - 1; // the '(' itself
  for (; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

test('league.router.js: the starter-row opponent map folds both the team key and the opponent value', () => {
  const source = read('routes/league.router.js');
  const body = parenBody(source, 'const opponentByTeam = new Map(');
  assert.equal(
    foldCount(body),
    2,
    `expected both nfl_team (key) and opponent (value) folded, got: ${body.trim()}`
  );
});

test('lineup.service.js: weekOpponents folds both the team key and the opponent value', () => {
  const source = read('services/lineup.service.js');
  const body = functionBody(source, 'async function weekOpponents(');
  assert.equal(
    foldCount(body),
    2,
    `expected both nfl_team (key) and opponent (value) folded, got: ${body.trim()}`
  );
});

test('scoring.service.js: both scoring-play opponent assignments fold before leaving the server (positive control)', () => {
  const source = read('services/scoring.service.js');
  const assignments = source.split('\n').filter((line) => /^\s*opponent:/.test(line));
  assert.equal(assignments.length, 2, `expected exactly 2 opponent: assignments, found ${assignments.length}`);
  for (const line of assignments) {
    assert.match(line, /normalizeNflTeam\(/, `unfolded opponent assignment: ${line.trim()}`);
  }
});

test('negative control: the pre-#1136 shape (key folded, value raw) is caught by the check above', () => {
  const preFixShape = `
    const opponentByTeam = new Map(scheduleRows.rows.map((r) => [normalizeNflTeam(r.nfl_team), r.opponent]));
  `;
  const body = parenBody(preFixShape, 'const opponentByTeam = new Map(');
  assert.equal(foldCount(body), 1, 'the doctored (pre-fix) shape folds only the key, not the value');
});
