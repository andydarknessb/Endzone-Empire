const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const { recordWinProbabilityShadow } = require('../services/winProbabilityShadow.service');

/**
 * Win probability v2 shadow mode: the live score pass hands the recorder its
 * scored matchups and the Expected final decorations it already computed;
 * the recorder writes one row per open matchup per 15-minute window and
 * nothing for a matchup whose result is already settled or unknown.
 */

const NOW = '2026-10-04T19:37:12.000Z'; // inside the 19:30-19:45 window
const SIGMA_SQUARED = (18 / 2.5631) ** 2;

const scoredEntry = (overrides = {}) => ({
  matchupId: 912, homeTeamId: 10, awayTeamId: 20, homeScore: 87.4, awayScore: 71.2, status: 'live', ...overrides,
});
const decoration = (overrides = {}) => ({
  status: 'live',
  homeExpectedFinal: 118.6,
  awayExpectedFinal: 104.1,
  homePlayersRemaining: 4,
  awayPlayersRemaining: 3,
  home: { varianceRemaining: 4 * SIGMA_SQUARED },
  away: { varianceRemaining: 3 * SIGMA_SQUARED },
  ...overrides,
});

function recordingPool() {
  const inserts = [];
  const fake = createFakePool([
    [/INSERT INTO "win_probability_shadow"/, (text, params) => { inserts.push({ text, params }); return { rows: [] }; }],
  ]);
  return { fake, inserts };
}

test('a live matchup is recorded once per 15-minute window with v2 and the inputs v1 needs', async () => {
  const { fake, inserts } = recordingPool();
  await recordWinProbabilityShadow({
    leagueId: 71, season: 2026, week: 4,
    scored: [scoredEntry()],
    decorations: new Map([[912, decoration()]]),
    db: fake, now: new Date(NOW),
  });

  assert.equal(inserts.length, 1);
  assert.match(inserts[0].text, /ON CONFLICT \("matchup_id", "bucket_start"\) DO NOTHING/);
  const [row] = rowsOf(inserts[0]);
  assert.equal(row.league_id, 71);
  assert.equal(row.matchup_id, 912);
  assert.equal(row.season, 2026);
  assert.equal(row.week, 4);
  assert.equal(new Date(row.bucket_start).toISOString(), '2026-10-04T19:30:00.000Z');
  assert.equal(row.status, 'live');
  assert.equal(row.home_score, 87.4);
  assert.equal(row.away_expected_final, 104.1);
  assert.equal(row.home_players_remaining, 4);
  assert.ok(Math.abs(row.mu - 14.5) < 1e-9);
  assert.ok(Math.abs(row.home_probability - 0.782) < 0.001, `probability ${row.home_probability}`);
  assert.equal(row.k, 1);
  assert.equal(row.model_version, 'v2');
});

test('scheduled, live and played matchups are recorded; settled or unknown ones are not', async () => {
  const { fake, inserts } = recordingPool();
  await recordWinProbabilityShadow({
    leagueId: 71, season: 2026, week: 4,
    scored: [
      scoredEntry({ matchupId: 1, status: 'scheduled' }),
      scoredEntry({ matchupId: 2, status: 'final' }),
      scoredEntry({ matchupId: 3, status: 'played' }),
      scoredEntry({ matchupId: 4, status: null }),
    ],
    decorations: new Map([
      [1, decoration({ status: 'scheduled' })],
      [3, decoration({ status: 'played' })],
      [4, decoration({ status: null })],
    ]),
    db: fake, now: new Date(NOW),
  });

  // played (every game over, week not yet settled) is where "exactly 0 or 1" is checked.
  assert.deepEqual(rowsOf(inserts[0]).map((row) => row.matchup_id), [1, 3]);
});

test('a matchup with no Expected final on a side writes nothing, and no rows means no statement', async () => {
  const { fake, inserts } = recordingPool();
  await recordWinProbabilityShadow({
    leagueId: 71, season: 2026, week: 4,
    scored: [scoredEntry()],
    decorations: new Map([[912, decoration({ awayExpectedFinal: null })]]),
    db: fake, now: new Date(NOW),
  });

  assert.equal(inserts.length, 0);
});

// The statement is one multi-row INSERT; its params are the rows' values in
// column order. Read them back into objects through the column list.
function rowsOf({ text, params }) {
  const columns = /INSERT INTO "win_probability_shadow" \(([^)]+)\)/.exec(text)[1]
    .split(',').map((c) => c.trim().replace(/"/g, ''));
  const rows = [];
  for (let i = 0; i < params.length; i += columns.length) {
    rows.push(Object.fromEntries(columns.map((c, j) => [c, params[i + j]])));
  }
  return rows;
}

test('starters with game time left but no projection interval are counted on the row', async () => {
  const { fake, inserts } = recordingPool();
  await recordWinProbabilityShadow({
    leagueId: 71, season: 2026, week: 4,
    scored: [scoredEntry()],
    decorations: new Map([[912, decoration({
      home: { varianceRemaining: 4 * SIGMA_SQUARED, uncertainStartersWithoutInterval: 1 },
      away: { varianceRemaining: 3 * SIGMA_SQUARED, uncertainStartersWithoutInterval: 2 },
    })]]),
    db: fake, now: new Date(NOW),
  });

  assert.equal(rowsOf(inserts[0])[0].starters_without_interval, 3);
});
