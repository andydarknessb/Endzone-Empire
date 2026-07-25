const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const activityService = require('../services/activity.service');
const leagueRouter = require('../routes/league.router');

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-schedule-validation-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);
const authorization = () => `Bearer ${signToken({ id: 7, username: 'commissioner' })}`;

// --- roster slot validation (no DB needed — all reject before any query) ----

const SLOT = (key, eligiblePositions, count = 1) => ({ key, count, eligiblePositions });

test('roster slots: an "IDP FLEX" slot with a space in the name and DL/LB/DB eligibility validates', async (t) => {
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return { rows: [{
        draft_status: 'pending', draft_type: 'snake', min_teams: 2, max_teams: 12, draft_date: null,
        roster_slots: [], bench_slots: 5, ir_slots: 1, position_caps: {}, roster_limit: 15,
        keepers_enabled: false, keeper_count: 0, team_count: 2,
      }] };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      return { rows: [{ id: 1, owner_id: 7 }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ rosterSlots: [SLOT('QB', ['QB']), SLOT('IDP FLEX', ['DL', 'LB', 'DB'])], dpEnabled: true });
  assert.equal(response.status, 200);
});

test('roster slots: each failure mode gets a specific message, not the generic catch-all', async (t) => {
  t.mock.method(pool, 'query', async () => {
    throw new Error('validation failures must not reach the database');
  });
  const put = (rosterSlots) =>
    request(app).put('/api/league/1').set('Authorization', authorization()).send({ rosterSlots });

  let res = await put([SLOT('FLEX!IDP', ['DL'])]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /slot "FLEX!IDP": name must be 1-20 characters/);

  res = await put([SLOT(' IDP', ['DL'])]); // leading space
  assert.equal(res.status, 400);
  assert.match(res.body.error, /cannot start with a space/);

  res = await put([SLOT('BENCH', ['RB'])]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /reserved for the bench\/IR system/);

  res = await put([SLOT('WR', [])]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /slot "WR": pick at least one eligible position/);

  res = await put([SLOT('FLEX', ['RB', 'XX'])]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /unknown position "XX"/);

  res = await put([SLOT('RB', ['RB']), SLOT('RB', ['RB'])]);
  assert.equal(res.status, 400);
  assert.match(res.body.error, /slot names must be unique/);

  res = await put([SLOT('DL', ['DL'], 2), SLOT('LB', ['LB'], 2)]); // 4 DP starters
  assert.equal(res.status, 400);
  assert.match(res.body.error, /DP-eligible starting slots cannot exceed 3/);
});

test('rejects past and current draft schedules before querying the database', async (t) => {
  let queryCount = 0;
  t.mock.method(pool, 'query', async () => {
    queryCount++;
    throw new Error('database should not be queried');
  });

  const pastResponse = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ draftDate: new Date(Date.now() - 60000).toISOString() });
  const currentResponse = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ draftDate: new Date().toISOString() });

  assert.equal(pastResponse.status, 400);
  assert.equal(currentResponse.status, 400);
  assert.match(pastResponse.body.error, /must be in the future/);
  assert.match(currentResponse.body.error, /must be in the future/);
  assert.equal(queryCount, 0);
});

test('accepts a near-future draft schedule', async (t) => {
  const draftDate = new Date(Date.now() + 60000).toISOString();
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return {
        rows: [{
          draft_status: 'pending', min_teams: 2, max_teams: 12, draft_date: null,
          roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
          keepers_enabled: false, keeper_count: 0, team_count: 2,
        }],
      };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', draft_status: 'pending', draft_date: draftDate }] };
    }
    if (text.includes('SELECT DISTINCT "owner_id"')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ draftDate });

  assert.equal(response.status, 200);
  assert.equal(response.body.draft_date, draftDate);
});

test('returns the persisted schedule when activity notification delivery fails', async (t) => {
  const draftDate = new Date(Date.now() + 60000).toISOString();
  let persistedDraftDate = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return {
        rows: [{
          draft_status: 'pending', min_teams: 2, max_teams: 12, draft_date: null,
          roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
          keepers_enabled: false, keeper_count: 0, team_count: 2,
        }],
      };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      persistedDraftDate = draftDate;
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', draft_status: 'pending', draft_date: persistedDraftDate }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  t.mock.method(activityService, 'notifyLeague', async () => {
    throw new Error('notification database unavailable');
  });
  t.mock.method(console, 'error', () => {});

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ draftDate });

  assert.equal(response.status, 200);
  assert.equal(persistedDraftDate, draftDate);
  assert.equal(response.body.draft_date, persistedDraftDate);
});

test('switching a scheduled league to auction clears the schedule in the same update', async (t) => {
  const existingDraftDate = new Date(Date.now() + 3600000).toISOString();
  let updateQuery = null;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return {
        rows: [{
          draft_status: 'pending', draft_type: 'snake', min_teams: 2, max_teams: 12,
          draft_date: existingDraftDate, roster_slots: [], bench_slots: 0, ir_slots: 0,
          position_caps: {}, roster_limit: 15, keepers_enabled: false, keeper_count: 0,
          team_count: 2,
        }],
      };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      updateQuery = text;
      return { rows: [{ id: 1, owner_id: 7, draft_status: 'pending', draft_type: 'auction', draft_date: null }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ draftType: 'auction' });

  assert.equal(response.status, 200);
  assert.equal(response.body.draft_type, 'auction');
  assert.equal(response.body.draft_date, null);
  assert.match(updateQuery, /WHEN \$27::text = 'auction' THEN NULL/);
});

test('rejects a direct attempt to schedule an existing auction league', async (t) => {
  const draftDate = new Date(Date.now() + 60000).toISOString();
  let updateCalled = false;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return {
        rows: [{
          draft_status: 'pending', draft_type: 'auction', min_teams: 2, max_teams: 12,
          draft_date: null, roster_slots: [], bench_slots: 0, ir_slots: 0,
          position_caps: {}, roster_limit: 15, keepers_enabled: false, keeper_count: 0,
          team_count: 2,
        }],
      };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      updateCalled = true;
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ draftDate });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /auction drafts cannot be scheduled/);
  assert.equal(updateCalled, false);
});

test('rejects a schedule when the league is converted to auction between the read and the write', async (t) => {
  const draftDate = new Date(Date.now() + 60000).toISOString();
  // Shared row mutated mid-request to model a concurrent auction conversion.
  const currentRow = {
    draft_status: 'pending', draft_type: 'snake', min_teams: 2, max_teams: 12,
    draft_date: null, roster_slots: [], bench_slots: 0, ir_slots: 0,
    position_caps: {}, roster_limit: 15, keepers_enabled: false, keeper_count: 0,
    team_count: 2,
  };
  let updateCalled = false;
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.startsWith('UPDATE "leagues"')) {
      updateCalled = true;
      // Emulate the atomic guard: the non-null date write requires draft_type <> 'auction'.
      if (currentRow.draft_type === 'auction') return { rows: [] };
      currentRow.draft_date = draftDate;
      return { rows: [{ id: 1, owner_id: 7, draft_status: 'pending', draft_type: 'snake', draft_date: draftDate }] };
    }
    if (text.includes('SELECT "draft_status"')) {
      // Request A passes its initial (snake) type check, then Request B converts
      // the league to auction and clears the date before A reaches its UPDATE.
      const snapshot = { ...currentRow };
      currentRow.draft_type = 'auction';
      currentRow.draft_date = null;
      return { rows: [snapshot] };
    }
    if (text.includes('SELECT "draft_type" FROM')) {
      return { rows: [{ draft_type: currentRow.draft_type }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });

  const response = await request(app)
    .put('/api/league/1')
    .set('Authorization', authorization())
    .send({ draftDate });

  assert.equal(response.status, 409);
  assert.match(response.body.error, /auction/i);
  assert.equal(updateCalled, true);
  // No non-null date persisted; the league remains an auction with a cleared date.
  assert.equal(currentRow.draft_type, 'auction');
  assert.equal(currentRow.draft_date, null);
});

test('does not delay the schedule response while activity notification is pending', async (t) => {
  const draftDate = new Date(Date.now() + 60000).toISOString();
  t.mock.method(pool, 'query', async (sql) => {
    const text = String(sql);
    if (text.includes('SELECT "draft_status"')) {
      return {
        rows: [{
          draft_status: 'pending', draft_type: 'snake', min_teams: 2, max_teams: 12,
          draft_date: null, roster_slots: [], bench_slots: 0, ir_slots: 0,
          position_caps: {}, roster_limit: 15, keepers_enabled: false, keeper_count: 0,
          team_count: 2,
        }],
      };
    }
    if (text.startsWith('UPDATE "leagues"')) {
      return { rows: [{ id: 1, owner_id: 7, name: 'Sunday Ballers', draft_status: 'pending', draft_date: draftDate }] };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const notify = t.mock.method(activityService, 'notifyLeague', () => new Promise(() => {}));

  let timeoutId;
  try {
    const response = await Promise.race([
      request(app)
        .put('/api/league/1')
        .set('Authorization', authorization())
        .send({ draftDate }),
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve({ status: 'timed-out' }), 250);
      }),
    ]);

    assert.equal(response.status, 200);
    assert.equal(response.body.draft_date, draftDate);
  } finally {
    clearTimeout(timeoutId);
  }

  // Fire-and-forget is intentional, but the notification must still be dispatched —
  // guard against a future refactor silently dropping the call.
  assert.equal(notify.mock.calls.length, 1);
  const [, payload] = notify.mock.calls[0].arguments;
  assert.equal(payload.leagueId, 1);
  assert.equal(payload.type, 'draft_scheduled');
  assert.match(payload.message, /draft has been scheduled/);
  assert.equal(payload.data.url, '/#/league/1');
  assert.equal(payload.data.draftDate, draftDate);
});
