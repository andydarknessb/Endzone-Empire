const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduledDraftAction } = require('../services/draftSchedule.service');

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
