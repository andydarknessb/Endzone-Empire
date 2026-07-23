const test = require('node:test');
const assert = require('node:assert/strict');
const {
  positionCapsFeasible,
  validateAuctionSettings,
  validateKeepers,
  keeperSettingsPlan,
  undoTargets,
  startPlan,
} = require('../services/draftValidation.service');

// --- positionCapsFeasible ---------------------------------------------------

test('positionCapsFeasible: uncapped positions are always feasible', () => {
  const rosterSlots = [
    { key: 'QB', count: 1, eligiblePositions: ['QB'] },
    { key: 'RB', count: 2, eligiblePositions: ['RB'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ];
  const result = positionCapsFeasible({ rosterSlots, benchSlots: 5, irSlots: 1, positionCaps: {} });
  assert.equal(result.feasible, true);
  assert.deepEqual(result.errors, []);
});

test('positionCapsFeasible: a cap below its own dedicated slot demand fails', () => {
  const rosterSlots = [{ key: 'DEF', count: 1, eligiblePositions: ['DEF'] }];
  const result = positionCapsFeasible({ rosterSlots, positionCaps: { DEF: 0 } });
  assert.equal(result.feasible, false);
  assert.match(result.errors[0], /DEF/);
});

test('positionCapsFeasible: FLEX eligibility can be locked out only when ALL its eligible positions are capped together', () => {
  const rosterSlots = [
    { key: 'RB', count: 2, eligiblePositions: ['RB'] },
    { key: 'WR', count: 2, eligiblePositions: ['WR'] },
    { key: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  ];
  // RB=2 and WR=2 each exactly cover their own dedicated slot, and {RB,WR}
  // alone covers FLEX's demand too (FLEX isn't "confined" to {RB,WR} since
  // it can also draw from TE) — only capping TE as well closes that escape
  // hatch and traps FLEX's extra demand against the combined RB+WR+TE cap.
  const stillOk = positionCapsFeasible({ rosterSlots, positionCaps: { RB: 2, WR: 2 } });
  assert.equal(stillOk.feasible, true);

  const locked = positionCapsFeasible({ rosterSlots, positionCaps: { RB: 2, WR: 2, TE: 0 } });
  assert.equal(locked.feasible, false);
  assert.match(locked.errors[0], /RB\/TE\/WR/);
});

test('positionCapsFeasible: IDP group slot vs DL/LB/DB caps', () => {
  const rosterSlots = [{ key: 'DP', count: 1, eligiblePositions: ['DL', 'LB', 'DB'] }];
  const ok = positionCapsFeasible({ rosterSlots, positionCaps: { DL: 1, LB: 1, DB: 1 } });
  assert.equal(ok.feasible, true);

  const locked = positionCapsFeasible({ rosterSlots, positionCaps: { DL: 0, LB: 0, DB: 0 } });
  assert.equal(locked.feasible, false);
});

test('positionCapsFeasible: bench/IR only count against the fully-capped universe', () => {
  const rosterSlots = [{ key: 'QB', count: 1, eligiblePositions: ['QB'] }];
  // Only QB is capped — bench/IR can always be filled from any uncapped
  // position, so they never add demand here.
  const partiallyCapped = positionCapsFeasible({
    rosterSlots, benchSlots: 5, irSlots: 1, positionCaps: { QB: 1 },
  });
  assert.equal(partiallyCapped.feasible, true);
});

// --- validateAuctionSettings -------------------------------------------------

test('validateAuctionSettings: null is fine (only meaningful for auction leagues)', () => {
  assert.equal(validateAuctionSettings(null), null);
});

test('validateAuctionSettings: accepts a well-formed object', () => {
  assert.equal(
    validateAuctionSettings({ budget: 200, nominationSeconds: 30, bidSeconds: 10, nominationOrder: 'random' }),
    null
  );
});

test('validateAuctionSettings: rejects out-of-bounds and malformed fields', () => {
  assert.match(validateAuctionSettings({ budget: 0, nominationSeconds: 30, bidSeconds: 10, nominationOrder: 'random' }), /budget/);
  assert.match(validateAuctionSettings({ budget: 200, nominationSeconds: 5, bidSeconds: 10, nominationOrder: 'random' }), /nomination timer/);
  assert.match(validateAuctionSettings({ budget: 200, nominationSeconds: 30, bidSeconds: 100, nominationOrder: 'random' }), /bid timer/);
  assert.match(validateAuctionSettings({ budget: 200, nominationSeconds: 30, bidSeconds: 10, nominationOrder: 'whenever' }), /nominationOrder/);
  assert.match(
    validateAuctionSettings({ budget: 200, nominationSeconds: 30, bidSeconds: 10, nominationOrder: 'custom' }),
    /nominationCustomOrder/
  );
});

// --- validateKeepers ---------------------------------------------------------

const teams = [{ id: 1 }, { id: 2 }];

test('validateKeepers: valid list against non-empty rosters', () => {
  const rosterByTeam = new Map([[1, new Set([100])], [2, new Set([200])]]);
  const errors = validateKeepers(
    [{ teamId: 1, playerId: 100, round: 3 }, { teamId: 2, playerId: 200, round: 5 }],
    { teams, rosterByTeam, keeperCount: 2, rosterLimit: 15 }
  );
  assert.deepEqual(errors, []);
});

test('validateKeepers: empty roster is lenient (pre-first-draft league)', () => {
  const errors = validateKeepers(
    [{ teamId: 1, playerId: 999, round: 1 }],
    { teams, rosterByTeam: new Map(), keeperCount: 1, rosterLimit: 15 }
  );
  assert.deepEqual(errors, []);
});

test('validateKeepers: rejects a player not on a non-empty roster', () => {
  const rosterByTeam = new Map([[1, new Set([100])]]);
  const errors = validateKeepers(
    [{ teamId: 1, playerId: 999, round: 1 }],
    { teams, rosterByTeam, keeperCount: 1, rosterLimit: 15 }
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not on team 1's roster/);
});

test('validateKeepers: rejects duplicate round for the same team', () => {
  const errors = validateKeepers(
    [{ teamId: 1, playerId: 100, round: 1 }, { teamId: 1, playerId: 101, round: 1 }],
    { teams, rosterByTeam: new Map(), keeperCount: 5, rosterLimit: 15 }
  );
  assert.match(errors.join(';'), /two keepers assigned to round 1/);
});

test('validateKeepers: rejects a player kept by two teams', () => {
  const errors = validateKeepers(
    [{ teamId: 1, playerId: 100, round: 1 }, { teamId: 2, playerId: 100, round: 1 }],
    { teams, rosterByTeam: new Map(), keeperCount: 5, rosterLimit: 15 }
  );
  assert.match(errors.join(';'), /kept by more than one team/);
});

test('validateKeepers: enforces the per-team keeper count', () => {
  const errors = validateKeepers(
    [{ teamId: 1, playerId: 100, round: 1 }, { teamId: 1, playerId: 101, round: 2 }],
    { teams, rosterByTeam: new Map(), keeperCount: 1, rosterLimit: 15 }
  );
  assert.match(errors.join(';'), /allows 1/);
});

// --- undoTargets --------------------------------------------------------

test('undoTargets: undoes the most recent N picks', () => {
  const picks = [
    { pick_number: 1, is_keeper: false },
    { pick_number: 2, is_keeper: false },
    { pick_number: 3, is_keeper: false },
  ];
  const result = undoTargets(picks, 2);
  assert.deepEqual(result.targets, [3, 2]);
  assert.equal(result.error, null);
});

test('undoTargets: refuses to cross a keeper pick', () => {
  const picks = [
    { pick_number: 1, is_keeper: true },
    { pick_number: 2, is_keeper: false },
  ];
  const result = undoTargets(picks, 2);
  assert.deepEqual(result.targets, []);
  assert.match(result.error, /keeper selection/);
});

test('undoTargets: errors when fewer picks exist than requested', () => {
  const result = undoTargets([{ pick_number: 1, is_keeper: false }], 3);
  assert.match(result.error, /only 1/);
});

// --- startPlan ------------------------------------------------------------

const baseLeague = {
  draft_type: 'snake',
  draft_rotation: 'snake',
  draft_order_overrides: null,
  keepers_enabled: true,
  keeper_count: 2,
  roster_limit: 2,
  pick_time_seconds: 90,
  autodraft_delay_seconds: 10,
};
const startTeams = [{ id: 1, autodraft: false }, { id: 2, autodraft: false }];

test('startPlan: auction leagues are blocked with a 501', () => {
  const plan = startPlan({ ...baseLeague, draft_type: 'auction' }, startTeams, []);
  assert.equal(plan.error.status, 501);
});

test('startPlan: autopick leagues plan to autodraft every team', () => {
  const plan = startPlan({ ...baseLeague, draft_type: 'autopick' }, startTeams, []);
  assert.equal(plan.autodraftAll, true);
  assert.equal(plan.clockless, false);
  assert.equal(plan.firstOpenPick, 0);
});

test('startPlan: offline leagues run clockless', () => {
  const plan = startPlan({ ...baseLeague, draft_type: 'offline' }, startTeams, []);
  assert.equal(plan.clockless, true);
  assert.equal(plan.firstClockSeconds, null);
});

test('startPlan: a keeper pre-fills its resolved pick and shifts the first open pick', () => {
  const plan = startPlan(baseLeague, startTeams, [{ team_id: 1, player_id: 100, draft_round: 1 }]);
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.keeperPicks, [{ teamId: 1, playerId: 100, pickNumber: 0 }]);
  assert.equal(plan.firstOpenPick, 1);
});

test('startPlan: disabled keepers ignore existing assignments', () => {
  const plan = startPlan(
    { ...baseLeague, keepers_enabled: false, keeper_count: 0 },
    startTeams,
    [{ team_id: 1, player_id: 100, draft_round: 1 }]
  );
  assert.equal(plan.error, undefined);
  assert.deepEqual(plan.keeperPicks, []);
  assert.equal(plan.firstOpenPick, 0);
});

test('startPlan: rejects assignments above the current keeper count', () => {
  const plan = startPlan(
    { ...baseLeague, keeper_count: 1 },
    startTeams,
    [
      { team_id: 1, player_id: 100, draft_round: 1 },
      { team_id: 1, player_id: 101, draft_round: 2 },
    ]
  );
  assert.equal(plan.error.status, 409);
  assert.match(plan.error.message, /allows 1/);
});

test('keeperSettingsPlan: disabling keepers clears existing assignments', () => {
  assert.deepEqual(keeperSettingsPlan({
    currentEnabled: true,
    currentCount: 2,
    keepersEnabled: false,
    assignmentCounts: [{ team_id: 1, count: 2 }],
  }), { clearAssignments: true, error: null });
});

test('keeperSettingsPlan: lowering the count below existing assignments is rejected', () => {
  const plan = keeperSettingsPlan({
    currentEnabled: true,
    currentCount: 2,
    keeperCount: 1,
    assignmentCounts: [{ team_id: 1, count: 2 }],
  });
  assert.equal(plan.clearAssignments, false);
  assert.match(plan.error, /team 1 has 2/);
});

test('keeperSettingsPlan: a valid keeper-count update preserves assignments', () => {
  assert.deepEqual(keeperSettingsPlan({
    currentEnabled: true,
    currentCount: 1,
    keeperCount: 2,
    assignmentCounts: [{ team_id: 1, count: 1 }],
  }), { clearAssignments: false, error: null });
});

test('startPlan: stale overrides (team no longer in the league) are rejected', () => {
  const plan = startPlan(
    { ...baseLeague, draft_order_overrides: { '1': [1, 999] } },
    startTeams,
    []
  );
  assert.equal(plan.error.status, 409);
  assert.match(plan.error.message, /stale/);
});

test('startPlan: a keeper whose team no longer picks that round is rejected', () => {
  const plan = startPlan(baseLeague, startTeams, [{ team_id: 999, draft_round: 1 }]);
  assert.equal(plan.error.status, 409);
  assert.match(plan.error.message, /stale/);
});
