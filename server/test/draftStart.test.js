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

function draftClient({ league = baseLeague, keepers = [] } = {}) {
  const calls = [];
  const client = {
    release: () => calls.push('RELEASE'),
    query: async (sql) => {
      const text = String(sql);
      calls.push(text);
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('SELECT * FROM "leagues"')) return { rows: [league] };
      if (text.includes('FROM "teams"')) {
        return { rows: [{ id: 11, owner_id: 7, draft_position: 1, autodraft: false, locked: false }] };
      }
      if (text.includes('FROM "keepers"')) return { rows: keepers };
      if (text.startsWith('UPDATE "leagues"')) return { rows: [], rowCount: 1 };
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
