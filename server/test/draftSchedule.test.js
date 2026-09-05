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
  return createFakePool([
    [/^SELECT "id", "name", "owner_id"/, () => ({ rows: [league] })],
    [/^SELECT "draft_status", "draft_date", "draft_type", "min_teams", "draft_reminder_stage"/, () => ({ rows: [fresh] })],
    // The market gate's count of players carrying an ADP (#747), read once per
    // tick. Default clears MARKET_FLOOR so the pre-#747 cases are unaffected.
    [/FROM "players" WHERE "adp" IS NOT NULL/, () => ({ rows: [{ n: market }] })],
    [/^UPDATE "leagues" SET "draft_autostart_failed" = true WHERE "id" = \$1$/, () => ({ rows: [], rowCount: 1 })],
    [/^UPDATE "leagues" SET "draft_autostart_failed" = true WHERE "id" = \$1 AND "draft_status" = 'pending'$/, () => ({ rows: [], rowCount: 1 })],
    [/FROM "league_commissioners"/, () => ({ rows: coCommissioners.map((user_id) => ({ user_id, username: `co${user_id}` })) })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

test('understaffed: notifies the owner AND every co-commissioner, not the owner alone', async (t) => {
  // runAction's row-locked recheck (draftSchedule.service.js) reads the real
  // wall clock rather than the injected `now`, so it must also see NOW here.
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
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
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
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
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
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
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
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

test('a scheduled start that fails to auto-start notifies the owner AND every co-commissioner', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
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
