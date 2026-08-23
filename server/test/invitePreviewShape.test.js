const { test } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { previewLeagueByInviteCode } = require('../services/discovery.service');

/**
 * The invite preview's payload contract (#181).
 *
 * `previewLeagueByInviteCode()` answers a manager who pasted an invite code
 * and is BY DEFINITION not a member of the league. It used to be built by
 * spreading the shared Discover-card row and deleting the three joinability
 * inputs afterwards, so publication was the DEFAULT: every column added to
 * `selectLeagueCards()` for the Discover card reached a non-member's invite
 * preview the day it landed, and nothing failed. That is the same shape #199
 * removed from the public presenter board.
 *
 * These tests pin the EXACT key set. The fake answers a row wider than the
 * contract (account identity, the invite code itself, and a stand-in for a
 * column added next quarter) so the assertions bite on the service's
 * allowlist rather than on the fixture's shape.
 */

/** A row wider than the preview contract, as a future `selectLeagueCards` might return. */
function wideRow(overrides = {}) {
  return {
    id: 7,
    name: "Office Pick'em",
    maxTeams: 12,
    teamCount: 3,
    scoringPreset: null,
    bestBall: false,
    pickemOnly: true,
    pickemEnabled: true,
    joinApproval: false,
    draftDate: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    alreadyMember: false,
    myRequestStatus: null,
    openSlots: true,
    isPublic: false,
    ownerUsername: 'alice',
    ownerTeamName: "Alice's Aces",
    draft_status: 'pending',
    season_status: 'regular',
    pickem_only: true,
    // Not part of the contract, and none of them may reach a non-member.
    owner_id: 42,
    invite_code: 'e402e816',
    ownerEmail: 'alice@example.com',
    commissionerUsername: 'alice',
    a_column_added_next_quarter: 'surprise',
    ...overrides,
  };
}

function fakeDb(t, row) {
  t.mock.method(pool, 'query', async () => ({ rows: row ? [row] : [] }));
}

/**
 * The published key set, in full. A field appears here only because
 * discovery.service.js names it in PREVIEW_FIELDS: changing this list is a
 * deliberate act of publication to a non-member.
 */
const PREVIEW_KEYS = [
  'id',
  'name',
  'maxTeams',
  'teamCount',
  'scoringPreset',
  'bestBall',
  'pickemOnly',
  'pickemEnabled',
  'joinApproval',
  'draftDate',
  'createdAt',
  'alreadyMember',
  'myRequestStatus',
  'openSlots',
  'isPublic',
  // Still shipped, still unread by any client: #115 removes it. The client
  // switched to ownerTeamName in #181 and has no fallback to this.
  'ownerUsername',
  'ownerTeamName',
  'joinable',
  'joinReason',
];

test('the invite preview publishes exactly the allowlisted key set, however wide the row is', async (t) => {
  fakeDb(t, wideRow());
  const preview = await previewLeagueByInviteCode({ code: 'e402e816', userId: 9 });
  assert.deepEqual(Object.keys(preview).sort(), [...PREVIEW_KEYS].sort());
});

test('a column added to the Discover card projection is not published by the invite preview', async (t) => {
  fakeDb(t, wideRow());
  const preview = await previewLeagueByInviteCode({ code: 'e402e816', userId: 9 });
  for (const field of ['owner_id', 'invite_code', 'ownerEmail', 'commissionerUsername', 'a_column_added_next_quarter']) {
    assert.equal(field in preview, false, `${field} is not published to a non-member`);
  }
  // By value too, so a rename cannot smuggle one through.
  const published = JSON.stringify(preview);
  for (const value of ['alice@example\\.com', 'e402e816', 'surprise']) {
    assert.doesNotMatch(published, new RegExp(value), `${value} is not published to a non-member`);
  }
});

test('a league creator with no Team row previews ownerTeamName: null, never a fallback', async (t) => {
  // What the database actually answers when the subselect matches no row.
  fakeDb(t, wideRow({ ownerTeamName: null }));
  const preview = await previewLeagueByInviteCode({ code: 'e402e816', userId: 9 });
  assert.equal(preview.ownerTeamName, null);
  assert.deepEqual(Object.keys(preview).sort(), [...PREVIEW_KEYS].sort());
});

test('an allowlisted field the row does not carry AT ALL answers null rather than dropping out', async (t) => {
  // The other half of that contract, and the one worth pinning: the key set is
  // a property of PREVIEW_FIELDS, not of whatever the row happened to hold, so
  // a client can read every field unconditionally. `null` in the fixture above
  // cannot test this -- the key is present there, so the null-fill branch never
  // runs and the assertion passes against an implementation that has no such
  // branch at all (verified by mutation). Absent keys are what bite.
  const row = wideRow();
  delete row.ownerTeamName;
  delete row.myRequestStatus;
  delete row.scoringPreset;
  fakeDb(t, row);
  const preview = await previewLeagueByInviteCode({ code: 'e402e816', userId: 9 });
  assert.deepEqual(Object.keys(preview).sort(), [...PREVIEW_KEYS].sort());
  assert.equal(preview.ownerTeamName, null);
  assert.equal(preview.myRequestStatus, null);
  assert.equal(preview.scoringPreset, null);
});

test("the preview carries the commissioner's Team name", async (t) => {
  fakeDb(t, wideRow());
  const preview = await previewLeagueByInviteCode({ code: 'e402e816', userId: 9 });
  assert.equal(preview.ownerTeamName, "Alice's Aces");
});

test('an unknown invite code is still null, not an object of nulls', async (t) => {
  fakeDb(t, null);
  assert.equal(await previewLeagueByInviteCode({ code: 'nope', userId: 9 }), null);
});

test("the lookup selects the owner's Team name, scoped to this league and this owner", async (t) => {
  let sql = '';
  t.mock.method(pool, 'query', async (text) => {
    sql = String(text).replace(/\s+/g, ' ');
    return { rows: [wideRow()] };
  });
  await previewLeagueByInviteCode({ code: 'e402e816', userId: 9 });
  const alias = sql.indexOf('AS "ownerTeamName"');
  assert.notEqual(alias, -1, 'the lookup selects the Team name');
  // The subselect behind that alias: back to the last "(SELECT" before it.
  const opened = sql.lastIndexOf('(SELECT', alias);
  assert.notEqual(opened, -1, 'the Team name is read by its own subselect');
  const ownerTeamSelect = sql.slice(opened, alias);
  assert.match(ownerTeamSelect, /"teams"/, 'read from the teams table');
  assert.match(ownerTeamSelect, /"league_id" = "leagues"\."id"/, 'scoped to this league');
  assert.match(ownerTeamSelect, /"owner_id" = "leagues"\."owner_id"/, "scoped to the league's owner");
});
