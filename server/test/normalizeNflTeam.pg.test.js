/**
 * Disposable-Postgres test for fn_normalize_nfl_team (#1405, migration
 * 20260915000001).
 *
 * The function backs two expression indexes and a view, and every caller
 * that joins players to games or live states goes through it, so its MAPPING
 * is the contract: this pins every full name, every legacy alias, the
 * pass-through default, whitespace/case folding and NULL against a real
 * Postgres. It also pins the shape the migration exists for: the body is a
 * single CASE with no subselect, so the ~70 us-per-call CTE form cannot come
 * back unnoticed (the Players list evaluates this several times per row,
 * #1405).
 *
 * Gated exactly like the other pg tests: NORMALIZE_NFL_TEAM_PG_TESTS=1 (or
 * the umbrella PG_TESTS=1) must be set, and every DATABASE_URL* variable must
 * be ABSENT, so a stray local run can never touch the shared production
 * database. Reads only; seeds nothing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.PG_TESTS === '1' || process.env.NORMALIZE_NFL_TEAM_PG_TESTS === '1';
const URL_VARS = ['DATABASE_URL', 'DATABASE_URL_RUNTIME', 'DATABASE_URL_MIGRATIONS'];
const urlLeak = URL_VARS.filter((k) => process.env[k]);

const FULL_NAMES = {
  'Arizona Cardinals': 'ARI', 'Atlanta Falcons': 'ATL', 'Baltimore Ravens': 'BAL',
  'Buffalo Bills': 'BUF', 'Carolina Panthers': 'CAR', 'Chicago Bears': 'CHI',
  'Cincinnati Bengals': 'CIN', 'Cleveland Browns': 'CLE', 'Dallas Cowboys': 'DAL',
  'Denver Broncos': 'DEN', 'Detroit Lions': 'DET', 'Green Bay Packers': 'GB',
  'Houston Texans': 'HOU', 'Indianapolis Colts': 'IND', 'Jacksonville Jaguars': 'JAX',
  'Kansas City Chiefs': 'KC', 'Las Vegas Raiders': 'LV', 'Los Angeles Chargers': 'LAC',
  'Los Angeles Rams': 'LAR', 'Miami Dolphins': 'MIA', 'Minnesota Vikings': 'MIN',
  'New England Patriots': 'NE', 'New Orleans Saints': 'NO', 'New York Giants': 'NYG',
  'New York Jets': 'NYJ', 'Philadelphia Eagles': 'PHI', 'Pittsburgh Steelers': 'PIT',
  'San Francisco 49ers': 'SF', 'Seattle Seahawks': 'SEA', 'Tampa Bay Buccaneers': 'TB',
  'Tennessee Titans': 'TEN', 'Washington Commanders': 'WAS',
};

const ALIASES = {
  WSH: 'WAS', WFT: 'WAS', GNB: 'GB', KAN: 'KC', JAC: 'JAX', NWE: 'NE',
  NOR: 'NO', TAM: 'TB', SFO: 'SF', SD: 'LAC', OAK: 'LV', STL: 'LAR', LA: 'LAR',
};

if (!ENABLED) {
  test('fn_normalize_nfl_team PG tests (skipped: set PG_TESTS=1 or NORMALIZE_NFL_TEAM_PG_TESTS=1; CI migration-smoke runs these)', { skip: true }, () => {});
} else if (urlLeak.length > 0) {
  test('fn_normalize_nfl_team PG tests refuse to run with DATABASE_URL* set', () => {
    assert.fail(`unset ${urlLeak.join(', ')} - these tests must only ever see a disposable PG* database`);
  });
} else {
  const pg = require('pg');
  const pool = new pg.Pool({
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 2,
  });

  test.after(async () => { await pool.end(); });

  const normalize = async (value) => (
    (await pool.query('SELECT fn_normalize_nfl_team($1::text) AS v', [value])).rows[0].v
  );

  test('every full team name maps to its abbreviation, case and padding folded', async () => {
    for (const [name, abbr] of Object.entries(FULL_NAMES)) {
      assert.equal(await normalize(name), abbr, name);
      assert.equal(await normalize(`  ${name.toLowerCase()}  `), abbr, `${name} lowercased and padded`);
    }
  });

  test('every legacy or alternate abbreviation maps to the canonical one', async () => {
    for (const [alias, abbr] of Object.entries(ALIASES)) {
      assert.equal(await normalize(alias), abbr, alias);
      assert.equal(await normalize(alias.toLowerCase()), abbr, `${alias} lowercased`);
    }
  });

  test('a canonical abbreviation or unknown input passes through upper-cased and trimmed; NULL stays NULL', async () => {
    assert.equal(await normalize('KC'), 'KC');
    assert.equal(await normalize(' kc '), 'KC');
    assert.equal(await normalize('Free Agent'), 'FREE AGENT');
    assert.equal(await normalize(''), '');
    assert.equal(await normalize('   '), '');
    assert.equal(await normalize(null), null);
  });

  test('the function is IMMUTABLE and its body is one CASE expression with no subselect (#1405)', async () => {
    const { rows } = await pool.query(
      `SELECT provolatile, proparallel, pg_get_functiondef(oid) AS def
       FROM pg_proc WHERE proname = 'fn_normalize_nfl_team'`,
    );
    assert.equal(rows.length, 1, 'exactly one fn_normalize_nfl_team');
    assert.equal(rows[0].provolatile, 'i', 'IMMUTABLE, so it can back the expression indexes');
    assert.equal(rows[0].proparallel, 's', 'PARALLEL SAFE');
    const body = rows[0].def;
    assert.match(body, /CASE upper\(trim\(raw_team\)\)/);
    assert.doesNotMatch(body, /SELECT abbr FROM/i, 'the per-call VALUES subselects are gone');
    assert.doesNotMatch(body, /WITH normalized AS/i, 'the per-call CTE is gone');
  });

  test('the expression indexes and the view that reference the function are still present', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN ('idx_players_nfl_team_normalized', 'nfl_games_season_week_team_code_unique')
       ORDER BY indexname`,
    );
    assert.deepEqual(rows.map((r) => r.indexname), ['idx_players_nfl_team_normalized', 'nfl_games_season_week_team_code_unique']);
    const view = await pool.query(`SELECT 1 FROM pg_views WHERE viewname = 'view_matchup_nfl_games'`);
    assert.equal(view.rows.length, 1);
  });
}
