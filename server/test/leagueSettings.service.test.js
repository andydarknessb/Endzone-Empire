const { test } = require('node:test');
const assert = require('node:assert/strict');
const activityService = require('../services/activity.service');
const { PICKEM_ONLY_CODE } = require('../services/leagueType');
const {
  parseSettingsPatch,
  updateLeagueSettings,
  LeagueSettingsError,
} = require('../services/leagueSettings.service');

/**
 * updateLeagueSettings(db, { leagueId, userId, patch }) against an injected
 * fake pool (spec #71, PR 2 = #73): the write path owns the conditional
 * transaction and refuses by throwing LeagueSettingsError. No supertest; the
 * route adapter is covered by the six existing PUT /api/league/:id route
 * files, which must keep passing unchanged.
 */

const LEAGUE_ID = 1;
const USER_ID = 7;

const statusRow = (over = {}) => ({
  draft_status: 'pending', draft_type: 'snake', min_teams: 2, max_teams: 12, draft_date: null,
  roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }], bench_slots: 0, ir_slots: 0,
  position_caps: {}, roster_limit: 15,
  keepers_enabled: true, keeper_count: 2, pickem_only: false, team_count: 2, ...over,
});

const UPDATED_ROW = Object.freeze({ id: LEAGUE_ID, owner_id: USER_ID, name: 'Ballers', draft_status: 'pending' });

/**
 * A fake pool. Every statement is recorded as { via, text, params } where
 * `via` says whether it ran on the pool itself or on the connected client, so
 * a test can assert the transaction placement and not just the SQL order.
 * The answer table is the same one the route tests use.
 */
function fakeDb({
  status = statusRow(),
  teams = [{ id: 11 }, { id: 12 }],
  assignmentCounts = [],
  updateRows = [UPDATED_ROW],
  recheckRows = [],
} = {}) {
  const calls = [];
  let released = 0;
  let connected = 0;
  const answer = async (via, sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ via, text, params });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
    if (text.includes('SELECT "draft_status"')) return { rows: status ? [status] : [] };
    if (text.startsWith('SELECT "id" FROM "teams"')) return { rows: teams };
    if (text.includes('COUNT(*)::int AS "count"')) return { rows: assignmentCounts };
    if (text.startsWith('DELETE FROM "keepers"')) return { rows: [], rowCount: assignmentCounts.length };
    if (text.startsWith('UPDATE "leagues"')) return { rows: updateRows, rowCount: updateRows.length };
    if (text.startsWith('SELECT "draft_type" FROM "leagues"')) return { rows: recheckRows };
    throw new Error(`Unexpected SQL: ${text}`);
  };
  const client = {
    query: (sql, params) => answer('client', sql, params),
    release: () => { released += 1; },
  };
  const db = {
    query: (sql, params) => answer('pool', sql, params),
    connect: async () => { connected += 1; return client; },
    calls,
    client,
    released: () => released,
    connected: () => connected,
    texts: () => calls.map((c) => c.text),
    firstWord: () => calls.map((c) => c.text.split(' ')[0]),
  };
  return db;
}

const patchOf = (body) => {
  const parsed = parseSettingsPatch(body);
  assert.equal(parsed.error, undefined, parsed.error);
  return parsed.value;
};

const run = (db, body) => updateLeagueSettings(db, { leagueId: LEAGUE_ID, userId: USER_ID, patch: patchOf(body) });

async function refusal(db, body) {
  try {
    await run(db, body);
  } catch (error) {
    assert.ok(error instanceof LeagueSettingsError, `expected LeagueSettingsError, got ${error && error.stack}`);
    return error;
  }
  assert.fail('expected updateLeagueSettings to throw');
  return null;
}

test('LeagueSettingsError carries statusCode and (optionally) code, and is an Error', () => {
  const plain = new LeagueSettingsError(409, 'nope');
  assert.ok(plain instanceof Error);
  assert.equal(plain.statusCode, 409);
  assert.equal(plain.message, 'nope');
  assert.equal(plain.code, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(plain, 'code'), false);
  const coded = new LeagueSettingsError(409, 'nope', { code: 'X' });
  assert.equal(coded.code, 'X');
});

test('keeper clear: connects, BEGINs, reads FOR UPDATE, DELETEs the assignments, UPDATEs, COMMITs, releases', async () => {
  const db = fakeDb({ assignmentCounts: [{ team_id: 11, count: 2 }] });
  const row = await run(db, { keepersEnabled: false });
  assert.deepEqual(row, UPDATED_ROW);
  assert.deepEqual(db.firstWord(), ['BEGIN', 'SELECT', 'SELECT', 'DELETE', 'UPDATE', 'COMMIT']);
  assert.ok(db.calls.every((c) => c.via === 'client'), 'every statement runs on the connected client');
  assert.match(db.calls[1].text, / FOR UPDATE$/);
  assert.deepEqual(db.calls[1].params, [LEAGUE_ID, USER_ID]);
  assert.equal(db.calls[3].text, 'DELETE FROM "keepers" WHERE "league_id" = $1');
  assert.equal(db.released(), 1);
});

test('keeper conflict: 409 naming the team, ROLLBACK, no UPDATE, client released, no code', async () => {
  const db = fakeDb({ status: statusRow({ keeper_count: 2 }), assignmentCounts: [{ team_id: 11, count: 2 }] });
  const error = await refusal(db, { keeperCount: 1 });
  assert.equal(error.statusCode, 409);
  assert.equal(error.message, 'keeperCount cannot be set to 1: team 11 has 2 existing keeper assignment(s); remove assignments first or disable keepers');
  assert.equal(error.code, undefined);
  assert.deepEqual(db.firstWord(), ['BEGIN', 'SELECT', 'SELECT', 'ROLLBACK']);
  assert.equal(db.released(), 1);
});

test('auction custom order that is not a permutation of the teams: 400 under FOR UPDATE, then ROLLBACK', async () => {
  const db = fakeDb({ status: statusRow({ keepers_enabled: false, keeper_count: 0 }), teams: [{ id: 11 }, { id: 12 }] });
  const error = await refusal(db, {
    auctionSettings: {
      budget: 200, nominationSeconds: 30, bidSeconds: 15,
      nominationOrder: 'custom', nominationCustomOrder: [11, 13],
    },
  });
  assert.equal(error.statusCode, 400);
  assert.equal(error.message, 'nominationCustomOrder must list every current team exactly once');
  assert.deepEqual(db.firstWord(), ['BEGIN', 'SELECT', 'SELECT', 'ROLLBACK']);
  assert.match(db.calls[1].text, / FOR UPDATE$/);
  assert.equal(db.calls[2].text, 'SELECT "id" FROM "teams" WHERE "league_id" = $1');
  assert.equal(db.released(), 1);
});

test('frozen pre-check: an active-draft league 409s naming only the locked (draft-frozen) keys, no transaction, no UPDATE', async () => {
  const db = fakeDb({ status: statusRow({ draft_status: 'active' }) });
  const error = await refusal(db, { waiverType: 'faab', draftType: 'snake', playoffTeams: 4 });
  assert.equal(error.statusCode, 409);
  assert.equal(error.message, 'these settings are locked once the draft starts: playoffTeams, draftType');
  assert.equal(error.code, undefined);
  assert.deepEqual(db.firstWord(), ['SELECT']);
  assert.equal(db.calls[0].via, 'pool');
  assert.doesNotMatch(db.calls[0].text, /FOR UPDATE/);
  assert.equal(db.connected(), 0, 'no client is connected on the non-transaction path');
  assert.equal(db.released(), 0);
});

test('race loser: the status read said pre-draft, the guarded UPDATE hit zero rows, so 409 naming every frozen key requested', async () => {
  const db = fakeDb({ updateRows: [] });
  const error = await refusal(db, { playoffTeams: 4, draftType: 'snake' });
  assert.equal(error.statusCode, 409);
  assert.equal(error.message, 'these settings are locked once the draft starts: playoffTeams, draftType');
  assert.deepEqual(db.firstWord(), ['SELECT', 'UPDATE']);
  assert.match(db.calls[1].text, /AND \("pickem_only" = true OR "draft_status" = 'pending'\)/);
  assert.equal(db.released(), 0);
});

test("pick'em refusal: 409 carrying code PICKEM_ONLY_CODE, naming what was sent, and on the transaction path it ROLLBACKs", async () => {
  const db = fakeDb({ status: statusRow({ pickem_only: true, keepers_enabled: false, keeper_count: 0 }) });
  const error = await refusal(db, { keepersEnabled: true, waiverType: 'faab' });
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, PICKEM_ONLY_CODE);
  assert.equal(error.message, "these settings do not apply to a pick'em league: keepersEnabled, waiverType");
  assert.deepEqual(db.firstWord(), ['BEGIN', 'SELECT', 'ROLLBACK']);
  assert.equal(db.released(), 1);
});

test('size limit: maxTeams below the live team count is a 400 from the size rule, nothing written', async () => {
  const db = fakeDb({ status: statusRow({ team_count: 5 }) });
  const error = await refusal(db, { maxTeams: 4 });
  assert.equal(error.statusCode, 400);
  assert.equal(error.message, 'maxTeams cannot be below the 5 team(s) already in the league');
  assert.deepEqual(db.firstWord(), ['SELECT']);
});

test('403 fallthrough: a name-only patch skips the status read; zero rows from the UPDATE means not found / not the commissioner', async () => {
  const db = fakeDb({ updateRows: [] });
  const error = await refusal(db, { name: 'Renamed' });
  assert.equal(error.statusCode, 403);
  assert.equal(error.message, 'league not found or you are not the commissioner');
  assert.deepEqual(db.firstWord(), ['UPDATE']);
  assert.equal(db.calls[0].via, 'pool');
  assert.equal(db.calls[0].params[0], 'Renamed');
  assert.equal(db.calls[0].params[16], LEAGUE_ID);
  assert.equal(db.calls[0].params[17], USER_ID);
  assert.equal(db.connected(), 0);
  assert.equal(db.released(), 0);
});

test('a name-only patch on a commissioner league resolves with the row and never touches the keeper/team tables', async () => {
  const db = fakeDb();
  const row = await run(db, { name: 'Renamed' });
  assert.deepEqual(row, UPDATED_ROW);
  assert.deepEqual(db.firstWord(), ['UPDATE']);
});

test('the UPDATE parameters: roster_limit is derived from the merged roster shape (starters + bench + IR), absent keys are null', async () => {
  const db = fakeDb({ status: statusRow({ roster_slots: [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }, { key: 'RB', count: 2, eligiblePositions: ['RB'] }], bench_slots: 4, ir_slots: 1 }) });
  await run(db, { name: 'Renamed', benchSlots: 6, positionCaps: { QB: 3, RB: 5 } });
  const update = db.calls.find((c) => c.text.startsWith('UPDATE "leagues"'));
  assert.equal(update.params.length, 37);
  // An empty name is a parse-time 400 since #66, so the write path's || null
  // coercion is unreachable for a provided name; a valid one passes through.
  assert.equal(update.params[0], 'Renamed');
  assert.equal(update.params[1], 3 + 6 + 1, 'starters from the row (1 + 2) + the new bench + the row IR');
  assert.equal(update.params[3], JSON.stringify({ QB: 3, RB: 5 }));
  assert.equal(update.params[24], 6);
  assert.equal(update.params[2], null, 'rosterSlots was not sent');
  assert.equal(update.params[36], false, 'tradeDeadlineWeek was not sent');
});
test('notification: fired once, after COMMIT, on the pool argument (not the client), with the scheduled verb and date', async (t) => {
  const db = fakeDb({ status: statusRow({ draft_date: null }) });
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const seen = [];
  t.mock.method(activityService, 'notifyLeague', async (target, payload) => {
    seen.push({ target, payload, textsSoFar: db.texts() });
  });
  const row = await run(db, { keepersEnabled: true, draftDate: future });
  assert.deepEqual(row, UPDATED_ROW);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].target, db, 'notifies on the pool passed in, never the transaction client');
  assert.equal(seen[0].textsSoFar.at(-1), 'COMMIT', 'COMMIT has already run when the notification fires');
  assert.equal(seen[0].payload.leagueId, LEAGUE_ID);
  assert.equal(seen[0].payload.type, 'draft_scheduled');
  assert.equal(seen[0].payload.message, "Ballers's draft has been scheduled.");
  assert.deepEqual(seen[0].payload.data, { url: `/#/league/${LEAGUE_ID}`, draftDate: future });
});

test('notification: rescheduling says "rescheduled"; an unchanged date or a clear sends nothing', async (t) => {
  const existing = new Date(Date.now() + 172_800_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const notify = t.mock.method(activityService, 'notifyLeague', async () => {});

  await run(fakeDb({ status: statusRow({ draft_date: existing }) }), { draftDate: future });
  assert.equal(notify.mock.calls.length, 1);
  assert.equal(notify.mock.calls[0].arguments[1].message, "Ballers's draft has been rescheduled.");

  await run(fakeDb({ status: statusRow({ draft_date: future }) }), { draftDate: future });
  await run(fakeDb({ status: statusRow({ draft_date: existing }) }), { draftDate: null });
  assert.equal(notify.mock.calls.length, 1, 'no notification for an unchanged date or a clear');
});

test('notification: a rejected notification does not surface (row still returned, error logged)', async (t) => {
  const db = fakeDb();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  t.mock.method(activityService, 'notifyLeague', async () => { throw new Error('activity outage'); });
  const logged = t.mock.method(console, 'error', () => {});
  const row = await run(db, { draftDate: future });
  assert.deepEqual(row, UPDATED_ROW);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(logged.mock.calls.some((c) => c.arguments[0] === 'Failed to send draft schedule notification'));
});

test('notification: a synchronously throwing notifier does not surface either', async (t) => {
  const db = fakeDb();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  t.mock.method(activityService, 'notifyLeague', () => { throw new Error('sync outage'); });
  const logged = t.mock.method(console, 'error', () => {});
  const row = await run(db, { draftDate: future });
  assert.deepEqual(row, UPDATED_ROW);
  assert.ok(logged.mock.calls.some((c) => c.arguments[0] === 'Failed to send draft schedule notification'));
});

test('an unexpected database error on the transaction path ROLLBACKs, releases, and propagates as-is (not a LeagueSettingsError)', async () => {
  const db = fakeDb({ assignmentCounts: [{ team_id: 11, count: 2 }] });
  const boom = new Error('connection reset');
  const original = db.client.query;
  db.client.query = (sql, params) => {
    if (String(sql).startsWith('DELETE')) { db.calls.push({ via: 'client', text: 'DELETE FROM "keepers" WHERE "league_id" = $1', params }); return Promise.reject(boom); }
    return original(sql, params);
  };
  await assert.rejects(run(db, { keepersEnabled: false }), (error) => error === boom);
  assert.deepEqual(db.firstWord(), ['BEGIN', 'SELECT', 'SELECT', 'DELETE', 'ROLLBACK']);
  assert.equal(db.released(), 1);
});

test('a throwing client.release() does not replace a committed result: the row is returned and the failure is logged', async (t) => {
  const db = fakeDb({ assignmentCounts: [{ team_id: 11, count: 1 }] });
  db.client.release = () => { throw new Error('Release called on client which has already been released to the pool.'); };
  const logged = t.mock.method(console, 'error', () => {});
  const row = await run(db, { keeperCount: 3 });
  assert.deepEqual(row, UPDATED_ROW);
  assert.equal(db.firstWord().at(-1), 'COMMIT');
  assert.ok(logged.mock.calls.some((c) => c.arguments[0] === 'Failed to release the league settings client'));
});

test('a throwing client.release() does not replace a refusal either: the 409 still surfaces as a LeagueSettingsError', async (t) => {
  const db = fakeDb({ status: statusRow({ keeper_count: 2 }), assignmentCounts: [{ team_id: 11, count: 2 }] });
  db.client.release = () => { throw new Error('release failed'); };
  t.mock.method(console, 'error', () => {});
  const error = await refusal(db, { keeperCount: 1 });
  assert.equal(error.statusCode, 409);
  assert.equal(db.firstWord().at(-1), 'ROLLBACK');
});
test('a refusal whose ROLLBACK throws still surfaces the intended 4xx, not a 500 (#68)', async (t) => {
  const db = fakeDb({ status: statusRow({ keeper_count: 2 }), assignmentCounts: [{ team_id: 11, count: 2 }] });
  const originalQuery = db.client.query;
  db.client.query = (sql, params) => {
    if (String(sql) === 'ROLLBACK') { db.calls.push({ via: 'client', text: 'ROLLBACK' }); return Promise.reject(new Error('connection terminated')); }
    return originalQuery(sql, params);
  };
  t.mock.method(console, 'error', () => {});
  const error = await refusal(db, { keeperCount: 1 });
  assert.equal(error.statusCode, 409, 'the keeper conflict 409 survives the failed ROLLBACK');
  assert.equal(db.firstWord().filter((w) => w === 'ROLLBACK').length, 1, 'no second ROLLBACK from the outer catch');
  assert.equal(db.released(), 1);
});
test('the auction conversion race: zero rows + a re-read saying auction is the distinct 409, ahead of the frozen message', async () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const db = fakeDb({ updateRows: [], recheckRows: [{ draft_type: 'auction' }] });
  const error = await refusal(db, { draftDate: future });
  assert.equal(error.statusCode, 409);
  assert.equal(error.message, 'this league was converted to a salary-cap auction; auction drafts cannot be scheduled');
  assert.deepEqual(db.firstWord(), ['SELECT', 'UPDATE', 'SELECT']);
  assert.match(db.calls[1].text, /AND "draft_type" <> 'auction'/);
});
