const { test } = require('node:test');
const assert = require('node:assert/strict');
const { narrative, readConfig, MODEL } = require('../services/claude');

const NOW = new Date('2026-10-15T12:00:00Z');
const REQ = { feature: 'recap', system: 'sys', user: 'usr' };

// Stub pool: the budget SELECT answers `spent`; INSERTs are recorded.
function stubPool(spent = 0) {
  const inserts = [];
  return {
    inserts,
    selects: [],
    async query(sql, params) {
      if (/INSERT INTO "llm_usage"/.test(sql)) { inserts.push(params); return { rows: [] }; }
      this.selects.push(params);
      return { rows: [{ spent }] };
    },
  };
}

function stubClient(response) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (args) => {
        calls.push(args);
        if (response instanceof Error) throw response;
        return response;
      },
    },
  };
}

const OK = {
  content: [{ type: 'text', text: ' Hello ' }, { type: 'thinking', thinking: 'x' }, { type: 'text', text: 'world. ' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 100 },
};

test('no key and no client returns null without calling', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const pool = stubPool();
    assert.equal(await narrative(REQ, { pool, now: NOW }), null);
    assert.equal(pool.selects.length, 0);
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('budget spent returns null without calling the model', async () => {
  const client = stubClient(OK);
  const pool = stubPool(20);
  assert.equal(await narrative(REQ, { client, pool, now: NOW }), null);
  assert.equal(client.calls.length, 0);
  assert.equal(pool.inserts.length, 0);
  // The sum covers the billing cycle that began on the 1st.
  assert.equal(pool.selects[0][0].toISOString(), '2026-10-01T00:00:00.000Z');
});

test('success returns trimmed text and records usage with exact usd', async () => {
  const client = stubClient(OK);
  const pool = stubPool(0);
  assert.equal(await narrative(REQ, { client, pool, now: NOW }), 'Hello world.');
  assert.equal(client.calls.length, 1);
  assert.deepEqual(client.calls[0], {
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: 'low' },
    system: 'sys',
    messages: [{ role: 'user', content: 'usr' }],
  });
  // 1000*4 + 500*20 + 2000*0.2 + 100*5 = 14900 per 1M -> 0.0149
  assert.equal(pool.inserts.length, 1);
  assert.deepEqual(pool.inserts[0], ['recap', MODEL, 1000, 500, 2000, 100, 0.0149]);
});

test('a client that throws returns null', async () => {
  const pool = stubPool(0);
  assert.equal(await narrative(REQ, { client: stubClient(new Error('boom')), pool, now: NOW }), null);
  assert.equal(pool.inserts.length, 0);
});

test('a refusal returns null', async () => {
  const client = stubClient({ ...OK, stop_reason: 'refusal' });
  assert.equal(await narrative(REQ, { client, pool: stubPool(0), now: NOW }), null);
});

test('a stop_reason other than end_turn returns null, usage still recorded', async () => {
  const pool = stubPool(0);
  assert.equal(await narrative(REQ, { client: stubClient({ ...OK, stop_reason: 'max_tokens' }), pool, now: NOW }), null);
  assert.equal(pool.inserts.length, 1);
});

test('placeholder tokens are put back; a mangled token returns null', async () => {
  const placeholders = { '[[team:1]]': 'Real Name', '[[team:2]]': 'Other Name' };
  const say = (text) => ({ ...OK, content: [{ type: 'text', text }] });
  assert.equal(
    await narrative({ ...REQ, placeholders }, { client: stubClient(say('[[team:1]] beat [[team:2]]; [[team:1]] rules.')), pool: stubPool(0), now: NOW }),
    'Real Name beat Other Name; Real Name rules.'
  );
  assert.equal(
    await narrative({ ...REQ, placeholders }, { client: stubClient(say('[[team:1]] beat [[team: 2]].')), pool: stubPool(0), now: NOW }),
    null
  );
  assert.equal(
    await narrative({ ...REQ, placeholders }, { client: stubClient(say('[[team:3]] invented a team.')), pool: stubPool(0), now: NOW }),
    null
  );
});

test('ANTHROPIC_MONTHLY_BUDGET=0 spends nothing; empty means the default', async () => {
  const prev = process.env.ANTHROPIC_MONTHLY_BUDGET;
  try {
    process.env.ANTHROPIC_MONTHLY_BUDGET = '0';
    assert.equal(readConfig().budget, 0);
    const client = stubClient(OK);
    assert.equal(await narrative(REQ, { client, pool: stubPool(0), now: NOW }), null);
    assert.equal(client.calls.length, 0);
    process.env.ANTHROPIC_MONTHLY_BUDGET = '';
    assert.equal(readConfig().budget, 20);
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_MONTHLY_BUDGET;
    else process.env.ANTHROPIC_MONTHLY_BUDGET = prev;
  }
});

test('a failed llm_usage insert still returns the text', async () => {
  const pool = stubPool(0);
  pool.query = async (sql) => {
    if (/INSERT INTO/.test(sql)) throw new Error('no table');
    return { rows: [{ spent: 0 }] };
  };
  assert.equal(await narrative(REQ, { client: stubClient(OK), pool, now: NOW }), 'Hello world.');
});
