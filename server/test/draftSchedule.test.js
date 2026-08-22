const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduledDraftAction, processScheduledDrafts } = require('../services/draftSchedule.service');
const { createFakePool } = require('./helpers/fakePool');

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
  draft_date: new Date(Date.now() - 60000).toISOString(), draft_type: 'snake', min_teams: 8,
  pick_time_seconds: 30, draft_reminder_stage: 0, draft_autostart_failed: false, team_count: 5, ...over,
});

// The re-read `runAction` does under FOR UPDATE, shaped without id/name/owner_id/team_count fields.
const FRESH_ROW = (over = {}) => ({
  draft_status: 'pending', draft_date: new Date(Date.now() - 60000).toISOString(), draft_type: 'snake',
  min_teams: 8, draft_reminder_stage: 0, draft_autostart_failed: false, team_count: 5, ...over,
});

function scheduleFakePool({ league, fresh, coCommissioners = [] } = {}) {
  return createFakePool([
    [/^SELECT "id", "name", "owner_id"/, () => ({ rows: [league] })],
    [/^SELECT "draft_status", "draft_date", "draft_type", "min_teams", "draft_reminder_stage"/, () => ({ rows: [fresh] })],
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
