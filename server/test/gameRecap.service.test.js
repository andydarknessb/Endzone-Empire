const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const {
  RECAPS_TABLE_SQL,
  DATA_VERSION,
  GENERATOR_VERSION,
} = require('../modules/recapStorage');
const svc = require('../services/gameRecap.service');

// ---- normalizers ------------------------------------------------------------

test('normalizeLineScore parses per-quarter arrays and handles overtime', () => {
  const box = {
    lineScore: {
      home: { Q1: '7', Q2: '10', Q3: '0', Q4: '7', totalPts: '24' },
      away: { Q1: '3', Q2: '14', Q3: '3', Q4: '0', OT: '6', totalPts: '26' },
    },
  };
  const ls = svc.normalizeLineScore(box);
  assert.deepEqual(ls.home, [7, 10, 0, 7]);
  assert.deepEqual(ls.away, [3, 14, 3, 0, 6]); // OT appended
});

test('normalizeLineScore returns null when absent', () => {
  assert.equal(svc.normalizeLineScore({}), null);
  assert.equal(svc.normalizeLineScore(null), null);
});

test('normalizeScoringPlays is chronological, tolerant, and skips junk', () => {
  const box = {
    scoringPlays: [
      { scorePeriod: 'Q1', scoreTime: '8:31', team: 'KC', score: 'Mahomes 5 yd TD', homeScore: '0', awayScore: '7' },
      null,
      { foo: 'bar' }, // no description, no team -> skipped
      { scorePeriod: 'Q2', team: 'BUF', scoreDetails: 'Bass 40 yd FG', homeScore: '3', awayScore: '7' },
    ],
  };
  const plays = svc.normalizeScoringPlays(box);
  assert.equal(plays.length, 2);
  assert.deepEqual(plays[0], {
    quarter: 'Q1', clock: '8:31', team: 'KC', description: 'Mahomes 5 yd TD', homeScore: 0, awayScore: 7,
  });
  assert.equal(plays[1].description, 'Bass 40 yd FG');
  assert.equal(plays[1].clock, null);
});

test('normalizeScoringPlays accepts a keyed object container', () => {
  const box = { scoringPlays: { a: { team: 'KC', score: 'TD', homeScore: '7', awayScore: '0' } } };
  const plays = svc.normalizeScoringPlays(box);
  assert.equal(plays.length, 1);
  assert.equal(plays[0].team, 'KC');
});

test('countLeadChanges counts flips, not tie-breaks', () => {
  // 0-7 (away lead), 7-7 (tie), 10-7 (home lead = 1 change), 10-14 (away = 2 changes)
  const plays = [
    { homeScore: 0, awayScore: 7 },
    { homeScore: 7, awayScore: 7 },
    { homeScore: 10, awayScore: 7 },
    { homeScore: 10, awayScore: 14 },
  ];
  assert.equal(svc.countLeadChanges(plays), 2);
});

// ---- templateNarrative (guaranteed default) --------------------------------

test('templateNarrative always produces >=2 sentences from minimal facts', () => {
  const text = svc.templateNarrative({
    homeTeam: 'PHI', awayTeam: 'DAL', homeScore: 24, awayScore: 20,
    scoringPlays: [], topPerformers: [],
  });
  assert.match(text, /PHI held off the DAL 24-20\./); // margin 4 -> "held off"
  assert.ok(text.split('. ').length >= 2, 'at least two sentences');
});

test('templateNarrative varies the verb by margin and notes overtime', () => {
  assert.match(
    svc.templateNarrative({ homeTeam: 'A', awayTeam: 'B', homeScore: 41, awayScore: 10, scoringPlays: [], topPerformers: [] }),
    /A routed the B 41-10\./
  );
  assert.match(
    svc.templateNarrative({ homeTeam: 'A', awayTeam: 'B', homeScore: 27, awayScore: 24, overtime: true, scoringPlays: [], topPerformers: [] }),
    /in overtime/
  );
});

test('templateNarrative handles a tie and calls out the top performer', () => {
  const tie = svc.templateNarrative({ homeTeam: 'A', awayTeam: 'B', homeScore: 20, awayScore: 20, scoringPlays: [], topPerformers: [] });
  assert.match(tie, /played to a 20-20 tie/);

  const withPerf = svc.templateNarrative({
    homeTeam: 'A', awayTeam: 'B', homeScore: 30, awayScore: 10,
    scoringPlays: [],
    topPerformers: [
      { name: 'Star Back', nflTeam: 'A', fantasyPoints: 31.2 },
      { name: 'Wideout Two', nflTeam: 'B', fantasyPoints: 24.8 },
    ],
  });
  assert.match(withPerf, /Star Back \(A\) paced all fantasy scorers with 31.2 points/);
  assert.match(withPerf, /Wideout Two close behind at 24.8/);
});

// ---- llmNarrative fallback --------------------------------------------------

test('llmNarrative returns null with no key and no client (template wins)', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(await svc.llmNarrative({ week: 1 }), null);
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('llmNarrative falls back to null when the client throws', async () => {
  const throwingClient = { messages: { create: async () => { throw new Error('boom'); } } };
  assert.equal(await svc.llmNarrative({ week: 1 }, { client: throwingClient }), null);
});

test('llmNarrative uses the enhanced text when the client succeeds', async () => {
  const client = {
    messages: {
      create: async () => ({ content: [{ type: 'text', text: 'Enhanced recap prose.' }] }),
    },
  };
  assert.equal(await svc.llmNarrative({ week: 1 }, { client }), 'Enhanced recap prose.');
});

// ---- generateForGame orchestration -----------------------------------------

const FINAL_STATE = {
  tank01_game_id: '20260112_KC@BUF', season: 2026, week: 19,
  home_team: 'BUF', away_team: 'KC', game_status: 'final',
  current_score_home: 24, current_score_away: 27, quarter: 'Final',
  last_updated: '2026-01-12T23:30:00Z',
  // Already stat-ingested, so these cases exercise recap building alone. See
  // the "one fetch" tests at the bottom for the ingest path.
  final_stats_synced_at: '2026-01-12T23:31:00Z',
};

function stubApi(box) {
  return { get: async () => ({ data: { body: box } }) };
}

test('generateForGame no-ops (returns null) when the game is not final', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [{ ...FINAL_STATE, game_status: 'in_progress' }] }));
  const out = await svc.generateForGame('20260112_KC@BUF', { api: stubApi({}) });
  assert.equal(out, null);
});

test('generateForGame no-ops when there is no live_game_states row', async (t) => {
  t.mock.method(pool, 'query', async () => ({ rows: [] }));
  const out = await svc.generateForGame('does-not-exist', { api: stubApi({}) });
  assert.equal(out, null);
});

test('generateForGame builds structured data and upserts idempotently', async (t) => {
  const box = {
    lineScore: {
      home: { Q1: '0', Q2: '14', Q3: '3', Q4: '7' },
      away: { Q1: '7', Q2: '3', Q3: '7', Q4: '10' },
    },
    scoringPlays: [
      { scorePeriod: 'Q1', team: 'KC', score: 'TD', homeScore: '0', awayScore: '7' },
    ],
  };
  let upsertParams = null;
  let upsertSql = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "live_game_states"')) return { rows: [FINAL_STATE] };
    if (text.includes('FROM "player_stats" "ps"')) {
      return { rows: [
        { id: 9, name: 'Star Back', position: 'RB', nfl_team: 'KC', photo_url: null, fantasy_points: '28.4', stats: { rushingYards: 130, rushingTDs: 2 } },
      ] };
    }
    if (text.includes(`INTO ${RECAPS_TABLE_SQL}`)) {
      upsertSql = text;
      upsertParams = params;
      return { rows: [{ tank01_game_id: params[0] }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  // No ANTHROPIC key -> template narrative guaranteed.
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  let data;
  try {
    data = await svc.generateForGame('20260112_KC@BUF', { api: stubApi(box) });
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }

  assert.ok(data);
  assert.equal(data.narrativeSource, 'template');
  assert.equal(data.topPerformers.length, 1);
  assert.equal(data.topPerformers[0].playerId, 9);
  assert.equal(data.topPerformers[0].statLine, '130 rush yds, 2 rush TD');
  assert.deepEqual(data.lineScore.home, [0, 14, 3, 7]);
  assert.match(data.narrative, /KC edged the BUF 27-24\./); // away won 27-24

  // Upsert carried the authoritative scores from live_game_states.
  assert.equal(upsertParams[0], '20260112_KC@BUF');
  assert.equal(upsertParams[5], 24); // home_score
  assert.equal(upsertParams[6], 27); // away_score
  assert.equal(upsertParams[9], DATA_VERSION);
  assert.equal(upsertParams[10], GENERATOR_VERSION);
  assert.equal(upsertParams[11], data.generatedAt);
  assert.equal(JSON.parse(upsertParams[8]).generatedAt, data.generatedAt);
  assert.match(upsertSql, /ON CONFLICT \("tank01_game_id"\) DO UPDATE/);
  assert.match(upsertSql, /"data_version" = EXCLUDED\."data_version"/);
  assert.match(upsertSql, /"generator_version" = EXCLUDED\."generator_version"/);
  assert.match(upsertSql, /"generated_at" = EXCLUDED\."generated_at"/);
});

// ---- recap queue: concurrency bound, dedupe, backoff -----------------------

const flush = () => new Promise((r) => setImmediate(r));

test('recap queue never exceeds its concurrency bound', async () => {
  let active = 0;
  let maxActive = 0;
  const started = [];
  const resolvers = new Map();
  const worker = (gameId) => new Promise((resolve) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    started.push(gameId);
    resolvers.set(gameId, () => { active -= 1; resolve(); });
  });

  const q = svc.createRecapQueue({ worker, concurrency: 2 });
  ['a', 'b', 'c', 'd', 'e'].forEach((id) => q.enqueue(id));

  // Only 2 run immediately; the rest wait.
  assert.equal(q.stats().active, 2);
  assert.deepEqual(started, ['a', 'b']);

  // Finish jobs one at a time; each completion admits exactly one more.
  for (const id of ['a', 'b', 'c', 'd', 'e']) {
    if (resolvers.has(id)) {
      resolvers.get(id)();
      await flush();
    }
  }
  assert.equal(maxActive, 2, 'concurrency never exceeded 2');
  assert.deepEqual(started.sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(q.stats().tracked, 0);
});

test('recap queue dedupes a game already queued or in-flight', () => {
  const worker = () => new Promise(() => {}); // never resolves -> stays in-flight
  const q = svc.createRecapQueue({ worker, concurrency: 1 });
  assert.equal(q.enqueue('g1'), true); // in-flight
  assert.equal(q.enqueue('g1'), false); // deduped (in-flight)
  assert.equal(q.enqueue('g2'), true); // pending (concurrency full)
  assert.equal(q.enqueue('g2'), false); // deduped (pending)
  assert.equal(q.stats().tracked, 2);
});

test('recap queue backs off on a 429 and retries the game, keeping it deduped', async () => {
  let calls = 0;
  const worker = async () => {
    calls += 1;
    if (calls === 1) {
      const err = new Error('rate limited');
      err.response = { status: 429, headers: {} };
      throw err;
    }
    // second attempt succeeds
  };
  const q = svc.createRecapQueue({ worker, concurrency: 1, backoffFor: () => 10 });
  assert.equal(q.enqueue('g1'), true);
  await flush();
  // Still tracked while backing off, so a concurrent sweep won't double it.
  assert.equal(q.has('g1'), true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(calls, 2, 'retried after backoff');
  assert.equal(q.stats().tracked, 0, 'cleared after eventual success');
});

test('retryAfterMs honors Retry-After only for 429s', () => {
  assert.equal(svc.retryAfterMs({ response: { status: 429, headers: { 'retry-after': '5' } } }), 5000);
  assert.equal(svc.retryAfterMs({ response: { status: 429, headers: {} } }), 30000); // default
  assert.equal(svc.retryAfterMs({ response: { status: 500, headers: {} } }), null); // not a rate limit
  assert.equal(svc.retryAfterMs(new Error('config error, no response')), null);
});

// ---- reconciliation sweep --------------------------------------------------

test('reconcileRecaps enqueues recent games with no recap or a stale generator version', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    assert.ok(text.includes(`LEFT JOIN ${RECAPS_TABLE_SQL}`));
    assert.match(text, /"gr"."tank01_game_id" IS NULL/);
    assert.match(text, /"gr"."generator_version" IS DISTINCT FROM \$2/);
    assert.match(text, /"game_status" = 'final'/);
    assert.match(text, /make_interval/); // time-bounded, not whole-season
    assert.equal(params[0], 14); // default maxAgeDays
    assert.equal(params[1], GENERATOR_VERSION);
    assert.equal(params[2], 100); // default limit
    return { rows: [{ tank01_game_id: 'gX' }, { tank01_game_id: 'gY' }] };
  });

  const enqueued = [];
  const res = await svc.reconcileRecaps({ enqueue: (id) => { enqueued.push(id); return true; } });
  assert.deepEqual(enqueued, ['gX', 'gY']);
  assert.deepEqual(res, { found: 2, enqueued: 2 });
});

test('reconcileRecaps counts only newly-accepted enqueues (dedupe against in-flight)', async (t) => {
  t.mock.method(pool, 'query', async () => ({
    rows: [{ tank01_game_id: 'gInFlight' }, { tank01_game_id: 'gNew' }],
  }));
  // gInFlight already queued by the live trigger -> enqueue returns false.
  const res = await svc.reconcileRecaps({ enqueue: (id) => id === 'gNew' });
  assert.equal(res.found, 2);
  assert.equal(res.enqueued, 1);
});

test('generateForGame prefers the LLM narrative when a client is injected', async (t) => {
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "live_game_states"')) return { rows: [FINAL_STATE] };
    if (text.includes('FROM "player_stats" "ps"')) return { rows: [] };
    if (text.includes(`INTO ${RECAPS_TABLE_SQL}`)) return { rows: [{ tank01_game_id: params[0] }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const client = {
    messages: { create: async () => ({ content: [{ type: 'text', text: 'LLM enhanced.' }] }) },
  };
  const data = await svc.generateForGame('20260112_KC@BUF', { api: stubApi({}), client });
  assert.equal(data.narrativeSource, 'llm');
  assert.equal(data.narrative, 'LLM enhanced.');
});

// ---- one box-score fetch serves the recap AND the final stat ingest ---------
//
// Before this, a finalized game was box-scored twice: once by syncWeekStats and
// again here for the recap (~69 wasted calls a month against a ~1,000/month
// plan). Now whichever path arrives first ingests the stats and stamps
// final_stats_synced_at, and the other skips.

test('generateForGame ingests final stats from the same box score and stamps the game', async (t) => {
  const box = {
    lineScore: { home: { Q1: '7', Q2: '7', Q3: '3', Q4: '7' }, away: { Q1: '10', Q2: '7', Q3: '3', Q4: '7' } },
    playerStats: {
      4433971: { playerID: '4433971', Rushing: { rushYds: '104', rushTD: '1' } },
    },
  };
  const statUpserts = [];
  let stamped = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "live_game_states"')) {
      return { rows: [{ ...FINAL_STATE, final_stats_synced_at: null }] };
    }
    if (text.includes('SET "final_stats_synced_at"')) {
      stamped = params[0];
      return { rows: [] };
    }
    if (text.includes('FROM "players" WHERE "external_id"')) {
      return { rows: [{ id: 7, external_id: '4433971', name: 'Star Back', position: 'RB', nfl_team: 'KC' }] };
    }
    if (text.includes(`"position" = 'DEF'`)) return { rows: [] };
    if (text.includes('INTO "player_stats"')) {
      statUpserts.push(params);
      return { rows: [] };
    }
    if (text.includes('FROM "player_stats" "ps"')) return { rows: [] }; // top performers
    if (text.includes('FROM "player_stats"')) return { rows: [] }; // prior week stats
    if (text.includes('FROM "nfl_games"')) return { rows: [] };
    if (text.includes(`INTO ${RECAPS_TABLE_SQL}`)) return { rows: [{ tank01_game_id: params[0] }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  let fetches = 0;
  const api = { get: async () => { fetches += 1; return { data: { body: box } }; } };
  const data = await svc.generateForGame('20260112_KC@BUF', { api });

  assert.equal(fetches, 1, 'exactly one box-score fetch');
  assert.equal(statUpserts.length, 1, 'the game’s player stats were ingested');
  assert.equal(JSON.parse(statUpserts[0][3]).rushingYards, 104);
  assert.equal(stamped, '20260112_KC@BUF', 'stamped so syncWeekStats skips it');
  assert.ok(data.narrative, 'the recap itself still got built');
});

test('generateForGame skips the ingest when the game was already stat-synced', async (t) => {
  const statUpserts = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "live_game_states"')) return { rows: [FINAL_STATE] }; // stamped
    if (text.includes('INTO "player_stats"')) {
      statUpserts.push(params);
      return { rows: [] };
    }
    if (text.includes('FROM "player_stats" "ps"')) return { rows: [] };
    if (text.includes(`INTO ${RECAPS_TABLE_SQL}`)) return { rows: [{ tank01_game_id: params[0] }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const data = await svc.generateForGame('20260112_KC@BUF', { api: stubApi({}) });
  assert.equal(statUpserts.length, 0);
  assert.ok(data);
});

test('generateForGame still produces a recap when the stat ingest fails', async (t) => {
  // A recap with stale stats beats no recap; the Mon-Thu nflverse pass is the
  // authoritative backstop for stats either way.
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql);
    if (text.includes('FROM "live_game_states"')) {
      return { rows: [{ ...FINAL_STATE, final_stats_synced_at: null }] };
    }
    if (text.includes('FROM "players" WHERE "external_id"')) throw new Error('players table exploded');
    if (text.includes('FROM "player_stats" "ps"')) return { rows: [] };
    if (text.includes(`INTO ${RECAPS_TABLE_SQL}`)) return { rows: [{ tank01_game_id: params[0] }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const data = await svc.generateForGame('20260112_KC@BUF', { api: stubApi({}) });
  assert.ok(data && data.narrative);
});
