const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduledDraftAction, processScheduledDrafts } = require('../services/draftSchedule.service');
const { createFakePool } = require('./helpers/fakePool');
const { MARKET_FLOOR } = require('../services/adp.service');

const NOW = new Date('2026-09-05T12:00:00Z');
const base = {
  draft_status: 'pending',
  min_teams: 8,
  draft_reminder_stage: 0,
  draft_autostart_failed: false,
};
const at = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();
const HOUR = 60 * 60 * 1000;

test('no action without a draft date or when not pending', () => {
  assert.equal(scheduledDraftAction({ ...base, draft_date: null }, 8, NOW), null);
  assert.equal(
    scheduledDraftAction({ ...base, draft_status: 'active', draft_date: at(-HOUR) }, 8, NOW),
    null
  );
});

test('auto-starts once the time has arrived and the minimum is met', () => {
  assert.equal(scheduledDraftAction({ ...base, draft_date: at(-60000) }, 8, NOW), 'start');
  assert.equal(scheduledDraftAction({ ...base, draft_date: at(-60000) }, 9, NOW), 'start');
});

test('nudges the commissioner once when the time arrives understaffed', () => {
  assert.equal(scheduledDraftAction({ ...base, draft_date: at(-60000) }, 5, NOW), 'understaffed');
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(-60000), draft_autostart_failed: true }, 5, NOW),
    null
  );
});

test('sends the 1h reminder once', () => {
  assert.equal(scheduledDraftAction({ ...base, draft_date: at(30 * 60 * 1000) }, 8, NOW), 'remind_1h');
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(30 * 60 * 1000), draft_reminder_stage: 2 }, 8, NOW),
    null
  );
});

test('sends the 24h reminder once, then waits for the 1h window', () => {
  assert.equal(scheduledDraftAction({ ...base, draft_date: at(10 * HOUR) }, 8, NOW), 'remind_24h');
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(10 * HOUR), draft_reminder_stage: 1 }, 8, NOW),
    null
  );
});

test('no reminder yet when the draft is more than a day out', () => {
  assert.equal(scheduledDraftAction({ ...base, draft_date: at(48 * HOUR) }, 8, NOW), null);
});

test('a thin market at start time yields no_market, and flags only once (#747)', () => {
  // Staffed and due, but the market has not loaded: refuse the auto-start once,
  // like understaffed. A market at MARKET_FLOOR clears it and starts.
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(-60000) }, 8, NOW, MARKET_FLOOR - 1),
    'no_market'
  );
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(-60000), draft_autostart_failed: true }, 8, NOW, MARKET_FLOOR - 1),
    null
  );
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(-60000) }, 8, NOW, MARKET_FLOOR),
    'start'
  );
});

test('an understaffed league is nudged for staffing before the market is even considered', () => {
  // Understaffed takes precedence: the market check only matters once a start
  // is otherwise possible. (Absent the market arg, behaviour is unchanged.)
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(-60000) }, 5, NOW, MARKET_FLOOR - 1),
    'understaffed'
  );
});

test('a scheduled auction draft flags instead of starting, and only once', () => {
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(-60000), draft_type: 'auction' }, 8, NOW),
    'auction_unsupported'
  );
  assert.equal(
    scheduledDraftAction({ ...base, draft_date: at(-60000), draft_type: 'auction', draft_autostart_failed: true }, 8, NOW),
    null
  );
});

/* ------------------------------------------------------------------ *
 * Commissioner notification (#116): a scheduled-start failure must     *
 * reach every CURRENT commissioner, not just the league creator.       *
 * ------------------------------------------------------------------ */

const OWNER = 7;
const CO_COMMISSIONER = 9;
const LEAGUE_ID = 1;

const LEAGUE_ROW = (over = {}) => ({
  id: LEAGUE_ID, name: 'Ballers', owner_id: OWNER, draft_status: 'pending',
  draft_date: at(-60000), draft_type: 'snake', min_teams: 8,
  pick_time_seconds: 30, draft_reminder_stage: 0, draft_autostart_failed: false, team_count: 5, ...over,
});

// The re-read `runAction` does under FOR UPDATE, shaped without id/name/owner_id/team_count fields.
const FRESH_ROW = (over = {}) => ({
  draft_status: 'pending', draft_date: at(-60000), draft_type: 'snake',
  min_teams: 8, draft_reminder_stage: 0, draft_autostart_failed: false, team_count: 5, ...over,
});

function scheduleFakePool({ league, fresh, coCommissioners = [], market = 500 } = {}) {
  // `market` is either a fixed count or a function called per query, so a test
  // can make the count change between the tick's read and the locked re-read
  // (#882: a concurrent ADP sync landing during the FOR UPDATE wait).
  const marketFn = typeof market === 'function' ? market : () => market;
  return createFakePool([
    [/^SELECT "id", "name", "owner_id"/, () => ({ rows: [league] })],
    [/^SELECT "draft_status", "draft_date", "draft_type", "min_teams", "draft_reminder_stage"/, () => ({ rows: [fresh] })],
    // The market gate's count of players carrying an ADP (#747), read once per
    // tick. Default clears MARKET_FLOOR so the pre-#747 cases are unaffected.
    [/FROM "players" WHERE "adp" IS NOT NULL/, () => ({ rows: [{ n: marketFn() }] })],
    [/^UPDATE "leagues" SET "draft_autostart_failed" = true WHERE "id" = \$1$/, () => ({ rows: [], rowCount: 1 })],
    [/^UPDATE "leagues" SET "draft_autostart_failed" = true WHERE "id" = \$1 AND "draft_status" = 'pending'$/, () => ({ rows: [], rowCount: 1 })],
    [/FROM "league_commissioners"/, () => ({ rows: coCommissioners.map((user_id) => ({ user_id, username: `co${user_id}` })) })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

test('understaffed: notifies the owner AND every co-commissioner, not the owner alone', async (t) => {
  const fake = scheduleFakePool({
    league: LEAGUE_ROW({ min_teams: 8, team_count: 5 }),
    fresh: FRESH_ROW({ min_teams: 8, team_count: 5 }),
    coCommissioners: [CO_COMMISSIONER],
  });
  fake.install(t);

  const actions = await processScheduledDrafts({ now: NOW });
  assert.deepEqual(actions, [{ leagueId: LEAGUE_ID, action: 'understaffed' }]);

  const notifications = fake.matching(/^INSERT INTO "notifications"/);
  assert.equal(notifications.length, 2, 'one notification per current commissioner');
  const notifiedUserIds = notifications.map((c) => c.params[0]).sort();
  assert.deepEqual(notifiedUserIds, [OWNER, CO_COMMISSIONER].sort());
  for (const call of notifications) {
    assert.equal(call.params[1], LEAGUE_ID);
    assert.equal(call.params[2], 'draft_understaffed');
    assert.match(call.params[3], /couldn't auto-start/);
  }
});

test('auction_unsupported: notifies the owner AND every co-commissioner', async (t) => {
  const fake = scheduleFakePool({
    league: LEAGUE_ROW({ draft_type: 'auction', min_teams: 8, team_count: 5 }),
    fresh: FRESH_ROW({ draft_type: 'auction', min_teams: 8, team_count: 5 }),
    coCommissioners: [CO_COMMISSIONER],
  });
  fake.install(t);

  const actions = await processScheduledDrafts({ now: NOW });
  assert.deepEqual(actions, [{ leagueId: LEAGUE_ID, action: 'auction_unsupported' }]);

  const notifiedUserIds = fake.matching(/^INSERT INTO "notifications"/).map((c) => c.params[0]).sort();
  assert.deepEqual(notifiedUserIds, [OWNER, CO_COMMISSIONER].sort());
});

test('a solo commissioner (no co-commissioners) still gets exactly one notification', async (t) => {
  const fake = scheduleFakePool({
    league: LEAGUE_ROW({ min_teams: 8, team_count: 5 }),
    fresh: FRESH_ROW({ min_teams: 8, team_count: 5 }),
    coCommissioners: [],
  });
  fake.install(t);

  await processScheduledDrafts({ now: NOW });
  const notifications = fake.matching(/^INSERT INTO "notifications"/);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].params[0], OWNER);
});

test('no_market: notifies commissioners with type draft_no_market and the market copy, flagging once (#747)', async (t) => {
  // Staffed and due (min_teams 2, 5 teams), but only 99 players carry an ADP.
  const league = LEAGUE_ROW({ min_teams: 2, team_count: 5 });
  const fresh = FRESH_ROW({ min_teams: 2, team_count: 5 });
  const fake = scheduleFakePool({ league, fresh, coCommissioners: [CO_COMMISSIONER], market: MARKET_FLOOR - 1 });
  fake.install(t);

  const actions = await processScheduledDrafts({ now: NOW });
  assert.deepEqual(actions, [{ leagueId: LEAGUE_ID, action: 'no_market' }]);

  const notifications = fake.matching(/^INSERT INTO "notifications"/);
  assert.equal(notifications.length, 2, 'one notification per current commissioner');
  assert.deepEqual(notifications.map((c) => c.params[0]).sort(), [OWNER, CO_COMMISSIONER].sort());
  for (const call of notifications) {
    assert.equal(call.params[1], LEAGUE_ID);
    assert.equal(call.params[2], 'draft_no_market', 'a new type, not draft_understaffed');
    assert.equal(
      call.params[3],
      `Ballers couldn't auto-start: the player market has not loaded (${MARKET_FLOOR - 1} of ${MARKET_FLOOR} players carry an ADP). `
        + 'Ask your admin to run the ADP sync, then start the draft manually or reschedule.'
    );
  }
  // Flagged once, like understaffed: draft_autostart_failed is set so the next
  // tick recomputes to null.
  assert.equal(fake.matching(/SET "draft_autostart_failed" = true/).length, 1);
});

/* ------------------------------------------------------------------ *
 * #882: the transient-market-count race. The tick reads the global    *
 * count once and carries it; if an ADP sync lands during the FOR       *
 * UPDATE wait, a carried "no_market" is stale. Re-read under the lock   *
 * for that one action so a market that HAS loaded is not reported as    *
 * missing.                                                              *
 * ------------------------------------------------------------------ */

test('no_market that clears the floor on the locked re-read bails: no notification, no flag (#882)', async (t) => {
  // Staffed and due. The tick's market read answers MARKET_FLOOR - 1 (no_market),
  // but the ADP sync lands during the lock wait, so the locked re-read answers
  // MARKET_FLOOR. The recheck now computes 'start', disagrees with the carried
  // 'no_market', and bails: the market loaded, so no commissioner is told it did
  // not, and the league is not flagged (the next tick returns 'start').
  const league = LEAGUE_ROW({ min_teams: 2, team_count: 5 });
  const fresh = FRESH_ROW({ min_teams: 2, team_count: 5 });
  let reads = 0;
  const market = () => (++reads === 1 ? MARKET_FLOOR - 1 : MARKET_FLOOR);
  const fake = scheduleFakePool({ league, fresh, coCommissioners: [CO_COMMISSIONER], market });
  fake.install(t);

  await processScheduledDrafts({ now: NOW });

  assert.equal(fake.matching(/^INSERT INTO "notifications"/).length, 0, 'the market loaded: no no_market notification');
  assert.equal(fake.matching(/SET "draft_autostart_failed" = true/).length, 0, 'no flag on a bail');
});

test('no_market re-reads the count on the locked client and speaks the fresh value (#882)', async (t) => {
  // The market stays at MARKET_FLOOR - 1 on both reads, so the re-read agrees with
  // the carried 'no_market' and the notification is sent. The market query is
  // issued exactly twice: once by the tick (via the pool) and once by runAction
  // under the lock (via the client). The copy uses the re-read (fresh) value.
  const league = LEAGUE_ROW({ min_teams: 2, team_count: 5 });
  const fresh = FRESH_ROW({ min_teams: 2, team_count: 5 });
  const fake = scheduleFakePool({ league, fresh, coCommissioners: [CO_COMMISSIONER], market: MARKET_FLOOR - 1 });
  fake.install(t);

  const actions = await processScheduledDrafts({ now: NOW });
  assert.deepEqual(actions, [{ leagueId: LEAGUE_ID, action: 'no_market' }]);

  const marketReads = fake.matching(/FROM "players" WHERE "adp" IS NOT NULL/);
  assert.equal(marketReads.length, 2, 'the tick reads once, runAction re-reads once under the lock');
  assert.deepEqual(marketReads.map((c) => c.via).sort(), ['client', 'pool'], 'once via the pool, once via the locked client');

  const notifications = fake.matching(/^INSERT INTO "notifications"/);
  assert.equal(notifications.length, 2, 'one per commissioner');
  for (const call of notifications) {
    assert.equal(call.params[2], 'draft_no_market');
    assert.match(call.params[3], new RegExp(`\\(${MARKET_FLOOR - 1} of ${MARKET_FLOOR} players carry an ADP\\)`));
  }
});

test('understaffed issues no market re-read: only actions that could show a stale count re-read (#882)', async (t) => {
  // The re-read is confined to the no_market branch. An understaffed tick reads
  // the market once (the tick's own read) and never again under the lock.
  const fake = scheduleFakePool({
    league: LEAGUE_ROW({ min_teams: 8, team_count: 5 }),
    fresh: FRESH_ROW({ min_teams: 8, team_count: 5 }),
    coCommissioners: [CO_COMMISSIONER],
  });
  fake.install(t);

  const actions = await processScheduledDrafts({ now: NOW });
  assert.deepEqual(actions, [{ leagueId: LEAGUE_ID, action: 'understaffed' }]);
  assert.equal(
    fake.matching(/FROM "players" WHERE "adp" IS NOT NULL/).length,
    1,
    'no re-read outside the no_market branch'
  );
});

test('a scheduled start that fails to auto-start notifies the owner AND every co-commissioner', async (t) => {
  const league = LEAGUE_ROW({ min_teams: 2, team_count: 5 }); // enough teams: the action is 'start'
  const fresh = FRESH_ROW({ min_teams: 2, team_count: 5 });
  const fake = scheduleFakePool({ league, fresh, coCommissioners: [CO_COMMISSIONER] });
  fake.install(t);

  const draftStartService = require('../services/draftStart.service');
  const boom = Object.assign(new Error('keepers are stale, resave them first'), { statusCode: 409 });
  t.mock.method(draftStartService, 'startDraft', async () => { throw boom; });

  const actions = await processScheduledDrafts({ now: NOW });
  assert.deepEqual(actions, [{ leagueId: LEAGUE_ID, action: 'start' }]);

  const notifications = fake.matching(/^INSERT INTO "notifications"/);
  assert.equal(notifications.length, 2, 'one notification per current commissioner');
  const notifiedUserIds = notifications.map((c) => c.params[0]).sort();
  assert.deepEqual(notifiedUserIds, [OWNER, CO_COMMISSIONER].sort());
  for (const call of notifications) {
    assert.match(call.params[3], /couldn't auto-start: keepers are stale, resave them first/);
  }
});

test('the row-locked recheck bails when the locked row changed under it (concurrent sweep already sent the 1h reminder)', async (t) => {
  // The tick decides remind_1h from the unlocked read (draft is 30 min out,
  // stage 0). While runAction waits on the lock, a concurrent sweep commits
  // draft_reminder_stage = 2. The FOR UPDATE re-read returns that fresh stage,
  // scheduledDraftAction recomputes to null against the SAME injected `now`
  // (not the clock), so the recheck bails. The bail is proven by the absence of
  // side effects - no reminder UPDATE, no notification - not by the returned
  // actions array (that push is unconditional on runAction not throwing, and a
  // bail returns without throwing). This is the guard the #880 clock change
  // leaves intact: the re-read of the row, not the wall clock, stops the
  // double-send. Were the guard reading `league` (stage 0) instead of the
  // re-read `fresh` (stage 2), it would proceed and issue a second reminder,
  // which scheduleFakePool has no matcher for and would throw on.
  const inWindow = at(30 * 60 * 1000); // 30 min out: remind_1h at tick
  const league = LEAGUE_ROW({ draft_date: inWindow, draft_reminder_stage: 0, min_teams: 2, team_count: 5 });
  const fresh = FRESH_ROW({ draft_date: inWindow, draft_reminder_stage: 2, min_teams: 2, team_count: 5 });
  const fake = scheduleFakePool({ league, fresh, coCommissioners: [CO_COMMISSIONER] });
  fake.install(t);

  await processScheduledDrafts({ now: NOW });
  assert.equal(fake.matching(/^INSERT INTO "notifications"/).length, 0, 'no notification on a bail');
  // The discriminating assertion: a bail issues no reminder-stage UPDATE. Were
  // the guard broken and the reminder to proceed, that UPDATE (which no matcher
  // answers) would still land in the call log as an attempted query.
  assert.equal(fake.matching(/SET "draft_reminder_stage"/).length, 0, 'no reminder-stage UPDATE on a bail');
  assert.equal(fake.matching(/FOR UPDATE/).length, 1, 'the row was locked and re-read exactly once');
});
