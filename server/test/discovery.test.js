const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VALID_SCORING_PRESETS,
  validateCreateOptions,
  buildDiscoverQuery,
} = require('../services/discovery.service');

// ---------------------------------------------------------------------------
// validateCreateOptions
// ---------------------------------------------------------------------------

test('validateCreateOptions: defaults everything when nothing is given', () => {
  const { value, error } = validateCreateOptions();
  assert.equal(error, undefined);
  assert.deepEqual(value, {
    isPublic: false,
    joinApproval: false,
    bestBall: false,
    scoringPreset: null,
    scoringRules: null,
    draftDate: null,
    pickemOnly: false,
    pickemEnabled: false,
    pickemMode: 'straight',
  });
});

test('validateCreateOptions: accepts booleans for isPublic/joinApproval/bestBall', () => {
  const { value, error } = validateCreateOptions({ isPublic: true, joinApproval: true, bestBall: true });
  assert.equal(error, undefined);
  assert.equal(value.isPublic, true);
  assert.equal(value.joinApproval, true);
  assert.equal(value.bestBall, true);
});

test('validateCreateOptions: rejects non-boolean isPublic/joinApproval/bestBall', () => {
  assert.match(validateCreateOptions({ isPublic: 'yes' }).error, /isPublic must be a boolean/);
  assert.match(validateCreateOptions({ joinApproval: 1 }).error, /joinApproval must be a boolean/);
  assert.match(validateCreateOptions({ bestBall: 'true' }).error, /bestBall must be a boolean/);
});

for (const preset of ['standard', 'half_ppr', 'ppr']) {
  test(`validateCreateOptions: accepts scoringPreset '${preset}' and sets scoringRules`, () => {
    const { value, error } = validateCreateOptions({ scoringPreset: preset });
    assert.equal(error, undefined);
    assert.equal(value.scoringPreset, preset);
    assert.ok(value.scoringRules && typeof value.scoringRules === 'object');
  });
}

test('validateCreateOptions: rejects an unknown scoringPreset', () => {
  const { error } = validateCreateOptions({ scoringPreset: 'custom' });
  assert.match(error, /scoringPreset must be one of/);
  for (const preset of VALID_SCORING_PRESETS) assert.match(error, new RegExp(preset));
});

test('validateCreateOptions: missing draftDate is fine (stays null)', () => {
  const { value, error } = validateCreateOptions({});
  assert.equal(error, undefined);
  assert.equal(value.draftDate, null);
});

test('validateCreateOptions: accepts a future draftDate', () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { value, error } = validateCreateOptions({ draftDate: future });
  assert.equal(error, undefined);
  assert.ok(value.draftDate instanceof Date);
  assert.equal(value.draftDate.toISOString(), future);
});

test('validateCreateOptions: rejects a past draftDate', () => {
  const past = new Date(Date.now() - 60 * 1000).toISOString();
  const { error } = validateCreateOptions({ draftDate: past });
  assert.match(error, /draftDate must be in the future/);
});

test('validateCreateOptions: rejects an unparseable draftDate', () => {
  const { error } = validateCreateOptions({ draftDate: 'not-a-date' });
  assert.match(error, /draftDate must be a valid ISO date string/);
});

// leagueType matrix: absent and 'fantasy' derive no pick'em, 'both' keeps the
// fantasy side with pick'em on, 'pickem' is pick'em-only (and pick'em on).
for (const [given, pickemOnly, pickemEnabled] of [
  [undefined, false, false],
  ['fantasy', false, false],
  ['both', false, true],
  ['pickem', true, true],
]) {
  test(`validateCreateOptions: leagueType ${given === undefined ? 'absent' : `'${given}'`} derives pickemOnly=${pickemOnly}, pickemEnabled=${pickemEnabled}`, () => {
    const { value, error } = validateCreateOptions(given === undefined ? {} : { leagueType: given });
    assert.equal(error, undefined);
    assert.equal(value.pickemOnly, pickemOnly);
    assert.equal(value.pickemEnabled, pickemEnabled);
  });
}

test('validateCreateOptions: rejects an unknown leagueType', () => {
  const { error } = validateCreateOptions({ leagueType: 'dynasty' });
  assert.match(error, /leagueType must be one of fantasy, pickem, both/);
});

test('validateCreateOptions: rejects fantasy-only fields for a pick\'em league, naming the field', () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.match(validateCreateOptions({ leagueType: 'pickem', bestBall: true }).error, /bestBall/);
  assert.match(validateCreateOptions({ leagueType: 'pickem', bestBall: false }).error, /bestBall/);
  assert.match(validateCreateOptions({ leagueType: 'pickem', scoringPreset: 'ppr' }).error, /scoringPreset/);
  assert.match(validateCreateOptions({ leagueType: 'pickem', draftDate: future }).error, /draftDate/);
});

test('validateCreateOptions: null scoringPreset/draftDate stay acceptable for a pick\'em league', () => {
  const { value, error } = validateCreateOptions({
    leagueType: 'pickem', scoringPreset: null, draftDate: null,
  });
  assert.equal(error, undefined);
  assert.equal(value.pickemOnly, true);
});

test('validateCreateOptions: fantasy-only fields stay valid alongside leagueType \'both\'', () => {
  const { value, error } = validateCreateOptions({ leagueType: 'both', bestBall: true, scoringPreset: 'ppr' });
  assert.equal(error, undefined);
  assert.equal(value.bestBall, true);
  assert.equal(value.scoringPreset, 'ppr');
  assert.equal(value.pickemEnabled, true);
});

test('validateCreateOptions: pickemMode is validated against the pick\'em modes', () => {
  assert.equal(validateCreateOptions({ leagueType: 'pickem', pickemMode: 'confidence' }).value.pickemMode, 'confidence');
  assert.equal(validateCreateOptions({ leagueType: 'both', pickemMode: 'straight' }).value.pickemMode, 'straight');
  assert.equal(validateCreateOptions({ leagueType: 'pickem' }).value.pickemMode, 'straight'); // default
  assert.match(validateCreateOptions({ leagueType: 'pickem', pickemMode: 'chaos' }).error, /pickemMode must be one of/);
  assert.match(validateCreateOptions({ pickemMode: 5 }).error, /pickemMode must be one of/);
});

test('validateCreateOptions: pickemMode is rejected, not dropped, when the type has no pick\'em side', () => {
  assert.match(validateCreateOptions({ leagueType: 'fantasy', pickemMode: 'confidence' }).error, /pickemMode/);
  assert.match(validateCreateOptions({ pickemMode: 'confidence' }).error, /pickemMode/); // absent type defaults to fantasy
  assert.equal(validateCreateOptions({ leagueType: 'fantasy', pickemMode: null }).error, undefined); // null = absent
});

// ---------------------------------------------------------------------------
// buildDiscoverQuery
// ---------------------------------------------------------------------------

test('buildDiscoverQuery: base case has no search/scoring/openSlots filters', () => {
  const { whereClause, havingClause, orderByClause, params } = buildDiscoverQuery({ userId: 42 });
  assert.equal(whereClause, `"leagues"."is_public" = true AND "leagues"."draft_status" = 'pending'`);
  assert.equal(havingClause, null);
  assert.equal(orderByClause, `"leagues"."created_at" DESC`);
  assert.deepEqual(params, [42]);
});

test('buildDiscoverQuery: search adds an ILIKE fragment with the value only in params', () => {
  const { whereClause, params } = buildDiscoverQuery({ userId: 1, search: "O'Brien" });
  assert.match(whereClause, /"leagues"\."name" ILIKE \$2$/);
  assert.equal(whereClause.includes("O'Brien"), false); // never interpolated into the SQL text
  assert.deepEqual(params, [1, "%O'Brien%"]);
});

test('buildDiscoverQuery: scoring adds an equality fragment with the value only in params', () => {
  const { whereClause, params } = buildDiscoverQuery({ userId: 1, scoring: 'ppr' });
  assert.match(whereClause, /"leagues"\."scoring_preset" = \$2$/);
  assert.equal(whereClause.includes('ppr'), false);
  assert.deepEqual(params, [1, 'ppr']);
});

test('buildDiscoverQuery: search + scoring both append params in order, with correct placeholders', () => {
  const { whereClause, params } = buildDiscoverQuery({ userId: 7, search: 'Empire', scoring: 'half_ppr' });
  assert.match(whereClause, /ILIKE \$2/);
  assert.match(whereClause, /scoring_preset" = \$3/);
  assert.deepEqual(params, [7, '%Empire%', 'half_ppr']);
});

test('buildDiscoverQuery: openSlots=true adds a HAVING clause comparing team count to max_teams', () => {
  const { havingClause } = buildDiscoverQuery({ userId: 1, openSlots: true });
  assert.equal(havingClause, `COUNT(DISTINCT "teams"."id") < "leagues"."max_teams"`);
});

test('buildDiscoverQuery: openSlots falsy leaves havingClause null', () => {
  assert.equal(buildDiscoverQuery({ userId: 1, openSlots: false }).havingClause, null);
  assert.equal(buildDiscoverQuery({ userId: 1 }).havingClause, null);
});

test('buildDiscoverQuery: sort=newest (default) orders by created_at desc', () => {
  assert.equal(buildDiscoverQuery({ userId: 1, sort: 'newest' }).orderByClause, `"leagues"."created_at" DESC`);
  assert.equal(buildDiscoverQuery({ userId: 1 }).orderByClause, `"leagues"."created_at" DESC`);
});

test('buildDiscoverQuery: sort=draft_date orders by draft_date ascending, nulls last', () => {
  assert.equal(buildDiscoverQuery({ userId: 1, sort: 'draft_date' }).orderByClause, `"leagues"."draft_date" ASC NULLS LAST`);
});

test('buildDiscoverQuery: sort=open_slots orders by remaining slots descending', () => {
  assert.equal(
    buildDiscoverQuery({ userId: 1, sort: 'open_slots' }).orderByClause,
    `("leagues"."max_teams" - COUNT(DISTINCT "teams"."id")) DESC`
  );
});

test('buildDiscoverQuery: unrecognized sort falls back to newest', () => {
  assert.equal(buildDiscoverQuery({ userId: 1, sort: 'bogus' }).orderByClause, `"leagues"."created_at" DESC`);
});

test('buildDiscoverQuery: userId is always the first param (used for alreadyMember/myRequestStatus joins)', () => {
  const { params } = buildDiscoverQuery({ userId: 99, search: 'x', scoring: 'ppr', openSlots: true, sort: 'open_slots' });
  assert.equal(params[0], 99);
});

// ---------------------------------------------------------------------------
// discoverLeagues
// ---------------------------------------------------------------------------

test("discoverLeagues: projects the league type so Discover can label a pick'em-only league", async (t) => {
  const pool = require('../modules/pool');
  const { discoverLeagues } = require('../services/discovery.service');
  let sql;
  t.mock.method(pool, 'query', async (text) => {
    sql = text;
    return { rows: [{ id: 5, name: 'Office Pool', maxTeams: 50, teamCount: 3, pickemOnly: true }] };
  });

  const rows = await discoverLeagues({ userId: 1 });

  assert.match(sql, /"leagues"\."pickem_only" AS "pickemOnly"/);
  assert.equal(rows[0].pickemOnly, true);
  assert.equal(rows[0].openSlots, true);
});
