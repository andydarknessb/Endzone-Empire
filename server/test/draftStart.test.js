const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { startDraft } = require('../services/draftStart.service');

const baseLeague = {
  id: 1,
  owner_id: 7,
  draft_status: 'pending',
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  keepers_enabled: false,
  keeper_count: 0,
  min_teams: 1,
  roster_limit: 2,
  pick_time_seconds: 60,
  autodraft_delay_seconds: 10,
};

const DEFAULT_TEAMS = [{ id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false }];

function draftClient({ league = baseLeague, keepers = [], teams = DEFAULT_TEAMS } = {}) {
  const calls = [];
  // The league row this transaction can see, including its OWN uncommitted
  // writes: a real client reads back what it just wrote, and the #194 phase
  // gate in generateRegularSeason depends on exactly that. A static row here
  // would model a database that forgets the UPDATE two statements earlier.
  const row = { ...league };
  const client = {
    release: () => calls.push('RELEASE'),
    query: async (sql) => {
      const text = String(sql);
      calls.push(text);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('SELECT * FROM "leagues"')) return { rows: [{ ...row }] };
      // isLeagueCommissioner's owner-or-co-commissioner probe.
      if (text.includes('SELECT 1 FROM "leagues"')) return { rows: [{ '?column?': 1 }] };
      if (text.includes('FROM "teams"')) return { rows: teams };
      if (text.includes('FROM "keepers"')) return { rows: keepers };
      // generateRegularSeason, run inline on this same client when the draft
      // completes immediately (every slot pre-filled by keepers).
      if (text.includes('FROM "matchups"')) return { rows: [] };
      if (text.startsWith('INSERT INTO "matchups"')) return { rows: [], rowCount: 1 };
      if (text.startsWith('UPDATE "leagues"')) {
        if (text.includes("'complete'")) row.draft_status = 'complete';
        else if (text.includes("'active'")) row.draft_status = 'active';
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('INSERT INTO "draft_picks"') || text.startsWith('INSERT INTO "team_players"')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  return { calls, client };
}

test('startDraft skips keeper reads and inserts when keepers are disabled', async (t) => {
  const tx = draftClient();
  t.mock.method(pool, 'connect', async () => tx.client);

  await startDraft({ leagueId: 1, userId: 7 });

  assert.ok(tx.calls.includes('COMMIT'));
  assert.ok(!tx.calls.includes('ROLLBACK'));
  assert.ok(!tx.calls.some((sql) => sql.includes('FROM "keepers"')));
  assert.ok(!tx.calls.some((sql) => sql.startsWith('INSERT INTO "draft_picks"')));
  assert.ok(!tx.calls.some((sql) => sql.startsWith('INSERT INTO "team_players"')));
});

// ADR 0005: starting a draft must fix draft_rounds once, from Draft roster
// size at that instant, so active/completed reads never recompute it.
test('startDraft fixes draft_rounds (roster_limit - ir_slots) when the draft goes active', async (t) => {
  const tx = draftClient({ league: { ...baseLeague, roster_limit: 20, ir_slots: 1 } });
  t.mock.method(pool, 'connect', async () => tx.client);

  await startDraft({ leagueId: 1, userId: 7 });

  const updateCall = tx.calls.find((sql) => sql.startsWith('UPDATE "leagues"') && sql.includes("'active'"));
  assert.ok(updateCall, 'expected an UPDATE ... SET draft_status = active');
  assert.match(updateCall, /"draft_rounds"\s*=\s*\$/);
});

test('startDraft fixes draft_rounds even when every roster slot is pre-filled by keepers (the draft completes without a single live pick)', async (t) => {
  const tx = draftClient({
    league: {
      ...baseLeague, roster_limit: 1, ir_slots: 0, keepers_enabled: true, keeper_count: 1,
      regular_season_weeks: 0, current_season: 2026, waiver_period_hours: 24,
    },
    keepers: [
      { team_id: 11, player_id: 101, draft_round: 1 },
      { team_id: 12, player_id: 201, draft_round: 1 },
    ],
    teams: [
      { id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false },
      { id: 12, owner_id: 8, draft_position: 2, autodraft: false, locked: false },
    ],
  });
  t.mock.method(pool, 'connect', async () => tx.client);

  await startDraft({ leagueId: 1, userId: 7 });

  const updateCall = tx.calls.find((sql) => sql.startsWith('UPDATE "leagues"') && sql.includes("'complete'"));
  assert.ok(updateCall, 'expected an UPDATE ... SET draft_status = complete');
  assert.match(updateCall, /"draft_rounds"\s*=\s*\$/);
});

test('startDraft rolls back without writes when keepers exceed the current per-team count', async (t) => {
  const tx = draftClient({
    league: { ...baseLeague, keepers_enabled: true, keeper_count: 1 },
    keepers: [
      { team_id: 11, player_id: 101, draft_round: 1 },
      { team_id: 11, player_id: 102, draft_round: 2 },
    ],
  });
  t.mock.method(pool, 'connect', async () => tx.client);

  await assert.rejects(
    startDraft({ leagueId: 1, userId: 7 }),
    (error) => error.statusCode === 409 && /allows 1/.test(error.message)
  );

  assert.ok(tx.calls.includes('ROLLBACK'));
  assert.ok(!tx.calls.includes('COMMIT'));
  assert.ok(!tx.calls.some((sql) => sql.startsWith('UPDATE "leagues"')));
  assert.ok(!tx.calls.some((sql) => sql.startsWith('INSERT INTO "draft_picks"')));
  assert.ok(!tx.calls.some((sql) => sql.startsWith('INSERT INTO "team_players"')));
});

// #194: the season engine now refuses to schedule a season for a league still
// pre-draft or drafting, and this path calls it INSIDE the start transaction.
// It survives that gate only because the draft_status = 'complete' UPDATE runs
// first, so the engine's read on this same client sees 'complete'. Nothing in
// draftStart.service states that order, so pin it: reordering those two
// statements would break every keeper-filled draft start.
test('startDraft marks the draft complete BEFORE it generates the season schedule (#194)', async (t) => {
  const tx = draftClient({
    league: {
      ...baseLeague, roster_limit: 1, ir_slots: 0, keepers_enabled: true, keeper_count: 1,
      regular_season_weeks: 1, current_season: 2026, waiver_period_hours: 24,
    },
    keepers: [
      { team_id: 11, player_id: 101, draft_round: 1 },
      { team_id: 12, player_id: 201, draft_round: 1 },
    ],
    teams: [
      { id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false },
      { id: 12, owner_id: 8, draft_position: 2, autodraft: false, locked: false },
    ],
  });
  t.mock.method(pool, 'connect', async () => tx.client);

  await startDraft({ leagueId: 1, userId: 7 });

  const completedAt = tx.calls.findIndex(
    (sql) => sql.startsWith('UPDATE "leagues"') && sql.includes("'complete'")
  );
  const scheduledAt = tx.calls.findIndex((sql) => sql.includes('"matchups"'));
  assert.notEqual(completedAt, -1, 'the draft was marked complete');
  assert.notEqual(scheduledAt, -1, 'the season engine ran on this transaction');
  assert.ok(
    completedAt < scheduledAt,
    'draft_status must be set to complete before generateRegularSeason is called'
  );
  assert.ok(tx.calls.includes('COMMIT'));
  assert.ok(!tx.calls.includes('ROLLBACK'));
});
