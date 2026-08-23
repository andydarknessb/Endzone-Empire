/**
 * The team vocabulary, and the guard that keeps its two copies honest (#227).
 *
 * `fn_normalize_nfl_team(text)` in the database and `normalizeNflTeam()` in
 * `services/nflTeam.js` must answer identically forever: `bye.service` and
 * `gameRecap.service` normalise in SQL, the lineup lock and the kickoff spare
 * normalise in JS, and the whole point of #227 is that those consumers stop
 * disagreeing about the same player. Two hand-maintained tables of 32 names
 * and 13 aliases will drift on their own, so the last test here reads the
 * VALUES lists straight out of the migration that defines the SQL function
 * and fails when the two have stopped saying the same thing.
 *
 * It reads the migration as TEXT on purpose. Executing it would need a
 * database, which most of this suite does not have and which would make the
 * guard skippable exactly when someone is in a hurry; and the fact under test
 * is not "does Postgres agree today" but "do the two source files still say
 * the same thing", which is a question about the files.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  NFL_TEAM_FULL_NAMES,
  NFL_TEAM_ALIASES,
  normalizeNflTeam,
  sameNflTeam,
} = require('../services/nflTeam');

const MIGRATION = path.join(
  __dirname, '..', 'db', 'migrations', '20260719000003_view_matchup_nfl_games.js'
);

test('a full team name resolves to the abbreviation the schedule uses', () => {
  assert.equal(normalizeNflTeam('Denver Broncos'), 'DEN');
  assert.equal(normalizeNflTeam('San Francisco 49ers'), 'SF');
  // Case and stray whitespace are not identity. `upper(trim(...))` is the
  // first thing the SQL function does, and this mirrors it.
  assert.equal(normalizeNflTeam('  denver broncos '), 'DEN');
});

test('alias codes collapse onto the canonical abbreviation in both directions', () => {
  assert.equal(normalizeNflTeam('WSH'), 'WAS');
  assert.equal(normalizeNflTeam('WAS'), 'WAS');
  assert.ok(sameNflTeam('WSH', 'WAS'), 'neither spelling is privileged');
  assert.ok(sameNflTeam('WAS', 'WSH'));
  assert.ok(sameNflTeam('Washington Commanders', 'WSH'));
  // Pre-relocation codes still lingering in stale rows.
  assert.equal(normalizeNflTeam('OAK'), 'LV');
  assert.equal(normalizeNflTeam('SD'), 'LAC');
});

test('an unknown team passes through rather than folding onto a real one', () => {
  // The SQL function's final COALESCE branch. An unknown code is still an
  // identity: it must match itself and nothing else. Folding it onto a real
  // team would be worse than leaving it alone, and is how a normalisation
  // turns "no game this week" into a kickoff.
  assert.equal(normalizeNflTeam('Ghosts'), 'GHOSTS');
  assert.ok(sameNflTeam('Ghosts', 'ghosts'));
  assert.ok(!sameNflTeam('Ghosts', 'DEN'));
});

test('a missing team matches nothing, including another missing team', () => {
  // The one deliberate divergence from the SQL, and the reason it is safe:
  // absence of a team is absence of a game, and two players with no team
  // recorded must never be treated as team-mates who kicked off together.
  for (const blank of [null, undefined, '', '   ']) {
    assert.equal(normalizeNflTeam(blank), null);
    assert.ok(!sameNflTeam(blank, blank));
    assert.ok(!sameNflTeam(blank, 'DEN'));
    assert.ok(!sameNflTeam('DEN', blank));
  }
});

test('the JS mirror and fn_normalize_nfl_team still say the same thing', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');

  /**
   * The `('KEY','VALUE'), ...` pairs of one named VALUES list in the CREATE
   * FUNCTION body. Anchored to the list's name so the two cannot be confused,
   * and stopping at the closing paren of that list alone.
   */
  const valuesList = (name) => {
    const start = sql.indexOf(`${name} (`);
    assert.notEqual(start, -1, `the migration still declares a ${name} VALUES list`);
    const body = sql.slice(start, sql.indexOf('\n      )', start));
    const pairs = {};
    for (const [, key, abbr] of body.matchAll(/\('([^']+)','([^']+)'\)/g)) {
      pairs[key] = abbr;
    }
    return pairs;
  };

  const fullNames = valuesList('full_names');
  const aliases = valuesList('aliases');

  assert.equal(Object.keys(fullNames).length, 32, 'all 32 teams were parsed out of the migration');
  assert.ok(Object.keys(aliases).length > 0, 'and the alias list was found');

  assert.deepEqual(
    NFL_TEAM_FULL_NAMES,
    fullNames,
    'NFL_TEAM_FULL_NAMES has drifted from the migration\'s full_names list; update both'
  );
  assert.deepEqual(
    NFL_TEAM_ALIASES,
    aliases,
    'NFL_TEAM_ALIASES has drifted from the migration\'s aliases list; update both'
  );
});
