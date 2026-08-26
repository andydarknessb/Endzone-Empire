const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DRAFT_ACTIVITY,
  PICK,
  activityEntryOf,
  appendPickActivity,
} = require('../services/draftActivity');
const { TEAM_IDENTITY_FIELDS } = require('../services/teamIdentity');

const [TEAM_ID, TEAM_NAME] = TEAM_IDENTITY_FIELDS;

/**
 * Fast unit tests for the Draft-activity feed half (#435, ADR 0012). These pin
 * the typed feed-entry SHAPE and that appendPickActivity writes one row inside
 * the caller's transaction client and returns that entry. The DATABASE claims
 * (shared per-league sequence, trigger allocation, combined ordering, the
 * append-only rollback guard) live in draftActivity.pg.test.js against a real
 * Postgres - a matcher fake cannot express them.
 */

// A draft_activity row as it comes back normalized (teamId/teamName already
// aliased, the shape both the append path and the combined read produce).
const ROW = {
  source: DRAFT_ACTIVITY,
  kind: PICK,
  id: 9,
  feed_seq: '14', // bigint arrives from pg as a string
  [TEAM_ID]: 11,
  [TEAM_NAME]: 'Gridiron Ghosts',
  player_id: 500,
  player_name: 'Pick Me',
  player_position: 'RB',
  player_nfl_team: 'KC',
  round: 2,
  pick_number: 13,
  is_autopick: false,
  created_at: '2026-09-01T00:00:00.000Z',
};

test('activityEntryOf shapes a typed draft_activity feed entry with Team-only identity', () => {
  const entry = activityEntryOf(ROW);
  assert.equal(entry.type, DRAFT_ACTIVITY);
  assert.equal(entry.kind, PICK);
  assert.equal(entry.id, 9);
  // feed_seq is a bigint; the entry hands the client a JSON number cursor.
  assert.equal(entry.seq, 14);
  assert.strictEqual(typeof entry.seq, 'number');
  assert.equal(entry[TEAM_ID], 11);
  assert.equal(entry[TEAM_NAME], 'Gridiron Ghosts');
  assert.deepEqual(entry.player, { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' });
  assert.equal(entry.round, 2);
  assert.equal(entry.pickNumber, 13);
  assert.equal(entry.isAutopick, false);
  assert.equal(entry.created_at, '2026-09-01T00:00:00.000Z');
});

test('activityEntryOf never leaks an account identifier', () => {
  const entry = activityEntryOf({ ...ROW, user_id: 42, owner_id: 42, username: 'u42' });
  for (const leak of ['user_id', 'userId', 'owner_id', 'username']) {
    assert.equal(leak in entry, false, `${leak} must not appear on a draft activity entry`);
  }
});

test('activityEntryOf reads missing Team identity back as null, not an omitted key', () => {
  const entry = activityEntryOf({ ...ROW, [TEAM_ID]: null, [TEAM_NAME]: null });
  assert.equal(entry[TEAM_ID], null);
  assert.equal(entry[TEAM_NAME], null);
  assert.ok(TEAM_ID in entry && TEAM_NAME in entry);
});

test('appendPickActivity inserts one pick row on the caller transaction and returns its entry', async () => {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      // Mirror the trigger + RETURNING: feed_seq allocated by the DB.
      return { rows: [{ id: 9, feed_seq: '14', created_at: '2026-09-01T00:00:00.000Z' }] };
    },
  };

  const entry = await appendPickActivity(client, {
    leagueId: 1,
    team: { id: 11, name: 'Gridiron Ghosts' },
    player: { id: 500, name: 'Pick Me', position: 'RB', nfl_team: 'KC' },
    round: 2,
    pickNumber: 13,
    auto: false,
  });

  assert.equal(calls.length, 1, 'exactly one INSERT');
  assert.match(calls[0].text, /INSERT INTO "draft_activity"/);
  // The INSERTED columns do NOT name feed_seq: the BEFORE INSERT trigger
  // allocates it from the shared per-league sequence, exactly as chat inserts
  // do (#434). It is only READ back on RETURNING.
  const [columnList] = calls[0].text.split('RETURNING');
  assert.doesNotMatch(columnList, /feed_seq/i, 'the app never allocates the sequence itself');
  assert.match(calls[0].text, /RETURNING[\s\S]*"feed_seq"/, 'the trigger-allocated seq rides back on RETURNING');

  assert.equal(entry.type, DRAFT_ACTIVITY);
  assert.equal(entry.kind, PICK);
  assert.equal(entry.seq, 14);
  assert.equal(entry[TEAM_ID], 11);
  assert.equal(entry[TEAM_NAME], 'Gridiron Ghosts');
  assert.deepEqual(entry.player, { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' });
  assert.equal(entry.round, 2);
  assert.equal(entry.pickNumber, 13);
  assert.equal(entry.isAutopick, false);
});

test('appendPickActivity records an autopick as isAutopick true', async () => {
  const client = { query: async () => ({ rows: [{ id: 10, feed_seq: '15', created_at: 'now' }] }) };
  const entry = await appendPickActivity(client, {
    leagueId: 1,
    team: { id: 12, name: 'Sunday Scaries' },
    player: { id: 501, name: 'Auto Guy', position: 'WR', nfl_team: 'BUF' },
    round: 1,
    pickNumber: 2,
    auto: true,
  });
  assert.equal(entry.isAutopick, true);
});
