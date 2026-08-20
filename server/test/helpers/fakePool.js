/**
 * Shared fake for the pg pool seam: SQL-matcher dispatch with a call log.
 *
 * This is an observation harness, not a database simulator: it answers what
 * the matchers say and records what was asked, nothing more. It never
 * enforces constraints, foreign keys or real transaction effects; suites
 * that need behavioral parity with Postgres use the real thing
 * (test:holdout-pg, test:backtest-pg).
 *
 *   const fake = createFakePool([
 *     [select('teams'), () => ({ rows: [{ id: 1 }] })], // shape matcher
 *     [/FROM "nfl_games"/, (text, params) => ({ rows: [] })], // raw regex
 *     [insert('trades'), () => { throw new Error('deadlock'); }], // fault
 *     [/FROM "leagues"/, () => ({ rows: [] }), 'client'], // client side only
 *   ]);
 *   fake.install(t); // or pass `fake` straight in as an injected `db` argument
 *   // (for an injected *client* argument, pass `await fake.connect()` instead:
 *   // the top-level fake has no release() and no transaction state of its own)
 *
 * Entries are tried in order (put overrides before defaults, a catch-all
 * last); an unmatched query throws — with one exception: an unmatched
 * BEGIN/COMMIT/ROLLBACK on a checked-out client auto-answers `{ rows: [] }`.
 * Transactions are enforced either way (COMMIT/ROLLBACK without BEGIN and a
 * double release throw; `assertClean()` proves every client was released and
 * no transaction was left open). Every statement lands in `calls` as
 * `{ via: 'pool'|'client', text, params }`. The handlers array is live, so a
 * suite may keep pushing entries after creation (see pickem.router.test.js);
 * stateful "worlds" are handlers closing over a mutable object (see
 * pickemSeasonWorld in scheduler.test.js).
 *
 * Migration rule: touching a suite's hand-rolled DB fake means migrating it
 * to this helper. Standing exemption: holdout.service.test.js's fakeDb stays
 * bespoke on purpose — it is a small database simulator (staged-buffer
 * transactions, unique/CHECK constraint errors, a fake clock) whose coverage
 * a matcher table cannot express. Do not flatten it into this helper.
 */
const normalize = (sql) => String(sql).replace(/\s+/g, ' ').trim();

const TX = /^(BEGIN|COMMIT|ROLLBACK)$/;

function createFakePool(handlers = []) {
  const calls = [];
  const clients = [];

  async function dispatch(via, tx, sql, params) {
    const text = normalize(sql);
    calls.push({ via, text, params });
    if (TX.test(text)) {
      if (!tx) throw new Error(`transactional statement on the pool: ${text}`);
      if (text !== 'BEGIN' && !tx.open) throw new Error(`${text} without BEGIN`);
    }
    let result;
    const matched = handlers.find(([pattern, , side]) => (!side || side === via) && pattern.test(text));
    if (matched) {
      const [, handler] = matched;
      result = await handler(text, params);
    } else if (TX.test(text)) {
      result = { rows: [] };
    } else {
      throw new Error(`unexpected query: ${text}`);
    }
    if (tx && TX.test(text)) tx.open = text === 'BEGIN';
    return result;
  }

  async function connect() {
    const state = { released: false, open: false };
    clients.push(state);
    return {
      query: (sql, params) => dispatch('client', state, sql, params),
      release: () => {
        if (state.released) throw new Error('client released twice');
        state.released = true;
      },
    };
  }

  return {
    calls,
    matching: (re) => calls.filter((call) => re.test(call.text)),
    query: (sql, params) => dispatch('pool', null, sql, params),
    connect,
    // Patches the shared pool module for the duration of the test; node:test
    // restores the originals when the test ends.
    install(t) {
      const pool = require('../../modules/pool');
      t.mock.method(pool, 'query', (sql, params) => dispatch('pool', null, sql, params));
      t.mock.method(pool, 'connect', connect);
      return this;
    },
    assertClean() {
      for (const state of clients) {
        if (!state.released) throw new Error('client never released');
        if (state.open) throw new Error('transaction left open');
      }
    },
  };
}

// Verb/table matchers: keyed on the statement's shape (verb + quoted table
// identifier), so reformatting a query does not break the match. Anchored to
// the statement's leading verb: a CTE (`WITH ... SELECT`) or a table that is
// not the statement's first FROM needs a raw regex instead.
const select = (table) => new RegExp(`^SELECT (?:(?! FROM ).)* FROM "${table}"`);
const insert = (table) => new RegExp(`^INSERT INTO "${table}"`);
const update = (table) => new RegExp(`^UPDATE "${table}"`);
const remove = (table) => new RegExp(`^DELETE FROM "${table}"`);

module.exports = { createFakePool, select, insert, update, remove };
