const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DRAFT_ACTIVITY,
  PICK,
  DRAFT_START,
  PAUSE,
  RESUME,
  RESET,
  COMPLETE,
  CORRECTION,
  LIFECYCLE_KINDS,
  activityEntryOf,
  appendPickActivity,
  appendLifecycleActivity,
  appendCorrectionActivity,
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

/**
 * Lifecycle activity (#437): Draft start, pause, resume, reset and completion
 * are the rest of the authoritative Draft lifecycle, written from the same
 * transactions that change shared Draft state and presented on the same feed as
 * Picks and chat (ADR 0012). A lifecycle entry is NOT a Pick, so it carries no
 * player / round / pickNumber / autopick facts - inventing them would fabricate
 * Draft history the event never had (#437 AC5). It carries only the acting
 * Team's identity (null when the actor is the scheduler or a state transition
 * with no manager behind it, e.g. completion), never an account identifier.
 */

// A lifecycle draft_activity row as it comes back normalized: no player facts,
// round / pick_number NULL (the migration relaxes those columns for non-Pick
// kinds), the acting Team under the frozen identity keys.
const LIFECYCLE_ROW = {
  source: DRAFT_ACTIVITY,
  kind: DRAFT_START,
  id: 20,
  feed_seq: '3',
  [TEAM_ID]: 11,
  [TEAM_NAME]: 'Gridiron Ghosts',
  player_id: null,
  player_name: null,
  player_position: null,
  player_nfl_team: null,
  round: null,
  pick_number: null,
  is_autopick: false,
  created_at: '2026-09-01T00:00:00.000Z',
};

test('LIFECYCLE_KINDS names every non-Pick lifecycle kind and excludes pick', () => {
  assert.deepEqual([...LIFECYCLE_KINDS].sort(), [COMPLETE, DRAFT_START, PAUSE, RESET, RESUME].sort());
  assert.equal(LIFECYCLE_KINDS.includes(PICK), false, 'a Pick is not a lifecycle append');
});

test('activityEntryOf shapes a lifecycle entry with Team identity and no Pick facts', () => {
  const entry = activityEntryOf(LIFECYCLE_ROW);
  assert.equal(entry.type, DRAFT_ACTIVITY);
  assert.equal(entry.kind, DRAFT_START);
  assert.equal(entry.id, 20);
  assert.equal(entry.seq, 3);
  assert.strictEqual(typeof entry.seq, 'number');
  assert.equal(entry[TEAM_ID], 11);
  assert.equal(entry[TEAM_NAME], 'Gridiron Ghosts');
  assert.equal(entry.created_at, '2026-09-01T00:00:00.000Z');
  // A lifecycle event is not a Pick: it must not carry (nor fabricate) Pick facts.
  for (const pickField of ['player', 'round', 'pickNumber', 'isAutopick']) {
    assert.equal(pickField in entry, false, `${pickField} must not appear on a lifecycle entry`);
  }
});

test('activityEntryOf reads a null actor Team back as null, not an omitted key', () => {
  const entry = activityEntryOf({ ...LIFECYCLE_ROW, kind: COMPLETE, [TEAM_ID]: null, [TEAM_NAME]: null });
  assert.equal(entry[TEAM_ID], null);
  assert.equal(entry[TEAM_NAME], null);
  assert.ok(TEAM_ID in entry && TEAM_NAME in entry);
});

test('activityEntryOf never leaks an account identifier from a lifecycle row', () => {
  const entry = activityEntryOf({ ...LIFECYCLE_ROW, user_id: 42, owner_id: 42, username: 'u42' });
  for (const leak of ['user_id', 'userId', 'owner_id', 'username']) {
    assert.equal(leak in entry, false, `${leak} must not appear on a lifecycle entry`);
  }
});

test('appendLifecycleActivity inserts one lifecycle row on the caller transaction, no Pick columns', async () => {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [{ id: 20, feed_seq: '3', created_at: '2026-09-01T00:00:00.000Z' }] };
    },
  };

  const entry = await appendLifecycleActivity(client, {
    leagueId: 1,
    kind: DRAFT_START,
    team: { id: 11, name: 'Gridiron Ghosts' },
  });

  assert.equal(calls.length, 1, 'exactly one INSERT');
  assert.match(calls[0].text, /INSERT INTO "draft_activity"/);
  // The trigger allocates feed_seq: the app never names it in the column list.
  const [columnList] = calls[0].text.split('RETURNING');
  assert.doesNotMatch(columnList, /feed_seq/i, 'the app never allocates the sequence itself');
  assert.match(calls[0].text, /RETURNING[\s\S]*"feed_seq"/, 'the trigger-allocated seq rides back on RETURNING');
  // A lifecycle append writes no Pick columns - it has no player or Pick number.
  assert.doesNotMatch(columnList, /player_name|pick_number|"round"|is_autopick/i,
    'a lifecycle append writes no Pick facts');

  assert.equal(entry.type, DRAFT_ACTIVITY);
  assert.equal(entry.kind, DRAFT_START);
  assert.equal(entry.seq, 3);
  assert.equal(entry[TEAM_ID], 11);
  assert.equal(entry[TEAM_NAME], 'Gridiron Ghosts');
  assert.equal('player' in entry, false);
});

test('appendLifecycleActivity records a null actor (scheduler / state transition) without fabricating one', async () => {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [{ id: 21, feed_seq: '4', created_at: 'now' }] };
    },
  };

  const entry = await appendLifecycleActivity(client, { leagueId: 1, kind: COMPLETE, team: null });

  assert.equal(entry.kind, COMPLETE);
  assert.equal(entry[TEAM_ID], null);
  assert.equal(entry[TEAM_NAME], null);
  assert.ok(TEAM_ID in entry && TEAM_NAME in entry);
});

test('appendLifecycleActivity refuses a Pick kind - picks go through appendPickActivity', async () => {
  const client = { query: async () => { throw new Error('should not query'); } };
  await assert.rejects(
    () => appendLifecycleActivity(client, { leagueId: 1, kind: PICK, team: { id: 11, name: 'x' } }),
    /lifecycle/i
  );
});

test('appendLifecycleActivity refuses an unknown kind', async () => {
  const client = { query: async () => { throw new Error('should not query'); } };
  await assert.rejects(
    () => appendLifecycleActivity(client, { leagueId: 1, kind: 'nonsense', team: null }),
    /lifecycle/i
  );
});

/**
 * Commissioner correction activity (#439). A correction is neither a plain
 * Pick nor a bare lifecycle event: it appends its OWN entry that snapshots the
 * reversed Pick's facts (Team, player, round, Pick number) so the append-only
 * feed self-describes what was corrected without rewriting the original Pick
 * entry (CONTEXT.md: Draft activity is append-only through correction), and it
 * carries the commissioner's reason. It is excluded from LIFECYCLE_KINDS for the
 * same reason PICK is: it writes Pick-snapshot columns appendLifecycleActivity
 * would silently drop.
 */
const CORRECTION_ROW = {
  source: DRAFT_ACTIVITY,
  kind: CORRECTION,
  id: 30,
  feed_seq: '18',
  [TEAM_ID]: 11,
  [TEAM_NAME]: 'Gridiron Ghosts',
  player_id: 500,
  player_name: 'Wrong Guy',
  player_position: 'RB',
  player_nfl_team: 'KC',
  round: 2,
  pick_number: 13,
  is_autopick: false,
  reason: 'entered against the wrong team; correcting before we resume',
  created_at: '2026-09-01T00:00:00.000Z',
};

test('CORRECTION is not a lifecycle kind (it carries Pick-snapshot columns)', () => {
  assert.equal(LIFECYCLE_KINDS.includes(CORRECTION), false);
});

test('activityEntryOf shapes a correction entry with the reversed Pick snapshot and the reason', () => {
  const entry = activityEntryOf(CORRECTION_ROW);
  assert.equal(entry.type, DRAFT_ACTIVITY);
  assert.equal(entry.kind, CORRECTION);
  assert.equal(entry.seq, 18);
  assert.equal(entry[TEAM_ID], 11);
  assert.equal(entry[TEAM_NAME], 'Gridiron Ghosts');
  assert.deepEqual(entry.player, { id: 500, name: 'Wrong Guy', position: 'RB', nflTeam: 'KC' });
  assert.equal(entry.round, 2);
  assert.equal(entry.pickNumber, 13);
  assert.equal(entry.reason, 'entered against the wrong team; correcting before we resume');
  // A correction is not an autopick; the field is meaningless for it.
  assert.equal('isAutopick' in entry, false);
});

test('activityEntryOf never leaks an account identifier from a correction row', () => {
  const entry = activityEntryOf({ ...CORRECTION_ROW, user_id: 42, owner_id: 42, username: 'u42' });
  for (const leak of ['user_id', 'userId', 'owner_id', 'username']) {
    assert.equal(leak in entry, false, `${leak} must not appear on a correction entry`);
  }
});

test('appendCorrectionActivity inserts one correction row with the snapshot and reason and returns its entry', async () => {
  const calls = [];
  const client = {
    query: async (text, params) => {
      calls.push({ text, params });
      return { rows: [{ id: 30, feed_seq: '18', created_at: '2026-09-01T00:00:00.000Z' }] };
    },
  };

  const entry = await appendCorrectionActivity(client, {
    leagueId: 1,
    team: { id: 11, name: 'Gridiron Ghosts' },
    player: { id: 500, name: 'Wrong Guy', position: 'RB', nfl_team: 'KC' },
    round: 2,
    pickNumber: 13,
    reason: 'entered against the wrong team; correcting before we resume',
  });

  assert.equal(calls.length, 1, 'exactly one INSERT');
  assert.match(calls[0].text, /INSERT INTO "draft_activity"/);
  const [columnList] = calls[0].text.split('RETURNING');
  // The kind is 'correction', the reason is stored, and the trigger still owns
  // the feed sequence (never named in the column list).
  assert.match(columnList, /"reason"/, 'the correction stores the commissioner reason');
  assert.doesNotMatch(columnList, /feed_seq/i, 'the app never allocates the sequence itself');
  assert.match(calls[0].text, /RETURNING[\s\S]*"feed_seq"/);
  assert.equal(calls[0].params[1], CORRECTION);
  assert.ok(calls[0].params.includes('entered against the wrong team; correcting before we resume'));

  assert.equal(entry.kind, CORRECTION);
  assert.equal(entry.seq, 18);
  assert.equal(entry[TEAM_ID], 11);
  assert.deepEqual(entry.player, { id: 500, name: 'Wrong Guy', position: 'RB', nflTeam: 'KC' });
  assert.equal(entry.pickNumber, 13);
  assert.equal(entry.reason, 'entered against the wrong team; correcting before we resume');
});
