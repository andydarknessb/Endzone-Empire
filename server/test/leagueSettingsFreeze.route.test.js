const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const pool = require('../modules/pool');
const { signToken } = require('../modules/auth');
const leagueRouter = require('../routes/league.router');
const { settingsUnfrozenWhereSql } = require('../services/leaguePhase');

/**
 * PUT /api/league/:id settings freeze, read through League phase: the
 * draft-frozen keys lock once a fantasy league is past pre-draft, and a
 * pick'em-only league (no draft) never draft-freezes anything, while its
 * fantasy-only keys are still refused by league TYPE. Prior art: the
 * pre-draft race test (same harness) and the league-type PUT tests.
 */

const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'league-settings-freeze-test-secret';
after(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

const app = express();
app.use(express.json());
app.use('/api/league', leagueRouter);

const COMMISSIONER = 7;
const authed = () => `Bearer ${signToken({ id: COMMISSIONER, username: 'commissioner' })}`;

const statusRow = (over = {}) => ({
  draft_status: 'pending', draft_type: 'snake', min_teams: 2, max_teams: 10, draft_date: null,
  roster_slots: [], bench_slots: 0, ir_slots: 0, position_caps: {}, roster_limit: 15,
  keepers_enabled: false, keeper_count: 0, pickem_only: false, team_count: 3, ...over,
});

/** Mock the pool: the status read answers with `status`, the UPDATE succeeds. */
function mockPool(t, status) {
  const calls = [];
  t.mock.method(pool, 'query', async (sql, params) => {
    const text = String(sql).replace(/\s+/g, ' ').trim();
    calls.push({ text, params });
    if (text.includes('SELECT "draft_status"')) return { rows: [statusRow(status)] };
    if (text.startsWith('UPDATE "leagues"')) {
      return { rows: [{ id: 1, owner_id: COMMISSIONER, name: 'Ballers', pickem_only: Boolean(status.pickem_only) }], rowCount: 1 };
    }
    if (text.startsWith('INSERT INTO "notifications"')) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  return calls;
}

test("a pick'em-only league is never draft-frozen: maxTeams is accepted whatever draft_status says", async (t) => {
  // A pick'em-only league never drafts, so this row is unreachable today; it
  // is the row that tells the phase rule apart from the raw column compare
  // ("draft_status !== 'pending' means locked") that used to sit here.
  const calls = mockPool(t, { pickem_only: true, draft_status: 'active', season_status: 'regular' });
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ maxTeams: 12 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = calls.find((c) => c.text.startsWith('UPDATE "leagues"'));
  assert.ok(update, 'the UPDATE ran');
  // The race guard is the phase module's fragment, which admits a pick'em-only row.
  assert.ok(update.text.includes(settingsUnfrozenWhereSql()), update.text);
});

test("a pick'em-only league still refuses fantasy-only keys by league type, not by the freeze", async (t) => {
  const calls = mockPool(t, { pickem_only: true, draft_status: 'active', season_status: 'regular' });
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ pickTimeSeconds: 90 });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, 'PICKEM_ONLY_LEAGUE');
  assert.doesNotMatch(res.body.error, /locked once the draft starts/);
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'no UPDATE ran');
});

test('a fantasy league past pre-draft refuses draft-frozen keys with the existing message and never updates', async (t) => {
  const calls = mockPool(t, { pickem_only: false, draft_status: 'active', season_status: 'regular' });
  const res = await request(app).put('/api/league/1').set('Authorization', authed())
    .send({ pickTimeSeconds: 90, maxTeams: 12 });
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, 'these settings are locked once the draft starts: pickTimeSeconds, maxTeams');
  assert.ok(!calls.some((c) => c.text.startsWith('UPDATE "leagues"')), 'no UPDATE ran');
});

test('a fantasy league still pre-draft accepts draft-frozen keys and guards the UPDATE on the freeze rule', async (t) => {
  const calls = mockPool(t, { pickem_only: false, draft_status: 'pending', season_status: 'regular' });
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ pickTimeSeconds: 90 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = calls.find((c) => c.text.startsWith('UPDATE "leagues"'));
  assert.ok(update, 'the UPDATE ran');
  assert.ok(update.text.includes(settingsUnfrozenWhereSql()), update.text);
});

test('an administrative-only update carries no freeze guard', async (t) => {
  const calls = mockPool(t, { pickem_only: false, draft_status: 'active', season_status: 'regular' });
  const res = await request(app).put('/api/league/1').set('Authorization', authed()).send({ name: 'Renamed' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const update = calls.find((c) => c.text.startsWith('UPDATE "leagues"'));
  assert.ok(update, 'the UPDATE ran');
  assert.ok(!update.text.includes(settingsUnfrozenWhereSql()), update.text);
});
