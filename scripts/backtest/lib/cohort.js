'use strict';

/**
 * The MAPPED RECONSTRUCTED ROSTER COHORT, and the outcome truth for it.
 *
 * The name is the specification. Each word is a limitation the study accepted
 * deliberately, and this module is where each one is enforced and COUNTED:
 *
 * - **mapped**: a player must carry a well-formed `gsis_id` that the pinned
 *   crosswalk maps to an ESPN id, and that ESPN id must match a database
 *   player's `external_id`. Unmappable identifiers are excluded and counted
 *   (preregistration 2.8 records 205 in 2024 and 150 in 2025).
 * - **reconstructed**: team and position come from the weekly ROSTER FILE for
 *   that week, never from today's `players` row. There is no today's-position
 *   fallback in the primary analysis; a player whose week position cannot be
 *   established is excluded and counted (prereg 4.1).
 * - **roster**: membership is a roster row with `game_type = REG` and an
 *   ACTIVE-class status. `ACT` and `INA` both qualify (prereg 3.1) - keeping
 *   only players who dressed would be the survivorship cohort this rebuild
 *   exists to eliminate.
 *
 * OUTCOME TRUTH (prereg 4.3) is three-way and the precedence is not negotiable:
 * the PINNED EXTERNAL sources are primary, the production database is a QA
 * check that can disagree without changing anything, and absence from BOTH stat
 * sources means "zero recorded fantasy points" - an actual `0`, not a missing
 * value. Ambiguity - present in one source but not the other, or present with
 * contradictory team attribution - is an exclusion by preregistered rule, and
 * it is counted so a labelled sensitivity can put those rows back.
 *
 * Pure: no database, no network, no filesystem, no clock. Scoring and team
 * normalization are injected, because nothing in `scripts/backtest` may require
 * `server/services`.
 */

const {
  normalizeSourceField,
  FANTASY_POSITIONS,
  FANTASY_ROSTER_POSITIONS,
} = require('./mappings');
const { QUARANTINE_FROM_SEASON } = require('./snapshotStore');
const {
  isMissing, requiredNumber, optionalNumber, countingNumber, roundToTie,
} = require('./numbers');
const asOf = require('./asOfView');

/** A well-formed modern GSIS id. Legacy pre-GSIS shapes are excluded by shape. */
const GSIS_ID = /^00-\d{7}$/;

/** Every reason a player-week can fail to enter the cohort. Closed set. */
const EXCLUSION_REASONS = Object.freeze([
  // Unreachable from buildCohort, which only ever iterates roster rows that
  // exist - but asOfView can return it for a direct caller, and the closed set
  // has to cover everything that module can produce or the drift check below
  // would reject a legitimate reason.
  'no-roster-row',
  'status-class-reserve',
  'status-class-off_roster',
  'no-fantasy-position',
  'malformed-gsis-id',
  'unmapped-gsis-id',
  'absent-from-players-table',
]);

/** Every reason an OUTCOME can be unusable. Closed set. */
const OUTCOME_EXCLUSION_REASONS = Object.freeze([
  'ambiguous-one-source-only',
  'ambiguous-team-contradiction',
]);

// ---------------------------------------------------------------------------
// The crosswalk, and the link to database players
// ---------------------------------------------------------------------------

/**
 * Pure: `gsis_id -> espn_id`, from the pinned `players.csv`.
 *
 * Mirrors `nflverseSync.fetchPlayersCrosswalk` (:132-140), which keeps a row
 * only when BOTH ids are present. Legacy pre-GSIS identifier shapes (6098 rows,
 * prereg 2.7) are dropped BY SHAPE and never used as a key: they belong to
 * players whose last season was in the 1980s, and admitting them would let a
 * 40-year-old identifier collide with a modern one.
 */
function buildCrosswalk(playersCsvRows, { label = 'players.csv' } = {}) {
  const espnByGsis = new Map();
  const gsisByEspn = new Map();
  let legacyShape = 0;
  for (const row of playersCsvRows || []) {
    const gsis = normalizeSourceField(row.gsis_id);
    const espn = normalizeSourceField(row.espn_id);
    if (gsis === '' || espn === '') continue;
    if (!GSIS_ID.test(gsis)) { legacyShape++; continue; }
    if (espnByGsis.has(gsis) && espnByGsis.get(gsis) !== espn) {
      throw new Error(`${label}: gsis ${gsis} maps to two espn ids (${espnByGsis.get(gsis)}, ${espn})`);
    }
    if (gsisByEspn.has(espn) && gsisByEspn.get(espn) !== gsis) {
      throw new Error(`${label}: espn ${espn} maps to two gsis ids (${gsisByEspn.get(espn)}, ${gsis})`);
    }
    espnByGsis.set(gsis, espn);
    gsisByEspn.set(espn, gsis);
  }
  return { espnByGsis, gsisByEspn, legacyShape, mappable: espnByGsis.size };
}

/**
 * Pure: the `playerId -> gsisId` map the snapshot client needs for
 * reconstructed mode - the one Phase 2 left injected.
 *
 * The join is production's own, reproduced exactly:
 * `String(players.external_id) === String(crosswalk.get(gsis_id))`
 * (nflverseSync.service.js:224 builds `idByExternal`; :177 and :548 look up
 * `String(espnId)`). Both sides are stringified for the same reason production
 * stringifies them - `external_id` is an integer column and the crosswalk's
 * `espn_id` is CSV text, so a numeric comparison would silently miss.
 *
 * A database player whose `external_id` matches no crosswalk entry simply has
 * no reconstruction; that is the "absent from today's players table" limitation
 * seen from the other side, and it is counted by the caller.
 */
function buildGsisByPlayerId({ dbPlayers, crosswalk, label = 'cohort' }) {
  if (!crosswalk || !crosswalk.gsisByEspn) {
    throw new Error(`${label}: buildGsisByPlayerId needs a crosswalk from buildCrosswalk`);
  }
  const gsisByPlayerId = new Map();
  const playerIdByGsis = new Map();
  let unlinked = 0;
  for (const player of dbPlayers || []) {
    const external = player.external_id;
    if (external === null || external === undefined || String(external).trim() === '') {
      unlinked++;
      continue;
    }
    const gsis = crosswalk.gsisByEspn.get(String(external).trim());
    if (!gsis) { unlinked++; continue; }
    const id = Number(player.id);
    if (playerIdByGsis.has(gsis)) {
      throw new Error(
        `${label}: gsis ${gsis} resolves to two database players ` +
        `(${playerIdByGsis.get(gsis)} and ${id}) - the crosswalk join is not one-to-one`
      );
    }
    gsisByPlayerId.set(id, gsis);
    playerIdByGsis.set(gsis, id);
  }
  return { gsisByPlayerId, playerIdByGsis, unlinked };
}

/**
 * Pure: `teamKey -> players.id` for the database's DEF pseudo-players.
 *
 * Production stores one `players` row per defence, with a full team name in
 * `nfl_team` and `position = 'DEF'`. The synthesized cohort DEF borrows that
 * row's identity so the deployed-policy wrapper can order it by the same
 * captured `(name, id)` collation rank production would use.
 *
 * Fail-closed on a duplicate: two DEF rows folding to one team key would make
 * the borrowed identity ambiguous, and the tie order would depend on which one
 * happened to win.
 */
function buildDefensePlayerIndex({ dbPlayers, normalizeTeamKey, label = 'DEF index' }) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error(`${label}: buildDefensePlayerIndex requires normalizeTeamKey to be injected`);
  }
  const byTeamKey = new Map();
  for (const player of dbPlayers || []) {
    if (player.position !== 'DEF') continue;
    const key = player.team_key || normalizeTeamKey(player.nfl_team);
    if (!key) throw new Error(`${label}: DEF player ${player.id} has no resolvable team`);
    if (byTeamKey.has(key)) {
      throw new Error(
        `${label}: two DEF players map to ${key} (${byTeamKey.get(key)} and ${player.id}), so the ` +
        'identity a synthesized defence borrows would be ambiguous'
      );
    }
    byTeamKey.set(key, Number(player.id));
  }
  return byTeamKey;
}

// ---------------------------------------------------------------------------
// The cohort
// ---------------------------------------------------------------------------

function emptyTally(reasons) {
  return Object.fromEntries(reasons.map((r) => [r, 0]));
}

/**
 * Build the cohort for one (season, week).
 *
 * Returns members plus a full accounting: every player-week the roster file
 * offered that did NOT become a member is counted under exactly one reason, so
 * `members.length + sum(excluded)` equals what was considered. The published
 * report needs those numbers, and a cohort builder that only returns the
 * survivors cannot produce them.
 */
function buildCohort({
  season,
  week,
  rosterIndex,
  crosswalk,
  playerIdByGsis,
  injuryIndex = null,
  policy = asOf.INJURY_POLICIES.PRIMARY,
  earliestKickoff = null,
  normalizeTeamKey,
  statsGameTeamFor,
  byeTeamKeys,
  defenseTeamKeys,
  defensePlayerIdByTeamKey = new Map(),
  label = 'cohort',
}) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error(`${label}: buildCohort requires the production normalizeTeamKey to be injected`);
  }
  // REQUIRED, not defaulted, because every plausible default here is SILENTLY
  // INERT rather than obviously broken:
  //
  //   - a missing `byeTeamKeys` marks every player `onBye: false`, which quietly
  //     pulls bye players into point-accuracy scoring against prereg 4.1;
  //   - a missing `statsGameTeamFor` reports zero contradictions, so the
  //     published contradiction count would be a confident zero rather than
  //     an unmeasured one;
  //   - a missing `defenseTeamKeys` synthesizes no DEF at all, silently
  //     dropping a sixth of the cohort.
  //
  // None of those throws, and each produces plausible output. An explicit empty
  // value stays legal where a caller genuinely means it.
  for (const [name, value, check] of [
    ['statsGameTeamFor', statsGameTeamFor, (v) => typeof v === 'function'],
    ['byeTeamKeys', byeTeamKeys, (v) => v instanceof Set || Array.isArray(v)],
    ['defenseTeamKeys', defenseTeamKeys, (v) => Array.isArray(v) || v instanceof Set],
  ]) {
    if (value === undefined || value === null || !check(value)) {
      throw new Error(
        `${label}: buildCohort requires ${name}. Omitting it does not fail - it quietly changes ` +
        'what the cohort means, so it has to be named at the call boundary. Pass an explicit ' +
        'empty value if that is genuinely what you mean.'
      );
    }
  }
  const byeKeys = byeTeamKeys instanceof Set ? byeTeamKeys : new Set(byeTeamKeys);
  assertNotQuarantined(season, { label });

  const members = [];
  const excluded = emptyTally(EXCLUSION_REASONS);
  const excludedIds = { unmappedGsis: [], absentFromPlayers: [] };
  let contradictions = 0;

  for (const entry of rosterIndex.byPlayerWeek.values()) {
    if (entry.season !== Number(season) || entry.week !== Number(week)) continue;

    // Shape first: a legacy identifier is not a modern player.
    if (!GSIS_ID.test(entry.gsisId)) { excluded['malformed-gsis-id']++; continue; }

    const view = asOf.reconstructPlayerWeek({
      rosterIndex,
      injuryIndex,
      policy,
      season,
      week,
      gsisId: entry.gsisId,
      earliestKickoff,
      normalizeTeamKey,
      statsGameTeam: statsGameTeamFor(entry.gsisId),
    });
    if (!view.inCohort) {
      // An unknown reason means asOfView and this module have drifted apart.
      // Re-bucketing it as 'no-fantasy-position' would silently mis-attribute a
      // whole class of exclusion in the published counts, so it throws.
      if (!EXCLUSION_REASONS.includes(view.reason)) {
        throw new Error(
          `${label}: asOfView returned exclusion reason ${JSON.stringify(view.reason)}, which is not ` +
          `in the closed set [${EXCLUSION_REASONS.join(', ')}]. The two modules have drifted.`
        );
      }
      excluded[view.reason]++;
      continue;
    }
    if (view.contradiction && view.contradiction.contradicted) contradictions++;

    // Mapped: the crosswalk must know this identifier...
    if (!crosswalk.espnByGsis.has(entry.gsisId)) {
      excluded['unmapped-gsis-id']++;
      excludedIds.unmappedGsis.push(entry.gsisId);
      continue;
    }
    // ...and it must reach a player who exists in today's database. A player
    // who has left the players table cannot re-enter (prereg 4.1); this is a
    // NAMED LIMITATION, counted per week, not a silent filter.
    const playerId = playerIdByGsis.get(entry.gsisId);
    if (playerId === undefined) {
      excluded['absent-from-players-table']++;
      excludedIds.absentFromPlayers.push(entry.gsisId);
      continue;
    }

    members.push({
      season: Number(season),
      week: Number(week),
      gsisId: entry.gsisId,
      playerId,
      position: view.position,
      team: view.team,
      teamKey: view.teamKey,
      injuryStatus: view.injuryStatus,
      // A bye player stays IN the cohort and IN rosters, and is excluded from
      // POINT-ACCURACY scoring only (prereg 4.1). That is what exercises the
      // deployed-policy wrapper's bye handling instead of hiding it.
      onBye: byeKeys.has(view.teamKey),
      isDefense: false,
      contradiction: view.contradiction,
    });
  }

  // One synthesized DEF pseudo-player per team-week, appended after the human
  // players so member order is deterministic.
  //
  // A DEF carries its DATABASE identity even though it is synthesized. It has
  // no GSIS id - it is not a person - but production's `players` table holds a
  // real row for each defence, and the deployed-policy wrapper orders
  // candidates by the captured `(name, id)` collation rank of THAT row. Order a
  // DEF by its team key instead and its ties would resolve differently from
  // production's, which is exactly the kind of ordering difference the study
  // has to be able to rule out. `defensePlayerIdByTeamKey` supplies the link.
  for (const teamKey of [...new Set(defenseTeamKeys)].sort()) {
    const defensePlayerId = defensePlayerIdByTeamKey.get(teamKey);
    if (defensePlayerId === undefined) {
      throw new Error(
        `${label}: no database DEF player for team ${teamKey}. The deployed-policy wrapper orders ` +
        'candidates by the captured (name, id) rank of the real players row, so a synthesized ' +
        'defence without one could not be ordered the way production orders it.'
      );
    }
    members.push({
      season: Number(season),
      week: Number(week),
      gsisId: null,
      playerId: Number(defensePlayerId),
      position: 'DEF',
      team: teamKey,
      teamKey,
      injuryStatus: null,
      onBye: byeKeys.has(teamKey),
      isDefense: true,
      contradiction: null,
    });
  }

  members.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1
    : String(a.gsisId ?? a.teamKey) < String(b.gsisId ?? b.teamKey) ? -1
      : String(a.gsisId ?? a.teamKey) > String(b.gsisId ?? b.teamKey) ? 1 : 0));

  return {
    season: Number(season),
    week: Number(week),
    members,
    counts: {
      members: members.length,
      defenses: members.filter((m) => m.isDefense).length,
      onBye: members.filter((m) => m.onBye).length,
      excluded,
      excludedTotal: Object.values(excluded).reduce((a, b) => a + b, 0),
      // Reported, never used to exclude (prereg 4.1).
      contradictions,
    },
    excludedIds,
  };
}

// ---------------------------------------------------------------------------
// DEF synthesis
// ---------------------------------------------------------------------------

/**
 * Pure: the per-game defensive stat line for one team-week.
 *
 * THE AGGREGATE TRAP. `pointsAllowed` and `yardsAllowed` are PER-GAME TIER
 * inputs: the scoring rules price them through tier tables ("0 points allowed
 * scores 10, 1-6 scores 7, ..."), so a season TOTAL fed into the same field
 * scores as though the defence allowed 400 points in one afternoon. That is
 * why this function takes ONE team-week row and one game, and why it refuses a
 * row that looks like an aggregate. `scoring.hasTeamDefenseTiers` exists for
 * the same reason.
 *
 * `pointsAllowed` comes from the GAME's score (games.csv), not from the stat
 * file: it is the opponent's points, which is a property of the game.
 */
function synthesizeDefenseStats({ teamWeekRow, game, teamKey, normalizeTeamKey, label = 'DEF' }) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error(`${label}: synthesizeDefenseStats requires normalizeTeamKey to be injected`);
  }
  if (!game) return null;
  const homeKey = normalizeTeamKey(game.home_team);
  const awayKey = normalizeTeamKey(game.away_team);
  const isHome = homeKey === teamKey;
  if (!isHome && awayKey !== teamKey) {
    throw new Error(`${label}: team ${teamKey} does not play in game ${game.game_id}`);
  }
  // Counting stats: absent means the defence recorded none of it, which for a
  // SACK COUNT genuinely is zero. `countingNumber` is the one shape where the
  // zero-default is correct, and naming it makes that a visible decision.
  const num = (v, field) => countingNumber(v, { label: `${label}: ${field}` });

  /**
   * `pointsAllowed` MUST be present, because zero is a meaningful measurement
   * of it rather than the absence of one. It is a per-game TIER input: zero
   * points allowed is the top defensive tier and scores the maximum. A blank
   * score in `games.csv` - and the pinned file demonstrably carries some -
   * would otherwise synthesize a shutout, the single most flattering possible
   * error, and it would happen HERE, one function upstream of
   * `assertPerGameDefenseStats`. That guard would then inspect a clean `0` and
   * pass it: the damage is done by the conversion, not by the check.
   */
  // Two DIFFERENT failures, and the messages stay distinct because the fixes
  // are different: a blank cell is a data gap, junk is a parse problem.
  const rawPointsAllowed = isHome ? game.away_score : game.home_score;
  if (isMissing(rawPointsAllowed)) {
    throw new Error(
      `${label}: pointsAllowed is ${JSON.stringify(rawPointsAllowed)} for game ${game.game_id}. ` +
      'It is a per-game tier input, so a blank cannot be read as 0 - that would synthesize a ' +
      'shutout, the top defensive tier, out of a missing score.'
    );
  }
  const pointsAllowed = Number(rawPointsAllowed);
  if (!Number.isFinite(pointsAllowed)) {
    throw new Error(`${label}: pointsAllowed is ${JSON.stringify(rawPointsAllowed)}, not a number`);
  }
  const row = teamWeekRow || {};
  return {
    pointsAllowed,
    // Yards the opponent gained, from the OPPONENT's team-week row when the
    // caller supplied it. Absent means absent, never zero-as-a-measurement -
    // and `null` is absent just as much as `undefined` is. A CSV parse yields
    // null far more often than it yields undefined, so checking only the
    // latter would have left the ordinary case falling through to 0 and
    // contradicted this very comment.
    yardsAllowed: optionalNumber(row.opponentYards, { label: `${label}: yardsAllowed` }),
    defSacks: num(row.def_sacks, 'defSacks'),
    defInterceptions: num(row.def_interceptions, 'defInterceptions'),
    defFumbleRecoveries: num(row.def_fumbles_forced, 'defFumbleRecoveries'),
    defTouchdowns: num(row.def_tds, 'defTouchdowns'),
    defSafeties: num(row.def_safeties, 'defSafeties'),
  };
}

/**
 * Fail loud if a stats object looks like a season aggregate rather than one
 * game. Mirrors the reasoning behind `scoring.hasTeamDefenseTiers`: the tier
 * fields are only meaningful per game.
 *
 * The threshold is deliberately generous - no NFL defence has ever allowed 100
 * points in a single game - so this fires only on something that is obviously
 * a total, never on a real blowout.
 */
const MAX_PLAUSIBLE_POINTS_ALLOWED_PER_GAME = 100;

function assertPerGameDefenseStats(stats, { label = 'DEF' } = {}) {
  if (!stats || typeof stats !== 'object') throw new Error(`${label}: no defensive stats`);
  // `requiredNumber` rejects missing explicitly, because `Number(null)` is 0
  // and a bare finite check would turn missing evidence into a measured
  // shutout - the most flattering possible error for a defence.
  let points;
  try {
    points = requiredNumber(stats.pointsAllowed, { label: `${label}: pointsAllowed` });
  } catch (err) {
    throw new Error(`${label}: pointsAllowed is ${JSON.stringify(stats.pointsAllowed)}, not a number`);
  }
  if (points < 0 || points > MAX_PLAUSIBLE_POINTS_ALLOWED_PER_GAME) {
    throw new Error(
      `${label}: pointsAllowed is ${points}, which is not a single game's total. ` +
      'pointsAllowed and yardsAllowed are PER-GAME tier inputs; scoring a season aggregate ' +
      'through the tier table would price it as one catastrophic afternoon.'
    );
  }
  return true;
}

// ---------------------------------------------------------------------------
// Outcome truth
// ---------------------------------------------------------------------------

/**
 * Pure: the three-way outcome reconciliation of preregistration 4.3.
 *
 * `external` is the pinned source's points (or null when the player-week is
 * absent from it). `secondaryPresent` says whether the OTHER pinned stat source
 * carried the row. `db` is production's stored value, used ONLY as a QA check.
 *
 * The four outcomes, in the order the rules apply:
 *
 *   1. Present in both pinned sources with consistent attribution -> the
 *      external value is the actual. A DB disagreement is RECORDED and changes
 *      nothing.
 *   2. Absent from BOTH -> actual `0`. "He was not in the stat files" means he
 *      recorded no fantasy points, which is a measurement, not a gap.
 *   3. Present in one source and not the other -> AMBIGUOUS. Excluded by
 *      preregistered rule and counted, with a labelled sensitivity that
 *      includes it.
 *   4. Contradictory team attribution -> AMBIGUOUS, same treatment.
 */
function resolveOutcome({
  externalPoints = null,
  presentInPrimary = false,
  presentInSecondary = false,
  teamContradiction = false,
  dbPoints = null,
  label = 'outcome',
}) {
  if (teamContradiction) {
    return {
      status: 'excluded',
      reason: 'ambiguous-team-contradiction',
      actual: null,
      dbAgrees: null,
    };
  }
  if (presentInPrimary !== presentInSecondary) {
    return {
      status: 'excluded',
      reason: 'ambiguous-one-source-only',
      actual: null,
      dbAgrees: null,
    };
  }
  if (!presentInPrimary && !presentInSecondary) {
    // Absence from BOTH is a measured zero, and the DB is not consulted to
    // overturn it - it is a QA check, never the source of truth.
    return {
      status: 'zero-recorded',
      reason: null,
      actual: 0,
      dbAgrees: dbPoints === null ? null : roundTo10(dbPoints) === 0,
    };
  }
  // Same trap as in `assertPerGameDefenseStats`: `Number(null)` is 0, so a
  // bare finite check would turn "the sources have him but carry no points"
  // into a scored zero - indistinguishable from a real zero-point game, and
  // wrong in the direction that quietly inflates every arm's accuracy on him.
  let actual;
  try {
    actual = requiredNumber(externalPoints, { label: `${label}: externalPoints` });
  } catch (err) {
    throw new Error(`${label}: present in both sources but the external points are ${JSON.stringify(externalPoints)}`);
  }
  return {
    status: 'scored',
    reason: null,
    actual,
    // QA ONLY. A false here is a finding for the report, not a correction.
    dbAgrees: dbPoints === null ? null : roundTo10(dbPoints) === roundTo10(actual),
  };
}

/** Numeric ties are decided at 10 decimal places (prereg 6.6). See lib/numbers. */
const roundTo10 = roundToTie;

/** Tally many outcomes for the report. */
function outcomeTally(outcomes) {
  const tally = {
    scored: 0,
    zeroRecorded: 0,
    excluded: emptyTally(OUTCOME_EXCLUSION_REASONS),
    dbDisagreements: 0,
    dbUnchecked: 0,
  };
  for (const outcome of outcomes || []) {
    if (outcome.status === 'scored') tally.scored++;
    else if (outcome.status === 'zero-recorded') tally.zeroRecorded++;
    else tally.excluded[outcome.reason]++;
    if (outcome.dbAgrees === false) tally.dbDisagreements++;
    if (outcome.dbAgrees === null) tally.dbUnchecked++;
  }
  return tally;
}

// ---------------------------------------------------------------------------
// The 2026 quarantine
// ---------------------------------------------------------------------------

/**
 * Throw on any season at or after the holdout boundary.
 *
 * The plan requires this in the cohort builder specifically, and on every
 * persisted evaluation row, because 2026 is an untouched prospective holdout: a
 * single 2026 player-week reaching a metric spends it silently.
 */
function assertNotQuarantined(season, { label = 'cohort' } = {}) {
  const value = Number(season);
  if (!Number.isFinite(value)) {
    throw new Error(`${label}: season ${JSON.stringify(season)} is not a number, so the quarantine cannot be checked`);
  }
  if (value >= QUARANTINE_FROM_SEASON) {
    throw new Error(
      `${label}: season ${value} is at or after the quarantine boundary ${QUARANTINE_FROM_SEASON}. ` +
      '2026 is an untouched prospective holdout and is not part of this study in any form.'
    );
  }
  return true;
}

/** Every persisted evaluation row goes through here before it is written. */
function assertEvaluationRows(rows, { label = 'evaluation rows' } = {}) {
  if (!Array.isArray(rows)) throw new Error(`${label}: expected an array of rows`);
  rows.forEach((row, i) => assertNotQuarantined(row && row.season, { label: `${label}[${i}]` }));
  return true;
}

module.exports = {
  GSIS_ID,
  EXCLUSION_REASONS,
  OUTCOME_EXCLUSION_REASONS,
  FANTASY_POSITIONS,
  FANTASY_ROSTER_POSITIONS,
  MAX_PLAUSIBLE_POINTS_ALLOWED_PER_GAME,
  buildCrosswalk,
  buildGsisByPlayerId,
  buildDefensePlayerIndex,
  buildCohort,
  synthesizeDefenseStats,
  assertPerGameDefenseStats,
  resolveOutcome,
  roundTo10,
  outcomeTally,
  assertNotQuarantined,
  assertEvaluationRows,
};
