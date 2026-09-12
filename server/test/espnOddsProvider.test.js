/**
 * The ESPN odds provider (#1234, ADR 0037): the odds-provider seam's real
 * implementation, filled from the free ESPN scoreboard's `odds[]` block.
 *
 * Three things are proven here:
 * - the pure parser reads a Line off a scoreboard event's odds block, and
 *   returns nothing for an event with none (never a zero line);
 * - the Sync run (`syncOdds`) fetches the slate once outside any transaction
 *   and writes one snapshot per priced game inside it, recorded via the
 *   existing sync-run harness the same way adp.test.js/syncRun.test.js do;
 * - the seam's `getWeeklyOdds` reads back only the newest snapshot per game.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/espn-scoreboard-2025-w1.json');
const { createFakePool, select, insert } = require('./helpers/fakePool');
const {
  resolveHomeSpread,
  parseCompetitionOdds,
  fetchOddsUnits,
  syncOdds,
  getWeeklyOdds,
  espnOddsProvider,
  ESPN_ODDS_SOURCE,
} = require('../services/espnOdds.provider');

const bufAtMia = () => fixture.events.find((e) => e.shortName === 'BUF @ MIA');
const dalAtPhi = () => fixture.events.find((e) => e.shortName === 'DAL @ PHI');

// ---------------------------------------------------------------------------
// resolveHomeSpread
// ---------------------------------------------------------------------------

test('resolveHomeSpread: the named team is favored, signed home-relative', () => {
  assert.equal(resolveHomeSpread({ details: 'MIA -3.5' }, { homeTeam: 'MIA', awayTeam: 'BUF' }), -3.5);
  assert.equal(resolveHomeSpread({ details: 'BUF -3.5' }, { homeTeam: 'MIA', awayTeam: 'BUF' }), 3.5);
});

test('resolveHomeSpread: EVEN/PK is a pick-em, spread 0', () => {
  assert.equal(resolveHomeSpread({ details: 'EVEN' }, { homeTeam: 'MIA', awayTeam: 'BUF' }), 0);
  assert.equal(resolveHomeSpread({ details: 'PK' }, { homeTeam: 'MIA', awayTeam: 'BUF' }), 0);
});

test('resolveHomeSpread: a team named that is neither side is untrustworthy, never guessed', () => {
  assert.equal(resolveHomeSpread({ details: 'NYJ -3.5' }, { homeTeam: 'MIA', awayTeam: 'BUF' }), null);
});

test('resolveHomeSpread: missing or unparseable details is null, not a guess', () => {
  assert.equal(resolveHomeSpread({}, { homeTeam: 'MIA', awayTeam: 'BUF' }), null);
  assert.equal(resolveHomeSpread({ details: 'garbage' }, { homeTeam: 'MIA', awayTeam: 'BUF' }), null);
});

// ---------------------------------------------------------------------------
// parseCompetitionOdds — the provider test the ticket's plan calls for
// ---------------------------------------------------------------------------

test('parseCompetitionOdds: an event with an odds block yields the Line', () => {
  const competition = bufAtMia().competitions[0];
  const line = parseCompetitionOdds(competition, { homeTeam: 'MIA', awayTeam: 'BUF' });
  assert.deepEqual(line, { total: 47.5, spread: -3.5 });
});

test('parseCompetitionOdds: an event with no odds block returns nothing, never a zero line', () => {
  const competition = dalAtPhi().competitions[0];
  assert.equal(parseCompetitionOdds(competition, { homeTeam: 'PHI', awayTeam: 'DAL' }), null);
});

test('parseCompetitionOdds: an empty odds array is the same as no block', () => {
  assert.equal(parseCompetitionOdds({ odds: [] }, { homeTeam: 'MIA', awayTeam: 'BUF' }), null);
});

test('parseCompetitionOdds: a half-quote (total posted, spread unparseable) is reported honestly, not discarded', () => {
  const line = parseCompetitionOdds(
    { odds: [{ overUnder: 44 }] },
    { homeTeam: 'MIA', awayTeam: 'BUF' }
  );
  assert.deepEqual(line, { total: 44, spread: null });
});

// ---------------------------------------------------------------------------
// fetchOddsUnits — the Sync run's fetch()
// ---------------------------------------------------------------------------

test('fetchOddsUnits: only the priced game becomes a unit, keyed by the shared game_key format', async () => {
  const transport = { async get() { return { data: fixture }; } };
  const units = await fetchOddsUnits({ season: 2026, week: 2, transport });
  assert.equal(units.length, 1, 'one unit for the whole slate');
  const { quotes } = units[0];
  // Every other event in the fixture carries no odds block; only BUF@MIA does.
  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].gameKey, '2026_02_BUF_MIA');
  assert.equal(quotes[0].total, 47.5);
  assert.equal(quotes[0].spread, -3.5);
  // observed_at is the DB clock (now()), written at INSERT time - see
  // applyOddsUnit - so a fetched quote carries no timestamp of its own yet.
  assert.equal(quotes[0].observedAt, undefined);
});

test('fetchOddsUnits: no priced games at all resolves to zero units, not a refusal', async () => {
  const noOdds = { events: [dalAtPhi()] };
  const transport = { async get() { return { data: noOdds }; } };
  const units = await fetchOddsUnits({ season: 2025, week: 1, transport });
  assert.deepEqual(units, []);
});

// ---------------------------------------------------------------------------
// syncOdds — the Sync run test, via the existing sync-run harness
// ---------------------------------------------------------------------------

const dataSyncRuns = (calls) => calls.filter((c) => insert('data_sync_runs').test(c.text));

test('syncOdds: fetches the slate once outside any transaction, writes one row per priced game inside one transaction, records ok=true', async (t) => {
  const transport = { async get() { return { data: fixture }; } };
  const fake = createFakePool([
    [insert('game_odds_snapshots'), () => ({ rows: [], rowCount: 1 })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncOdds({ season: 2026, week: 2, transport });

  assert.deepEqual(result, { gamesWritten: 1 });
  assert.equal(fake.matching(/^BEGIN$/).length, 1, 'the whole slate writes in one transaction');
  assert.equal(fake.matching(insert('game_odds_snapshots')).length, 1);
  const beginIdx = fake.calls.findIndex((c) => c.text === 'BEGIN');
  const commitIdx = fake.calls.findIndex((c) => c.text === 'COMMIT');
  const insertIdx = fake.calls.findIndex((c) => insert('game_odds_snapshots').test(c.text));
  assert.ok(beginIdx < insertIdx && insertIdx < commitIdx, 'the write sits inside the transaction');
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], true, 'ok is true');
  assert.deepEqual(JSON.parse(runs[0].params[3]), { gamesWritten: 1 });
  fake.assertClean();
});

test('syncOdds: no lock is taken (game_odds_snapshots has one writer)', async (t) => {
  const transport = { async get() { return { data: fixture }; } };
  const fake = createFakePool([
    [insert('game_odds_snapshots'), () => ({ rows: [] })],
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await syncOdds({ season: 2026, week: 2, transport });
  assert.equal(fake.matching(/pg_advisory_xact_lock/).length, 0);
});

test('syncOdds: a week with no priced games opens no transaction and still records an ok run', async (t) => {
  const transport = { async get() { return { data: { events: [dalAtPhi()] } }; } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  const result = await syncOdds({ season: 2025, week: 1, transport });
  assert.deepEqual(result, { results: [] });
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs[0].params[2], true);
  fake.assertClean();
});

test('syncOdds: an ESPN fetch failure is recorded fetch_failed and rethrown, no transaction opens', async (t) => {
  const transport = { async get() { throw new Error('ESPN unavailable'); } };
  const fake = createFakePool([
    [insert('data_sync_runs'), () => ({ rows: [{ id: 1 }] })],
  ]).install(t);

  await assert.rejects(syncOdds({ season: 2026, week: 2, transport }), /ESPN unavailable/);
  const runs = dataSyncRuns(fake.calls);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].params[2], false);
  const detail = JSON.parse(runs[0].params[3]);
  assert.equal(detail.reason, 'fetch_failed');
  assert.equal(fake.matching(/^BEGIN$/).length, 0);
});

// ---------------------------------------------------------------------------
// getWeeklyOdds — the seam's read side
// ---------------------------------------------------------------------------

test('getWeeklyOdds: reads only the newest snapshot per game (criterion 3), filtered to this provider\'s own source', async (t) => {
  const fake = createFakePool([
    [select('game_odds_snapshots'), (text, params) => {
      assert.deepEqual(params, [2026, 2, ESPN_ODDS_SOURCE]);
      // The DISTINCT ON / ORDER BY ... DESC does the newest-per-game work in
      // SQL; the fake just returns what a correct query would already have
      // picked, since this harness does not simulate real row semantics.
      // observed_at is a JS Date, not a string - pool.js installs no pg type
      // parser for timestamptz, so that is what a real query actually hands
      // back (formal review, PR #1259 f1). Handing in a Date here is what
      // makes the assertion below exercise the toISOString conversion
      // instead of merely echoing a string literal back at itself.
      return {
        rows: [{
          game_key: '2026_02_BUF_MIA', total: '47.5', spread: '-3.5',
          observed_at: new Date('2026-09-11T18:00:00.000Z'), source: 'espn',
        }],
      };
    }],
  ]).install(t);

  const odds = await getWeeklyOdds({ season: 2026, week: 2 });
  assert.equal(odds.size, 1);
  assert.deepEqual(odds.get('2026_02_BUF_MIA'), {
    total: 47.5, spread: -3.5, source: ESPN_ODDS_SOURCE, observedAt: '2026-09-11T18:00:00.000Z',
  });
  fake.assertClean();
});

test('getWeeklyOdds: observedAtOrBefore bounds the read - the earlier snapshot wins when it is bound, the later one wins when it is not (#1268, ADR 0039)', async (t) => {
  const earlier = new Date('2026-09-11T10:00:00.000Z');
  const bound = new Date('2026-09-11T18:00:00.000Z');

  const bounded = createFakePool([
    [select('game_odds_snapshots'), (text, params) => {
      // The bound is filtered in SQL, before the newest-per-game pick runs -
      // the fake just returns the row a correct query would have kept.
      assert.match(text, /"observed_at" <= \$4/);
      assert.deepEqual(params, [2026, 2, ESPN_ODDS_SOURCE, bound]);
      return {
        rows: [{
          game_key: '2026_02_BUF_MIA', total: '47.5', spread: '-3.5',
          observed_at: earlier, source: 'espn',
        }],
      };
    }],
  ]).install(t);
  const odds = await getWeeklyOdds({ season: 2026, week: 2, observedAtOrBefore: bound });
  assert.equal(odds.get('2026_02_BUF_MIA').observedAt, earlier.toISOString(), 'the earlier, in-bound snapshot is returned');
  bounded.assertClean();
});

test('getWeeklyOdds: absent bound issues no observed_at filter and reads the newest snapshot regardless', async (t) => {
  const later = new Date('2026-09-11T20:00:00.000Z');
  const fake = createFakePool([
    [select('game_odds_snapshots'), (text, params) => {
      assert.doesNotMatch(text, /"observed_at" <=/);
      assert.deepEqual(params, [2026, 2, ESPN_ODDS_SOURCE]);
      return {
        rows: [{
          game_key: '2026_02_BUF_MIA', total: '47.5', spread: '-3.5',
          observed_at: later, source: 'espn',
        }],
      };
    }],
  ]).install(t);
  const odds = await getWeeklyOdds({ season: 2026, week: 2 });
  assert.equal(odds.get('2026_02_BUF_MIA').observedAt, later.toISOString(), 'the later snapshot wins with no bound');
  fake.assertClean();
});

test('getWeeklyOdds: a game whose only snapshots are after the bound is absent from the map, never a null quote', async (t) => {
  createFakePool([
    // The bound excluded every row for this game in SQL, so the query
    // legitimately returns nothing for it.
    [select('game_odds_snapshots'), () => ({ rows: [] })],
  ]).install(t);
  const odds = await getWeeklyOdds({
    season: 2026, week: 2, observedAtOrBefore: new Date('2026-09-11T00:00:00.000Z'),
  });
  assert.equal(odds.has('2026_02_BUF_MIA'), false);
  assert.equal(odds.size, 0);
});

test('getWeeklyOdds: no snapshots for the week is an empty map, not an error', async (t) => {
  createFakePool([
    [select('game_odds_snapshots'), () => ({ rows: [] })],
  ]).install(t);
  const odds = await getWeeklyOdds({ season: 2026, week: 99 });
  assert.equal(odds.size, 0);
});

test('getWeeklyOdds: honors an injected client (a transaction client, not the pool)', async () => {
  const seen = [];
  const client = {
    async query(text, params) {
      seen.push({ text, params });
      return { rows: [] };
    },
  };
  await getWeeklyOdds({ season: 2026, week: 2, client });
  assert.equal(seen.length, 1, 'the pool itself is never queried when a client is supplied');
});

// ---------------------------------------------------------------------------
// espnOddsProvider — the object installed via setVegasOddsProvider
// ---------------------------------------------------------------------------

test('espnOddsProvider satisfies the seam shape and reports itself available', () => {
  assert.equal(espnOddsProvider.available, true);
  assert.equal(espnOddsProvider.name, 'espn');
  assert.equal(typeof espnOddsProvider.getWeeklyOdds, 'function');
});
