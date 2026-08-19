const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  SETTINGS,
  FANTASY_ONLY_NOT_FROZEN_KEYS,
  FANTASY_ONLY_SETTING_KEYS,
  DP_GROUP_KEYS,
  parseSettingsPatch,
} = require('../services/leagueSettings.service');
const { DRAFT_FROZEN_SETTING_KEYS } = require('../services/leaguePhase');
const { POSITION_KEYS } = require('../services/draftValidation.service');
const { POSITION_GROUPS } = require('../services/lineup.service');
const { SCORING_PRESETS } = require('../services/scoring.service');

/**
 * parseSettingsPatch is the pure half of PUT /api/league/:id (spec #71, PR 1).
 * No pool, no supertest: a body goes in, `{ error }` (the exact 400 message
 * the route has always sent) or `{ value }` (the normalized patch plus the
 * derived request facts) comes out. The route suites still drive the same
 * bodies end to end; this file pins every message and derivation directly.
 */

const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const QB = { key: 'QB', count: 1, eligiblePositions: ['QB'] };

/* ------------------------------------------------------------------ *
 * Registry shape                                                      *
 * ------------------------------------------------------------------ */

// The handler's validation order on main (the first failing key's message is
// the 400), followed by the three keys it never shape-checked. The registry
// walks this order, so it is the contract multi-invalid bodies depend on.
const VALIDATION_ORDER = [
  'draftDate', 'rosterSlots', 'positionCaps', 'benchSlots', 'dpEnabled', 'irSlots',
  'waiverType', 'waiverPeriodHours', 'faabBudget', 'tradeDeadlineWeek', 'tradeReviewHours', 'tradeVetoVotes',
  'scoringPreset', 'scoringRules', 'regularSeasonWeeks', 'playoffTeams', 'playoffConsolation',
  'pickTimeSeconds', 'autodraftDelaySeconds', 'draftType', 'draftRotation', 'draftOrderOverrides',
  'keepersEnabled', 'keeperCount', 'auctionSettings', 'keeperLockAt',
  'name', 'minTeams', 'maxTeams',
];

// Wire key -> leagues column, as the UPDATE in league.router.js writes them.
const COLUMNS = {
  draftDate: 'draft_date', rosterSlots: 'roster_slots', positionCaps: 'position_caps', benchSlots: 'bench_slots',
  dpEnabled: 'dp_enabled', irSlots: 'ir_slots', waiverType: 'waiver_type', waiverPeriodHours: 'waiver_period_hours',
  faabBudget: 'faab_budget', tradeDeadlineWeek: 'trade_deadline_week', tradeReviewHours: 'trade_review_hours',
  tradeVetoVotes: 'trade_veto_votes', scoringPreset: 'scoring_preset', scoringRules: 'scoring_rules',
  regularSeasonWeeks: 'regular_season_weeks', playoffTeams: 'playoff_teams', playoffConsolation: 'playoff_consolation',
  pickTimeSeconds: 'pick_time_seconds', autodraftDelaySeconds: 'autodraft_delay_seconds', draftType: 'draft_type',
  draftRotation: 'draft_rotation', draftOrderOverrides: 'draft_order_overrides', keepersEnabled: 'keepers_enabled',
  keeperCount: 'keeper_count', auctionSettings: 'auction_settings', keeperLockAt: 'keeper_lock_at',
  name: 'name', minTeams: 'min_teams', maxTeams: 'max_teams',
};

test('the registry holds the 29 settable wire keys in the handler\'s validation order, each naming its column', () => {
  assert.deepEqual(SETTINGS.map((row) => row.key), VALIDATION_ORDER);
  assert.equal(new Set(VALIDATION_ORDER).size, 29);
  assert.deepEqual(Object.fromEntries(SETTINGS.map((row) => [row.key, row.column])), COLUMNS);
  for (const row of SETTINGS) assert.ok(Object.isFrozen(row), `${row.key} row is frozen`);
  // Every validated row is exercised by the rejection table below.
  const validated = SETTINGS.filter((row) => row.validate).map((row) => row.key);
  const exercised = new Set(REJECTIONS.flatMap(([body]) => Object.keys(body)));
  for (const key of validated) assert.ok(exercised.has(key), `${key} has a rejection case`);
});

test('draftFrozen is membership in leaguePhase.DRAFT_FROZEN_SETTING_KEYS (the module refuses to load on a mismatch)', () => {
  // The registry derives draftFrozen from the phase contract, so one
  // direction holds by construction; the other (a frozen key with no row)
  // is a load-time invariant in the module. Pin the resulting set against the
  // literal the phase module ships, so a change on either side is visible here.
  const frozenRows = SETTINGS.filter((row) => row.draftFrozen).map((row) => row.key).sort();
  assert.deepEqual(frozenRows, [
    'auctionSettings', 'autodraftDelaySeconds', 'benchSlots', 'dpEnabled', 'draftDate', 'draftOrderOverrides',
    'draftRotation', 'draftType', 'irSlots', 'keeperCount', 'keeperLockAt', 'keepersEnabled', 'maxTeams', 'minTeams',
    'pickTimeSeconds', 'playoffConsolation', 'playoffTeams', 'positionCaps', 'regularSeasonWeeks', 'rosterSlots',
    'scoringRules',
  ]);
  assert.deepEqual(frozenRows, [...DRAFT_FROZEN_SETTING_KEYS].sort());
});

test('only name and the size limits are not fantasy-only; the size limits are draft-frozen', () => {
  const notFantasy = SETTINGS.filter((row) => !row.fantasyOnly).map((row) => row.key).sort();
  assert.deepEqual(notFantasy, ['maxTeams', 'minTeams', 'name']);
  const sizes = SETTINGS.filter((row) => row.size).map((row) => row.key).sort();
  assert.deepEqual(sizes, ['maxTeams', 'minTeams']);
  for (const key of sizes) {
    assert.equal(SETTINGS.find((row) => row.key === key).draftFrozen, true, `${key} is draft-frozen`);
  }
  assert.equal(SETTINGS.find((row) => row.key === 'name').draftFrozen, false);
});

test('FANTASY_ONLY_SETTING_KEYS is the current 26-key refusal list, in refusal order', () => {
  assert.deepEqual([...FANTASY_ONLY_SETTING_KEYS], [
    'rosterSlots', 'positionCaps', 'benchSlots', 'dpEnabled', 'irSlots',
    'scoringRules', 'regularSeasonWeeks', 'playoffTeams',
    'playoffConsolation', 'pickTimeSeconds', 'autodraftDelaySeconds',
    'draftDate', 'draftType', 'draftRotation', 'keepersEnabled', 'keeperCount',
    'draftOrderOverrides', 'auctionSettings', 'keeperLockAt',
    'scoringPreset', 'waiverType', 'waiverPeriodHours', 'faabBudget',
    'tradeDeadlineWeek', 'tradeReviewHours', 'tradeVetoVotes',
  ]);
  assert.equal(FANTASY_ONLY_SETTING_KEYS.length, 26);
  assert.ok(Object.isFrozen(FANTASY_ONLY_SETTING_KEYS));
});

test('the ordered not-frozen list names exactly the registry rows that are fantasy-only and not draft-frozen', () => {
  assert.deepEqual([...FANTASY_ONLY_NOT_FROZEN_KEYS], [
    'scoringPreset', 'waiverType', 'waiverPeriodHours', 'faabBudget', 'tradeDeadlineWeek', 'tradeReviewHours', 'tradeVetoVotes',
  ]);
  const fromRows = SETTINGS.filter((row) => row.fantasyOnly && !row.draftFrozen).map((row) => row.key).sort();
  assert.deepEqual([...FANTASY_ONLY_NOT_FROZEN_KEYS].sort(), fromRows);
  // And the fantasy-only list is exactly the fantasy-only rows (as a set).
  const fantasyRows = SETTINGS.filter((row) => row.fantasyOnly).map((row) => row.key).sort();
  assert.deepEqual([...FANTASY_ONLY_SETTING_KEYS].sort(), fantasyRows);
});

test('DP_GROUP_KEYS is read from lineup.service POSITION_GROUPS; the slot validator names draftValidation.POSITION_KEYS', () => {
  // The literal main's handler carried; the module reads it from the group map instead.
  assert.deepEqual([...DP_GROUP_KEYS], ['DL', 'LB', 'DB']);
  assert.deepEqual([...DP_GROUP_KEYS], Object.keys(POSITION_GROUPS));
  assert.ok(Object.isFrozen(POSITION_KEYS));
  // The unknown-position message lists the canonical keys, so the validator
  // and draftValidation.POSITION_KEYS cannot drift apart.
  const { error } = parseSettingsPatch({ rosterSlots: [{ key: 'X', count: 1, eligiblePositions: ['ZZ'] }] });
  assert.equal(error, `slot "X": unknown position "ZZ" (allowed: ${POSITION_KEYS.join('/')})`);
});

/* ------------------------------------------------------------------ *
 * Every 400 message, byte for byte                                    *
 * ------------------------------------------------------------------ */

const SLOT_NAME_MESSAGE = (label) => `${label}: name must be 1-20 characters using letters, numbers, spaces, hyphens, slashes, or underscores (it cannot start with a space)`;

const REJECTIONS = [
  [{ rosterLimit: 15 }, 'rosterLimit is computed automatically from rosterSlots + benchSlots + irSlots and cannot be set directly'],
  [{ draftDate: 'not a date' }, 'draftDate must be a valid date or null'],
  [{ draftDate: PAST }, 'draftDate must be in the future or null'],
  [{ rosterSlots: [] }, 'rosterSlots must be a non-empty array of slots'],
  [{ rosterSlots: 'QB' }, 'rosterSlots must be a non-empty array of slots'],
  [{ rosterSlots: Array.from({ length: 21 }, (_, i) => ({ key: `S${i}`, count: 1, eligiblePositions: ['QB'] })) }, 'rosterSlots cannot have more than 20 slot rows'],
  [{ rosterSlots: [null] }, 'slot 1 must be an object'],
  [{ rosterSlots: [{ key: 'FLEX!IDP', count: 1, eligiblePositions: ['QB'] }] }, SLOT_NAME_MESSAGE('slot "FLEX!IDP"')],
  [{ rosterSlots: [{ key: ' QB', count: 1, eligiblePositions: ['QB'] }] }, SLOT_NAME_MESSAGE('slot " QB"')],
  [{ rosterSlots: [{ count: 1, eligiblePositions: ['QB'] }] }, SLOT_NAME_MESSAGE('slot 1')],
  [{ rosterSlots: [{ key: 'bench', count: 1, eligiblePositions: ['QB'] }] }, 'slot "bench": "bench" is reserved for the bench/IR system'],
  [{ rosterSlots: [{ key: 'QB', count: 11, eligiblePositions: ['QB'] }] }, 'slot "QB": count must be a whole number between 0 and 10'],
  [{ rosterSlots: [{ key: 'WR', count: 2, eligiblePositions: [] }] }, 'slot "WR": pick at least one eligible position'],
  [{ rosterSlots: [{ key: 'WR', count: 2, eligiblePositions: ['XX'] }] }, 'slot "WR": unknown position "XX" (allowed: QB/RB/WR/TE/K/DEF/DL/LB/DB)'],
  [{ rosterSlots: [QB, { ...QB }] }, 'slot names must be unique; for two of the same slot, raise that slot\'s count instead'],
  [{ rosterSlots: [QB, { key: 'IDP FLEX', count: 4, eligiblePositions: ['DL', 'LB', 'DB'] }] }, 'combined DP-eligible starting slots cannot exceed 3 (base + up to 2 additional)'],
  [{ positionCaps: { QB: 11 } }, 'positionCaps must map QB/RB/WR/TE/K/DEF/DL/LB/DB to integers 0-10'],
  [{ positionCaps: { XX: 1 } }, 'positionCaps must map QB/RB/WR/TE/K/DEF/DL/LB/DB to integers 0-10'],
  [{ positionCaps: [1] }, 'positionCaps must map QB/RB/WR/TE/K/DEF/DL/LB/DB to integers 0-10'],
  [{ benchSlots: 9 }, 'benchSlots must be an integer between 0 and 8'],
  [{ dpEnabled: 'yes' }, 'dpEnabled must be a boolean'],
  [{ irSlots: -1 }, 'irSlots must be an integer between 0 and 5'],
  [{ waiverType: 'rolling' }, "waiverType must be 'priority' or 'faab'"],
  [{ waiverPeriodHours: 169 }, 'waiverPeriodHours must be an integer between 0 and 168'],
  [{ faabBudget: 1001 }, 'faabBudget must be an integer between 0 and 1000'],
  [{ tradeDeadlineWeek: 0 }, 'tradeDeadlineWeek must be an integer between 1 and 18 (or null)'],
  [{ tradeDeadlineWeek: '5' }, 'tradeDeadlineWeek must be an integer between 1 and 18 (or null)'],
  [{ tradeReviewHours: 1.5 }, 'tradeReviewHours must be an integer between 0 and 168'],
  [{ tradeVetoVotes: 21 }, 'tradeVetoVotes must be an integer between 0 and 20'],
  [{ scoringPreset: 'full' }, 'scoringPreset must be one of standard, half_ppr, ppr'],
  [{ scoringRules: { passing: { touchdowns: 51 } } }, 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)'],
  [{ scoringRules: { nope: {} } }, 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)'],
  [{ scoringRules: [] }, 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)'],
  [{ regularSeasonWeeks: 18 }, 'regularSeasonWeeks must be an integer between 1 and 17'],
  [{ playoffTeams: 1 }, 'playoffTeams must be an integer between 2 and 8'],
  [{ playoffConsolation: 1 }, 'playoffConsolation must be a boolean'],
  [{ pickTimeSeconds: 3601 }, 'pickTimeSeconds must be an integer between 0 and 3600 (0 = untimed)'],
  [{ autodraftDelaySeconds: 0 }, 'autodraftDelaySeconds must be an integer between 1 and 60'],
  [{ draftType: 'linear' }, 'draftType must be one of snake, auction, autopick, offline'],
  [{ draftRotation: 'auction' }, 'draftRotation must be one of snake, linear'],
  [{ draftOrderOverrides: [1, 2] }, 'draftOrderOverrides must be an object keyed by round number, or null'],
  [{ draftOrderOverrides: 'round 1' }, 'draftOrderOverrides must be an object keyed by round number, or null'],
  [{ keepersEnabled: 'true' }, 'keepersEnabled must be a boolean'],
  [{ keeperCount: -1 }, 'keeperCount must be a non-negative integer'],
  [{ keeperCount: 1.5 }, 'keeperCount must be a non-negative integer'],
  [{ auctionSettings: 'big' }, 'auctionSettings must be an object'],
  [{ auctionSettings: { budget: 0 } }, 'budget must be a whole number between 1 and 10000'],
  [{ auctionSettings: { budget: 200, nominationSeconds: 5 } }, 'nomination timer must be between 10 and 300 seconds'],
  [{ auctionSettings: { budget: 200, nominationSeconds: 30, bidSeconds: 61 } }, 'bid timer must be between 5 and 60 seconds'],
  [{ auctionSettings: { budget: 200, nominationSeconds: 30, bidSeconds: 10, nominationOrder: 'alphabetical' } }, 'nominationOrder must be "random" or "custom"'],
  [{ auctionSettings: { budget: 200, nominationSeconds: 30, bidSeconds: 10, nominationOrder: 'custom' } }, 'nominationCustomOrder is required when nominationOrder is "custom"'],
  [{ keeperLockAt: 'someday' }, 'keeperLockAt must be a valid date or null'],
  [{ keeperLockAt: PAST }, 'keeperLockAt must be in the future or null'], // #67
  // #66: '' / 0 / false used to be silent no-ops via COALESCE; 12345 went to node-pg raw.
  [{ name: 12345 }, 'name must be a non-empty string of at most 120 characters'],
  [{ name: '' }, 'name must be a non-empty string of at most 120 characters'],
  [{ name: '   ' }, 'name must be a non-empty string of at most 120 characters'],
  [{ name: 'x'.repeat(121) }, 'name must be a non-empty string of at most 120 characters'], // leagues.name is varchar(120)
  // #69: a rate must BE a number; these all coerced (1, 0, 0, 5) and stored raw.
  [{ scoringRules: { passing: { yards: true } } }, 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)'],
  [{ scoringRules: { passing: { yards: null } } }, 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)'],
  [{ scoringRules: { passing: { yards: '' } } }, 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)'],
  [{ scoringRules: { passing: { yards: [5] } } }, 'scoringRules must be a nested { category: { statKey: number|tierArray } } object matching the known scoring schema (rates |value| <= 50; tiers well-formed and non-overlapping)'],
];

for (const [body, message] of REJECTIONS) {
  test(`400 ${JSON.stringify(body).slice(0, 60)} -> ${message.slice(0, 50)}`, () => {
    assert.deepEqual(parseSettingsPatch(body), { error: message });
  });
}

test('the first failing key in validation order wins, exactly as the inline checks did', () => {
  // Every adjacent pair of validated keys, both invalid: the earlier one's
  // message is the 400. Invalid values come from the rejection table itself.
  const invalidFor = Object.fromEntries(REJECTIONS.map(([body, message]) => [Object.keys(body)[0], { value: Object.values(body)[0], message }]));
  const validated = VALIDATION_ORDER.filter((key) => invalidFor[key] && key !== 'rosterLimit');
  for (let i = 0; i + 1 < validated.length; i++) {
    const first = validated[i]; const second = validated[i + 1];
    const body = { [second]: invalidFor[second].value, [first]: invalidFor[first].value };
    assert.equal(parseSettingsPatch(body).error, invalidFor[first].message, `${first} is checked before ${second}`);
  }
  // draftDate is checked before rosterSlots; both invalid -> draftDate's message.
  assert.equal(parseSettingsPatch({ rosterSlots: [], draftDate: 'nope' }).error, 'draftDate must be a valid date or null');
  // rosterLimit is rejected before anything else is looked at.
  assert.equal(parseSettingsPatch({ rosterLimit: 1, draftDate: 'nope' }).error,
    'rosterLimit is computed automatically from rosterSlots + benchSlots + irSlots and cannot be set directly');
  // waiverType precedes scoringPreset, which precedes draftType.
  assert.equal(parseSettingsPatch({ draftType: 'x', scoringPreset: 'x', waiverType: 'x' }).error, "waiverType must be 'priority' or 'faab'");
  assert.equal(parseSettingsPatch({ draftType: 'x', scoringPreset: 'x' }).error, 'scoringPreset must be one of standard, half_ppr, ppr');
});

test('a JSON body carrying a "__proto__" key is inert, as it was for the handler destructure', () => {
  // JSON.parse makes "__proto__" an own data property; the snapshot must not
  // turn it back into a prototype and read settings through it.
  const poisoned = JSON.parse('{"__proto__":{"name":"pwned","keeperCount":2,"keepersEnabled":true,"benchSlots":99}}');
  const { value, error } = parseSettingsPatch(poisoned);
  assert.equal(error, undefined);
  assert.equal(value.name, undefined);
  assert.equal(value.keeperCount, undefined);
  assert.equal(value.rowLockSettingsProvided, false);
  assert.deepEqual(value.frozenRequested, []);
  assert.deepEqual(value.fantasyOnlyRequested, []);
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
});

test('absent keys are not validated, and an empty, missing or non-object body is a valid empty patch', () => {
  for (const body of [{}, undefined, null, [], [1, 2], 'a string', 42, true]) {
    const { value, error } = parseSettingsPatch(body);
    assert.equal(error, undefined);
    assert.equal(value.name, undefined);
    assert.deepEqual(value.frozenRequested, []);
    assert.deepEqual(value.fantasyOnlyRequested, []);
    assert.equal(value.rowLockSettingsProvided, false);
  }
});

/* ------------------------------------------------------------------ *
 * Derivations                                                         *
 * ------------------------------------------------------------------ */

test('name only: an administrative, non-fantasy setting touches no frozen or fantasy-only key', () => {
  const { value } = parseSettingsPatch({ name: 'Renamed' });
  assert.equal(value.name, 'Renamed');
  assert.deepEqual(value.frozenRequested, []);
  assert.deepEqual(value.fantasyOnlyRequested, []);
  assert.equal(value.rosterCompositionChanged, false);
  assert.equal(value.schedulingNonAuction, false);
  assert.equal(value.rowLockSettingsProvided, false);
});

test('size limits are draft-frozen but not fantasy-only, and arrive coerced as newMin / newMax', () => {
  const { value } = parseSettingsPatch({ name: 'x', maxTeams: '12', minTeams: 4 });
  assert.deepEqual(value.frozenRequested, ['minTeams', 'maxTeams']);
  assert.deepEqual(value.fantasyOnlyRequested, []);
  assert.equal(value.newMax, 12);
  assert.equal(value.newMin, 4);
  assert.equal(parseSettingsPatch({}).value.newMax, null);
});

test('a preset materializes rules: it counts as touching the frozen scoringRules, but the refusal names scoringPreset', () => {
  const { value } = parseSettingsPatch({ scoringPreset: 'ppr' });
  assert.deepEqual(value.frozenRequested, ['scoringRules']);
  assert.deepEqual(value.fantasyOnlyRequested, ['scoringPreset']);
  assert.deepEqual(value.effectiveRules, SCORING_PRESETS.ppr);
  assert.equal(value.effectivePreset, 'ppr');
});

test('explicit scoringRules win over a preset and mark the league custom', () => {
  const rules = { passing: { touchdowns: 6 } };
  assert.deepEqual(parseSettingsPatch({ scoringRules: rules }).value.effectiveRules, rules);
  assert.equal(parseSettingsPatch({ scoringRules: rules }).value.effectivePreset, 'custom');
  const both = parseSettingsPatch({ scoringRules: rules, scoringPreset: 'standard' }).value;
  assert.deepEqual(both.effectiveRules, rules);
  assert.equal(both.effectivePreset, 'custom');
  assert.deepEqual(both.frozenRequested, ['scoringRules']);
  assert.deepEqual(both.fantasyOnlyRequested, ['scoringRules', 'scoringPreset']);
  const neither = parseSettingsPatch({ name: 'x' }).value;
  assert.equal(neither.effectiveRules, undefined);
  assert.equal(neither.effectivePreset, undefined);
});

test('waiver and trade settings are administrative (never frozen) yet fantasy-only, named in refusal order', () => {
  const { value } = parseSettingsPatch({ tradeVetoVotes: 3, waiverType: 'faab' });
  assert.deepEqual(value.frozenRequested, []);
  assert.deepEqual(value.fantasyOnlyRequested, ['waiverType', 'tradeVetoVotes']);
});

test('a full fantasy body lists frozen keys in DRAFT_FROZEN order and fantasy-only keys in refusal order', () => {
  const body = {
    keeperLockAt: null, auctionSettings: null, draftOrderOverrides: null, keeperCount: 1, keepersEnabled: true,
    draftRotation: 'linear', draftType: 'snake', draftDate: FUTURE, autodraftDelaySeconds: 5, maxTeams: 12, minTeams: 4,
    pickTimeSeconds: 60, playoffConsolation: true, playoffTeams: 4, regularSeasonWeeks: 14, scoringRules: { passing: { touchdowns: 4 } },
    irSlots: 1, dpEnabled: false, benchSlots: 6, positionCaps: { QB: 3 }, rosterSlots: [QB],
    tradeVetoVotes: 4, tradeReviewHours: 24, tradeDeadlineWeek: null, faabBudget: 100, waiverPeriodHours: 24, waiverType: 'faab',
    scoringPreset: 'ppr', name: 'Full',
  };
  const { value, error } = parseSettingsPatch(body);
  assert.equal(error, undefined);
  // Literal expectations (main's order), not the exports the lists are filtered from.
  assert.deepEqual(value.frozenRequested, [
    'rosterSlots', 'positionCaps', 'benchSlots', 'dpEnabled', 'irSlots',
    'scoringRules', 'regularSeasonWeeks', 'playoffTeams',
    'playoffConsolation', 'pickTimeSeconds', 'minTeams', 'maxTeams', 'autodraftDelaySeconds',
    'draftDate', 'draftType', 'draftRotation', 'keepersEnabled', 'keeperCount',
    'draftOrderOverrides', 'auctionSettings', 'keeperLockAt',
  ]);
  assert.deepEqual(value.fantasyOnlyRequested, [
    'rosterSlots', 'positionCaps', 'benchSlots', 'dpEnabled', 'irSlots',
    'scoringRules', 'regularSeasonWeeks', 'playoffTeams',
    'playoffConsolation', 'pickTimeSeconds', 'autodraftDelaySeconds',
    'draftDate', 'draftType', 'draftRotation', 'keepersEnabled', 'keeperCount',
    'draftOrderOverrides', 'auctionSettings', 'keeperLockAt',
    'scoringPreset', 'waiverType', 'waiverPeriodHours', 'faabBudget',
    'tradeDeadlineWeek', 'tradeReviewHours', 'tradeVetoVotes',
  ]);
  // A partial body keeps relative order too (waiverType before tradeVetoVotes,
  // scoringPreset before both, draft-frozen keys before all of them).
  const partial = parseSettingsPatch({ tradeVetoVotes: 1, waiverType: 'faab', scoringPreset: 'ppr', keeperLockAt: null, benchSlots: 2 }).value;
  assert.deepEqual(partial.fantasyOnlyRequested, ['benchSlots', 'keeperLockAt', 'scoringPreset', 'waiverType', 'tradeVetoVotes']);
  assert.deepEqual(partial.frozenRequested, ['benchSlots', 'scoringRules', 'keeperLockAt']);
});

test('tri-state dates: absent leaves, null clears, a string is normalized to ISO', () => {
  const absent = parseSettingsPatch({}).value;
  assert.equal(absent.draftDateProvided, false);
  assert.equal(absent.draftDateValue, null);
  assert.equal(absent.keeperLockAtProvided, false);
  assert.equal(absent.keeperLockAtValue, null);

  const cleared = parseSettingsPatch({ draftDate: null, keeperLockAt: null }).value;
  assert.equal(cleared.draftDateProvided, true);
  assert.equal(cleared.draftDateValue, null);
  assert.equal(cleared.keeperLockAtProvided, true);
  assert.equal(cleared.keeperLockAtValue, null);
  // A cleared draft date still counts as touching the frozen key and the fantasy-only key.
  assert.deepEqual(cleared.frozenRequested, ['draftDate', 'keeperLockAt']);
  assert.deepEqual(cleared.fantasyOnlyRequested, ['draftDate', 'keeperLockAt']);

  const set = parseSettingsPatch({ draftDate: FUTURE, keeperLockAt: FUTURE }).value;
  assert.equal(set.draftDateValue, new Date(FUTURE).toISOString());
  assert.equal(set.keeperLockAtValue, new Date(FUTURE).toISOString()); // future-checked like draftDate since #67
});

test('tri-state objects: provided flags for draftOrderOverrides, auctionSettings and tradeDeadlineWeek follow presence, null included', () => {
  const absent = parseSettingsPatch({}).value;
  assert.equal(absent.draftOrderOverridesProvided, false);
  assert.equal(absent.auctionSettingsProvided, false);
  assert.equal(absent.tradeDeadlineWeekProvided, false);
  // The trade deadline's write is tri-state (#65): null is a deliberate clear.
  const deadlineCleared = parseSettingsPatch({ tradeDeadlineWeek: null }).value;
  assert.equal(deadlineCleared.tradeDeadlineWeekProvided, true);
  assert.equal(deadlineCleared.tradeDeadlineWeek, null);
  assert.equal(parseSettingsPatch({ tradeDeadlineWeek: 11 }).value.tradeDeadlineWeekProvided, true);
  const cleared = parseSettingsPatch({ draftOrderOverrides: null, auctionSettings: null }).value;
  assert.equal(cleared.draftOrderOverridesProvided, true);
  assert.equal(cleared.auctionSettingsProvided, true);
  assert.equal(cleared.draftOrderOverrides, null);
  assert.equal(cleared.auctionSettings, null);
});

test('the write path switches: roster composition, non-auction scheduling guard, keeper and row-lock triggers', () => {
  assert.equal(parseSettingsPatch({ benchSlots: 5 }).value.rosterCompositionChanged, true);
  assert.equal(parseSettingsPatch({ irSlots: 1 }).value.rosterCompositionChanged, true);
  assert.equal(parseSettingsPatch({ rosterSlots: [QB] }).value.rosterCompositionChanged, true);
  assert.equal(parseSettingsPatch({ positionCaps: { QB: 2 } }).value.rosterCompositionChanged, false);

  assert.equal(parseSettingsPatch({ draftDate: FUTURE }).value.schedulingNonAuction, true);
  assert.equal(parseSettingsPatch({ draftDate: FUTURE, draftType: 'snake' }).value.schedulingNonAuction, false);
  assert.equal(parseSettingsPatch({ draftDate: null }).value.schedulingNonAuction, false);

  assert.equal(parseSettingsPatch({ keepersEnabled: false }).value.keeperSettingsProvided, true);
  assert.equal(parseSettingsPatch({ keeperCount: 2 }).value.rowLockSettingsProvided, true);
  assert.equal(parseSettingsPatch({ auctionSettings: null }).value.rowLockSettingsProvided, true);
  assert.equal(parseSettingsPatch({ draftDate: FUTURE, name: 'x', maxTeams: 10 }).value.rowLockSettingsProvided, false);
});

test('every pass-through setting reaches value unchanged, and the body is read once', () => {
  const body = {
    name: 'Ballers', rosterSlots: [QB], positionCaps: { QB: 2 }, benchSlots: 6, dpEnabled: true, irSlots: 2,
    waiverType: 'faab', waiverPeriodHours: 48, faabBudget: 200, tradeDeadlineWeek: 10, tradeReviewHours: 12,
    tradeVetoVotes: 3, regularSeasonWeeks: 13, playoffTeams: 6, playoffConsolation: true, pickTimeSeconds: 90,
    autodraftDelaySeconds: 15, draftType: 'offline', draftRotation: 'linear', draftOrderOverrides: { 1: [2, 1] },
    auctionSettings: { budget: 200, nominationSeconds: 30, bidSeconds: 10, nominationOrder: 'random' },
    keepersEnabled: true, keeperCount: 2,
  };
  const { value, error } = parseSettingsPatch(body);
  assert.equal(error, undefined);
  for (const key of Object.keys(body)) assert.deepEqual(value[key], body[key], `${key} passes through`);
  // Snapshot semantics: a getter is read once, as the handler's destructure read it once.
  let reads = 0;
  const tricky = { get benchSlots() { reads++; return reads === 1 ? 5 : 'boom'; } };
  assert.equal(parseSettingsPatch(tricky).value.benchSlots, 5);
  assert.equal(reads, 1);
});

test('a valid roster body passes through untouched (space in a slot name, group eligibility)', () => {
  const rosterSlots = [QB, { key: 'IDP FLEX', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] }];
  const { value, error } = parseSettingsPatch({ rosterSlots, dpEnabled: true });
  assert.equal(error, undefined);
  assert.deepEqual(value.rosterSlots, rosterSlots);
  assert.equal(value.dpEnabled, true);
});
