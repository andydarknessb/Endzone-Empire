// The Pick clock module owns the arming policy and its offline composition (ADR
// 0018): the start plan resolves the first pick's clock through the same
// clockSecondsFor every other named event uses, so there is one spelling.
const { clockSecondsFor } = require('./pickClock.service');
const { draftRosterSize } = require('./rosterShape');
const {
  teamForPick,
  validateOrderOverrides,
  keeperPickNumbers,
  nextOpenPickNumber,
} = require('./draftOrder.service');

// The canonical position keys a roster slot's eligiblePositions (and a
// position cap) may name: offense literals + the three IDP group keys. The
// settings module (leagueSettings.service.js) validates roster slots and
// position caps against this same export. A slot's eligiblePositions already
// lives at this granularity: group keys like 'DL' are NOT expanded to member
// positions (DE/DT/NT) here, because position_caps are enforced at the same
// group granularity in draft.service.js's assertPositionCapNotReached, reached
// from pick.service.commitPick via assertRosterAcquisitionAllowed (see the
// POSITION_GROUPS fix there).
const POSITION_KEYS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB']);

/**
 * Pure: can every starting slot + bench + IR possibly be filled given
 * per-position draft caps? This is a bipartite transportation-feasibility
 * check (Hall's condition): for every subset S of *capped* positions, the
 * total draftable count of positions in S must cover the demand of every
 * slot whose entire eligibility is confined to S (a slot that can also draw
 * from an uncapped position is never actually at risk). Uncapped positions
 * supply unlimited players, so only subsets built entirely from capped keys
 * can ever be violated — that keeps the 2^9 subset scan small in practice
 * (a league capping every one of the 9 keys is the worst case).
 */
function positionCapsFeasible({ rosterSlots = [], benchSlots = 0, irSlots = 0, positionCaps = {} }) {
  const caps = {};
  for (const key of POSITION_KEYS) {
    const cap = positionCaps[key];
    caps[key] = Number.isInteger(cap) ? cap : Infinity;
  }

  const demands = rosterSlots
    .filter((s) => Number.isInteger(s.count) && s.count > 0)
    .map((s) => ({ label: s.label || s.key, eligible: new Set(s.eligiblePositions || []), count: s.count }));
  if (benchSlots > 0) demands.push({ label: 'BENCH', eligible: new Set(POSITION_KEYS), count: benchSlots });
  if (irSlots > 0) demands.push({ label: 'IR', eligible: new Set(POSITION_KEYS), count: irSlots });

  const cappedKeys = POSITION_KEYS.filter((k) => Number.isFinite(caps[k]));
  const errorMessages = new Set();
  const n = cappedKeys.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = new Set();
    let capacity = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        subset.add(cappedKeys[i]);
        capacity += caps[cappedKeys[i]];
      }
    }
    let demand = 0;
    const blocking = [];
    for (const d of demands) {
      if (d.eligible.size === 0) continue;
      let confined = true;
      for (const p of d.eligible) {
        if (!subset.has(p)) { confined = false; break; }
      }
      if (confined) {
        demand += d.count;
        blocking.push(d.label);
      }
    }
    if (demand > capacity) {
      const subsetLabel = [...subset].sort().join('/');
      errorMessages.add(
        `${subsetLabel} limit${subset.size > 1 ? 's' : ''} allow only ${capacity} total drafted, ` +
        `but ${blocking.join(', ')} need${blocking.length === 1 ? 's' : ''} ${demand}`
      );
    }
  }

  return { feasible: errorMessages.size === 0, errors: [...errorMessages].slice(0, 10) };
}

/**
 * Pure: validate a proposed auction_settings object shape/bounds. Does not
 * check nominationCustomOrder against live team ids — the caller re-checks
 * that at save time (teams can change between saves).
 */
function validateAuctionSettings(settings) {
  if (settings == null) return null;
  if (typeof settings !== 'object' || Array.isArray(settings)) {
    return 'auctionSettings must be an object';
  }
  const { budget, nominationSeconds, bidSeconds, nominationOrder, nominationCustomOrder } = settings;
  if (!Number.isInteger(budget) || budget < 1 || budget > 10000) {
    return 'budget must be a whole number between 1 and 10000';
  }
  if (!Number.isInteger(nominationSeconds) || nominationSeconds < 10 || nominationSeconds > 300) {
    return 'nomination timer must be between 10 and 300 seconds';
  }
  if (!Number.isInteger(bidSeconds) || bidSeconds < 5 || bidSeconds > 60) {
    return 'bid timer must be between 5 and 60 seconds';
  }
  if (nominationOrder !== 'random' && nominationOrder !== 'custom') {
    return 'nominationOrder must be "random" or "custom"';
  }
  if (nominationOrder === 'custom' && !Array.isArray(nominationCustomOrder)) {
    return 'nominationCustomOrder is required when nominationOrder is "custom"';
  }
  return null;
}

/**
 * Pure: validate a full replace-all keeper list. rosterByTeam is a
 * Map<teamId, Set<playerId>> of each team's *current* roster — a team with
 * an empty (or absent) roster is treated leniently (pre-first-draft leagues
 * have no rosters yet), otherwise the kept player must already be on that
 * team. Returns an array of error strings (empty when valid).
 */
function validateKeepers(keepers, { teams = [], rosterByTeam = new Map(), keeperCount = 0, draftRosterSize: rounds = 0 }) {
  if (!Array.isArray(keepers)) return ['keepers must be an array'];
  const errors = [];
  const teamIds = new Set(teams.map((t) => t.id));
  const seenPlayers = new Set();
  const seenTeamRound = new Set();
  const perTeamCount = new Map();

  for (const k of keepers) {
    if (!Number.isInteger(k.teamId) || !teamIds.has(k.teamId)) {
      errors.push(`keeper references an unknown team ${k.teamId}`);
      continue;
    }
    if (!Number.isInteger(k.playerId)) {
      errors.push(`keeper for team ${k.teamId} is missing a player`);
      continue;
    }
    if (!Number.isInteger(k.round) || k.round < 1 || k.round > rounds) {
      errors.push(`keeper round must be between 1 and ${rounds} (the league's draft roster size)`);
      continue;
    }
    if (seenPlayers.has(k.playerId)) {
      errors.push(`player ${k.playerId} is kept by more than one team`);
      continue;
    }
    seenPlayers.add(k.playerId);

    const teamRoundKey = `${k.teamId}:${k.round}`;
    if (seenTeamRound.has(teamRoundKey)) {
      errors.push(`team ${k.teamId} has two keepers assigned to round ${k.round}`);
      continue;
    }
    seenTeamRound.add(teamRoundKey);

    const roster = rosterByTeam.get(k.teamId);
    if (roster && roster.size > 0 && !roster.has(k.playerId)) {
      errors.push(`player ${k.playerId} is not on team ${k.teamId}'s roster`);
    }

    perTeamCount.set(k.teamId, (perTeamCount.get(k.teamId) || 0) + 1);
  }

  for (const [teamId, count] of perTeamCount) {
    if (count > keeperCount) {
      errors.push(`team ${teamId} has ${count} keepers but the league allows ${keeperCount}`);
    }
  }

  return errors;
}

/** Pure: decide whether a keeper-settings update must clear or reject existing assignments. */
function keeperSettingsPlan({ currentEnabled, currentCount, keepersEnabled, keeperCount, assignmentCounts = [] }) {
  const effectiveEnabled = keepersEnabled === undefined ? currentEnabled : keepersEnabled;
  const effectiveCount = keeperCount === undefined ? currentCount : keeperCount;
  if (!effectiveEnabled) return { clearAssignments: true, error: null };

  const conflicts = assignmentCounts
    .filter((row) => Number(row.count) > effectiveCount)
    .map((row) => `team ${row.team_id} has ${Number(row.count)}`);
  if (conflicts.length > 0) {
    return {
      clearAssignments: false,
      error: `keeperCount cannot be set to ${effectiveCount}: ${conflicts.join(', ')} existing keeper assignment(s); remove assignments first or disable keepers`,
    };
  }
  return { clearAssignments: false, error: null };
}

/**
 * Pure: which draft_picks rows an undo of `count` picks would remove. Undo
 * only ever touches the most recent live picks (highest pick_number) and
 * refuses outright if a keeper pick (pre-inserted at draft start) is among
 * them — keepers are configuration, not something "undo" can retract.
 */
function undoTargets(picks, count = 1) {
  if (!Number.isInteger(count) || count < 1) {
    return { targets: [], error: 'count must be a positive integer' };
  }
  const sorted = [...picks].sort((a, b) => b.pick_number - a.pick_number);
  if (sorted.length === 0) {
    return { targets: [], error: 'no picks to undo' };
  }
  if (sorted.length < count) {
    return { targets: [], error: `only ${sorted.length} pick(s) have been made` };
  }
  const slice = sorted.slice(0, count);
  const keeperHit = slice.find((p) => p.is_keeper);
  if (keeperHit) {
    return { targets: [], error: `pick ${keeperHit.pick_number} is a keeper selection and cannot be undone` };
  }
  return { targets: slice.map((p) => p.pick_number), error: null };
}

/**
 * Pure: the single Pick a Commissioner correction (#439) reverses, or a stable
 * SCREAMING_SNAKE code (ADR 0008) naming exactly why it cannot. A correction is
 * not the general N-pick undo above: it reverses ONLY the latest live-reached
 * non-keeper Pick, as one atomic act, so this returns at most one target.
 *
 * `currentPick` is the league's 0-based pick-on-the-clock index; a Pick counts
 * as reached only when its 1-based `pick_number` is at or below it, so a keeper
 * pre-filled far ahead of live play never poses as the latest Pick (the same
 * `pick_number <= current_pick` filter the undo route applies).
 *
 * `expectedPickNumber` is the Pick the commissioner is looking at when they
 * confirm. When provided it must still be the latest reached Pick; if a manager
 * or autopick landed a newer Pick since, the request is stale and rejected
 * rather than silently reversing a different Pick than the one confirmed (#439:
 * cannot race a manager or autopick). Pass null to skip that check.
 */
function correctionTarget(picks, currentPick, expectedPickNumber = null) {
  const reached = picks
    .filter((p) => p.pick_number <= (currentPick ?? 0))
    .sort((a, b) => b.pick_number - a.pick_number);
  const latest = reached[0];
  if (!latest) return { target: null, code: 'NO_PICK_TO_CORRECT' };
  if (latest.is_keeper) return { target: null, code: 'KEEPER_UNCORRECTABLE' };
  if (expectedPickNumber != null && expectedPickNumber !== latest.pick_number) {
    return { target: null, code: 'LATEST_PICK_CHANGED' };
  }
  return { target: latest, code: null };
}

/**
 * Pure: decide whether/how a draft can start. Returns { error: {status,
 * message} } when it can't, otherwise the plan draftStart.service.js needs:
 * which picks are pre-filled by keepers, whether every team should
 * autodraft (autopick-type leagues), whether the draft runs clockless
 * (offline-type), and the clock to arm for the first open pick.
 */
function startPlan(league, teams, keepers = []) {
  if (league.draft_type === 'auction') {
    return {
      error: { status: 409, message: 'Salary cap / auction drafts are not supported yet. This league cannot start its draft until that ships.' },
    };
  }

  const teamIds = teams.map((t) => t.id);
  // Rounds are the draft roster size: the IR slot is never drafted (#96).
  const rounds = draftRosterSize(league);
  const totalPicks = teams.length * rounds;
  const rotationOpts = { rotation: league.draft_rotation, overrides: league.draft_order_overrides };

  const overridesError = validateOrderOverrides(league.draft_order_overrides, teamIds, rounds);
  if (overridesError) {
    return { error: { status: 409, message: `draft order overrides are stale: ${overridesError}` } };
  }

  const activeKeepers = league.keepers_enabled ? keepers : [];
  const normalizedKeepers = activeKeepers.map((keeper) => ({
    teamId: keeper.team_id,
    playerId: keeper.player_id,
    round: keeper.draft_round,
  }));
  const keeperErrors = validateKeepers(normalizedKeepers, {
    teams,
    keeperCount: league.keeper_count,
    draftRosterSize: rounds,
  });
  if (keeperErrors.length > 0) {
    return { error: { status: 409, message: `keepers are stale: ${keeperErrors.join('; ')}` } };
  }

  let keeperPicks;
  try {
    keeperPicks = keeperPickNumbers(activeKeepers, teams, rotationOpts).map(({ keeper, pickNumber }) => ({
      teamId: keeper.team_id,
      playerId: keeper.player_id,
      pickNumber,
    }));
  } catch (err) {
    return { error: { status: 409, message: `keepers are stale: ${err.message}` } };
  }

  const takenSet = new Set(keeperPicks.map((k) => k.pickNumber));
  if (takenSet.size !== keeperPicks.length) {
    return { error: { status: 409, message: 'two keepers resolve to the same draft pick; recheck round assignments' } };
  }

  const clockless = league.draft_type === 'offline';
  const autodraftAll = league.draft_type === 'autopick';
  const firstOpenPick = nextOpenPickNumber(takenSet, 0, totalPicks);

  let firstClockSeconds = null;
  if (firstOpenPick !== null) {
    // clockSecondsFor applies the offline rule itself (an offline draft arms no
    // clock), so no separate clockless gate is needed here.
    const onClock = teamForPick(firstOpenPick, teams, rotationOpts);
    firstClockSeconds = clockSecondsFor({
      draftComplete: false,
      onClockAutodraft: autodraftAll || Boolean(onClock && onClock.autodraft),
      league,
    });
  }

  // `rounds` is exposed so the caller (draftStart.service.js) can fix it as
  // `draft_rounds` at the pending -> active transition without a second,
  // possibly-inconsistent call to draftRosterSize() (ADR 0005).
  return { autodraftAll, clockless, keeperPicks, firstOpenPick, firstClockSeconds, totalPicks, rounds };
}

module.exports = {
  POSITION_KEYS,
  positionCapsFeasible,
  validateAuctionSettings,
  validateKeepers,
  keeperSettingsPlan,
  undoTargets,
  correctionTarget,
  startPlan,
};
