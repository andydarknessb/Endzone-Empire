const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  LEAGUE_PHASE,
  JOIN_REFUSAL_REASON,
  JOIN_REFUSAL_MESSAGES,
  REMOVE_REFUSAL_REASON,
  REMOVE_REFUSAL_MESSAGES,
  deriveLeaguePhase,
  joinability,
  removability,
  removeRefusalMessage,
  joinableWhereSql,
  fantasySeasonLiveWhereSql,
  frozenSettingKeys,
  settingsUnfrozenWhereSql,
  seasonOperationsAvailable,
  SEASON_BEFORE_DRAFT_MESSAGE,
  DRAFT_FROZEN_SETTING_KEYS,
} = require('../services/leaguePhase');

/**
 * The phase / joinability contract fixture lives beside the CLIENT phase
 * module and is loaded by both suites, so the two derivations cannot drift:
 * a case added on one side is run on the other on the next test run.
 */
const fixture = require('../../src/lib/leaguePhase.fixture.json');

/* ------------------------------------------------------------------ *
 * Shared fixture: phase + joinability                                 *
 * ------------------------------------------------------------------ */

test('the shared fixture carries every case shape the ticket names', () => {
  const names = fixture.cases.map((c) => c.name).join('\n');
  assert.ok(fixture.cases.length >= 12, `expected a real table, got ${fixture.cases.length} cases`);
  assert.match(names, /rolled into a new season/);
  assert.match(names, /null input/);
  assert.match(names, /missing input/);
});

for (const c of fixture.cases) {
  test(`fixture: ${c.name} -> phase ${c.phase}, joinable ${c.joinable}${c.reason ? ` (${c.reason})` : ''}`, () => {
    assert.equal(deriveLeaguePhase(c.league), c.phase);
    const answer = joinability(c.league);
    assert.equal(answer.joinable, c.joinable);
    if (c.joinable) {
      assert.deepEqual(answer, { joinable: true }, 'a joinable answer carries no reason');
    } else {
      assert.equal(answer.reason, c.reason);
    }
  });

  test(`fixture: ${c.name} -> removable ${c.removable}${c.removeReason ? ` (${c.removeReason})` : ''}`, () => {
    const answer = removability(c.league);
    assert.equal(answer.removable, c.removable);
    if (c.removable) {
      assert.deepEqual(answer, { removable: true }, 'a removable answer carries no reason');
    } else {
      assert.equal(answer.reason, c.removeReason);
    }
  });
}

test('phase values and reason strings are the cross-side contract', () => {
  assert.deepEqual(LEAGUE_PHASE, {
    PRE_DRAFT: 'pre-draft',
    DRAFTING: 'drafting',
    IN_SEASON: 'in-season',
    PLAYOFFS: 'playoffs',
    COMPLETE: 'complete',
  });
  assert.deepEqual(JOIN_REFUSAL_REASON, {
    DRAFT_STARTED: 'draft-started',
    SEASON_COMPLETE: 'season-complete',
  });
  assert.ok(Object.isFrozen(LEAGUE_PHASE));
  assert.ok(Object.isFrozen(JOIN_REFUSAL_REASON));
  // Every reason the fixture uses is one the module names, and each has a
  // manager-readable message.
  const fixtureReasons = new Set(fixture.cases.map((c) => c.reason).filter(Boolean));
  for (const reason of fixtureReasons) {
    assert.ok(Object.values(JOIN_REFUSAL_REASON).includes(reason), `unknown fixture reason ${reason}`);
    assert.equal(typeof JOIN_REFUSAL_MESSAGES[reason], 'string');
  }
  assert.match(JOIN_REFUSAL_MESSAGES['draft-started'], /draft/i);
  assert.match(JOIN_REFUSAL_MESSAGES['season-complete'], /season/i);
});

test('the removal reason strings are the cross-side contract, each with a message', () => {
  assert.deepEqual(REMOVE_REFUSAL_REASON, { DRAFT_STARTED: 'draft-started' });
  assert.ok(Object.isFrozen(REMOVE_REFUSAL_REASON));
  const fixtureReasons = new Set(fixture.cases.map((c) => c.removeReason).filter(Boolean));
  for (const reason of fixtureReasons) {
    assert.ok(Object.values(REMOVE_REFUSAL_REASON).includes(reason), `unknown fixture removeReason ${reason}`);
    assert.equal(typeof REMOVE_REFUSAL_MESSAGES[reason], 'string');
  }
  // Says why in plain words, with no em-dash (house style).
  assert.match(REMOVE_REFUSAL_MESSAGES['draft-started'], /draft/i);
  assert.doesNotMatch(REMOVE_REFUSAL_MESSAGES['draft-started'], /—/);
  assert.equal(removeRefusalMessage('draft-started'), REMOVE_REFUSAL_MESSAGES['draft-started']);
});

/* ------------------------------------------------------------------ *
 * SQL fragments (asserted as text, never executed)                    *
 * ------------------------------------------------------------------ */

test('joinableWhereSql: a fantasy league is joinable while pre-draft, a pick\'em-only league until its season completes', () => {
  const sql = joinableWhereSql('leagues');
  assert.equal(
    sql,
    `(("leagues"."pickem_only" = false AND "leagues"."draft_status" = 'pending')` +
    ` OR ("leagues"."pickem_only" = true AND "leagues"."season_status" <> 'complete'))`
  );
});

test('joinableWhereSql: takes the table alias, and emits bare columns without one', () => {
  assert.match(joinableWhereSql('l'), /^\(\("l"\."pickem_only" = false AND "l"\."draft_status" = 'pending'\)/);
  assert.match(joinableWhereSql(), /^\(\("pickem_only" = false AND "draft_status" = 'pending'\)/);
  assert.doesNotMatch(joinableWhereSql(), /""/);
});

test('fantasySeasonLiveWhereSql: fantasy league whose draft is complete and season is not', () => {
  assert.equal(
    fantasySeasonLiveWhereSql('leagues'),
    `("leagues"."pickem_only" = false AND "leagues"."draft_status" = 'complete' AND "leagues"."season_status" <> 'complete')`
  );
  assert.equal(
    fantasySeasonLiveWhereSql(),
    `("pickem_only" = false AND "draft_status" = 'complete' AND "season_status" <> 'complete')`
  );
});

test('the SQL fragments are code literals: an alias with a quote or dot is refused', () => {
  assert.throws(() => joinableWhereSql('x"; DROP TABLE'), /alias/);
  assert.throws(() => fantasySeasonLiveWhereSql('a.b'), /alias/);
  assert.throws(() => settingsUnfrozenWhereSql('a b'), /alias/);
});

test('settingsUnfrozenWhereSql: no key is draft-frozen for a pick\'em-only league or a fantasy league still pre-draft', () => {
  assert.equal(
    settingsUnfrozenWhereSql('leagues'),
    `("leagues"."pickem_only" = true OR "leagues"."draft_status" = 'pending')`
  );
  assert.equal(settingsUnfrozenWhereSql(), `("pickem_only" = true OR "draft_status" = 'pending')`);
});

test('settingsUnfrozenWhereSql agrees with frozenSettingKeys on every fixture row', () => {
  // Evaluate the fragment the way Postgres would over each fixture row and
  // compare with the pure rule, so the SQL twin cannot drift from it.
  const rows = fixture.cases.map((c) => c.league).filter(Boolean);
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const unfrozenBySql = row.pickem_only === true || row.draft_status === 'pending';
    assert.equal(unfrozenBySql, frozenSettingKeys(row).length === 0, JSON.stringify(row));
  }
});

/* ------------------------------------------------------------------ *
 * frozenSettingKeys                                                   *
 * ------------------------------------------------------------------ */

const EXPECTED_FROZEN = [
  'rosterSlots', 'positionCaps', 'benchSlots', 'dpEnabled', 'irSlots',
  'scoringRules', 'regularSeasonWeeks', 'playoffTeams',
  'playoffConsolation', 'pickTimeSeconds', 'minTeams', 'maxTeams', 'autodraftDelaySeconds',
  'draftDate', 'draftTimezone', 'draftType', 'draftRotation', 'keepersEnabled', 'keeperCount',
  'draftOrderOverrides', 'auctionSettings', 'keeperLockAt',
];

test('DRAFT_FROZEN_SETTING_KEYS is the existing 22-key list', () => {
  assert.equal(DRAFT_FROZEN_SETTING_KEYS.length, 22);
  assert.deepEqual([...DRAFT_FROZEN_SETTING_KEYS].sort(), [...EXPECTED_FROZEN].sort());
  assert.ok(Object.isFrozen(DRAFT_FROZEN_SETTING_KEYS));
});

test('frozenSettingKeys: the full list once a fantasy league is past pre-draft', () => {
  for (const league of [
    { draft_status: 'active' },
    { draft_status: 'complete', season_status: 'regular' },
    { draft_status: 'complete', season_status: 'playoffs' },
    { draft_status: 'complete', season_status: 'complete' },
    { pickem_only: false, draft_status: 'active' },
  ]) {
    assert.deepEqual([...frozenSettingKeys(league)].sort(), [...EXPECTED_FROZEN].sort(), JSON.stringify(league));
  }
});

test('frozenSettingKeys: empty pre-draft, and empty for a pick\'em-only league whatever its columns say', () => {
  assert.deepEqual(frozenSettingKeys({ draft_status: 'pending' }), []);
  assert.deepEqual(frozenSettingKeys({ pickem_only: false, draft_status: 'pending', season_status: 'regular' }), []);
  assert.deepEqual(frozenSettingKeys({ pickem_only: true, draft_status: 'pending', season_status: 'regular' }), []);
  assert.deepEqual(frozenSettingKeys({ pickem_only: true, draft_status: 'active', season_status: 'playoffs' }), []);
  assert.deepEqual(frozenSettingKeys({ pickem_only: true, draft_status: 'complete', season_status: 'complete' }), []);
});

test('frozenSettingKeys: fails closed for a missing league (everything frozen)', () => {
  // No row means the caller could not verify pre-draft; freezing everything
  // matches the router's existing "reject when the status read is missing".
  assert.deepEqual([...frozenSettingKeys(null)].sort(), [...EXPECTED_FROZEN].sort());
  assert.deepEqual([...frozenSettingKeys(undefined)].sort(), [...EXPECTED_FROZEN].sort());
});

/* ------------------------------------------------------------------ *
 * Season operations availability (#194)                               *
 * ------------------------------------------------------------------ */

test('seasonOperationsAvailable: refused while a fantasy league is pre-draft or drafting', () => {
  assert.equal(seasonOperationsAvailable({ pickem_only: false, draft_status: 'pending', season_status: 'regular' }), false);
  assert.equal(seasonOperationsAvailable({ pickem_only: false, draft_status: 'active', season_status: 'regular' }), false);
});

test('seasonOperationsAvailable: allowed once the draft is complete, in every later phase', () => {
  for (const season_status of ['regular', 'playoffs', 'complete']) {
    assert.equal(
      seasonOperationsAvailable({ pickem_only: false, draft_status: 'complete', season_status }),
      true,
      season_status
    );
  }
});

test("seasonOperationsAvailable: a pick'em-only league has no draft to wait for", () => {
  // It is in-season from creation whatever draft_status says, so the gate
  // must never be what stops it. (In the routers the pick'em refusal fires
  // upstream of this anyway, in requireFantasyLeague.)
  for (const draft_status of ['pending', 'active', 'complete']) {
    assert.equal(
      seasonOperationsAvailable({ pickem_only: true, draft_status, season_status: 'regular' }),
      true,
      draft_status
    );
  }
  assert.equal(seasonOperationsAvailable({ pickem_only: true, draft_status: 'pending', season_status: 'complete' }), true);
});

test('seasonOperationsAvailable: fails closed for a missing league row', () => {
  assert.equal(seasonOperationsAvailable(null), false);
  assert.equal(seasonOperationsAvailable(undefined), false);
});

test('seasonOperationsAvailable: it is deriveLeaguePhase that decides, for every fixture case', () => {
  // One source for the rule: the helper must agree with the shared fixture's
  // phase on every case, so it cannot drift from the derivation it wraps.
  for (const c of fixture.cases) {
    const expected = c.phase !== null && c.phase !== 'pre-draft' && c.phase !== 'drafting';
    assert.equal(seasonOperationsAvailable(c.league), expected, c.name);
  }
});

test('SEASON_BEFORE_DRAFT_MESSAGE: says why in plain words, with no em-dash', () => {
  assert.match(SEASON_BEFORE_DRAFT_MESSAGE, /draft/i);
  assert.match(SEASON_BEFORE_DRAFT_MESSAGE, /once it completes/i);
  assert.doesNotMatch(SEASON_BEFORE_DRAFT_MESSAGE, /—/);
});
