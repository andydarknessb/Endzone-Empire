'use strict';

/**
 * The reconstruction overlay, as pure functions.
 *
 * This is where "what did this player-week actually look like" is decided, and
 * every rule in it comes from the sealed preregistration rather than from
 * convenience. Four of them carry most of the weight:
 *
 * 1. **The roster file is the authority for a player's week team and week
 *    position** (prereg 4.1). Today's `players.nfl_team` describes where he is
 *    NOW, which for a traded player is the wrong team for half the season, and
 *    resolving a September game through a November roster is exactly the
 *    "today's-DB poisoning" this rebuild exists to remove.
 *
 * 2. **A roster-versus-`gameTeam` contradiction is REPORTED, never used to
 *    exclude** (prereg 4.1). Two sources disagreeing about which team a player
 *    was on is information about the sources, not evidence about the player,
 *    and dropping the row would quietly shrink the cohort in a way correlated
 *    with mid-season movement. So `reconcileTeam` returns a contradiction flag
 *    and a count; nothing in this file filters on it.
 *
 * 3. **The primary injury policy is `injury_status = null` for every
 *    player-week** (prereg 4.2), because 2025 has no `date_modified` and so
 *    admits no honest as-of view, and 2024 is matched to it for symmetry. The
 *    sensitivities are labelled and non-selecting. Sensitivity S1 fails CLOSED
 *    when the timestamp column is absent or two surviving revisions tie on it
 *    (prereg 3.4) - it never picks one.
 *
 * 4. **Reserve-roster status is the ONLY IR-equivalent signal** (prereg 3.1,
 *    4.2 S3). No injury report in either season carries `IR`, so mapping a
 *    report to it would invent a signal that does not exist in the data.
 *
 * Pure throughout: no clock, no filesystem, no database, no network. Callers
 * hand in parsed source rows and get plain objects back.
 */

const {
  normalizeSourceField,
  classifyRosterStatus,
  mapInjuryReportStatus,
  isFantasyRosterPosition,
  ACTIVE_ROSTER_STATUSES,
  RESERVE_ROSTER_STATUSES,
} = require('./mappings');

/** The injury policies the preregistration defines. `primary` is the only one that selects. */
const INJURY_POLICIES = Object.freeze({
  PRIMARY: 'primary',
  S1_AS_OF_2024: 's1-as-of-2024',
  S2_FINAL_2025: 's2-final-2025',
  S3_RESERVE_AS_IR: 's3-reserve-as-ir',
});
const INJURY_POLICY_NAMES = Object.freeze(Object.values(INJURY_POLICIES));

/** The app's complete `injury_status` vocabulary (projectionModel.availabilityFor). */
const APP_INJURY_STATUSES = Object.freeze([null, 'Q', 'D', 'O', 'IR']);

/** Regular-season game type in the nflverse sources. */
const REG = 'REG';

function playerWeekKey(season, week, gsisId) {
  return `${Number(season)}:${Number(week)}:${gsisId}`;
}

// ---------------------------------------------------------------------------
// Per-week team and position, from the roster file
// ---------------------------------------------------------------------------

/**
 * Pure: index the weekly roster rows by (season, week, gsis_id).
 *
 * Blank-`gsis_id` rows are skipped and COUNTED, never silently dropped: the
 * preregistration records 7 of them in 2024 and 29 in 2025, and the published
 * report has to state the number. A duplicate player-week is a hard error - the
 * Phase-0 inspection proved there are none, so one appearing means the source
 * is not what was pinned, and picking a winner would be inventing an answer.
 */
function buildRosterIndex(rosterRows, { gameType = REG, label = 'roster' } = {}) {
  const byPlayerWeek = new Map();
  const teamsByWeek = new Map();
  let blankGsisId = 0;
  let skippedGameType = 0;

  for (const row of rosterRows || []) {
    if (normalizeSourceField(row.game_type) !== gameType) { skippedGameType++; continue; }
    const gsisId = normalizeSourceField(row.gsis_id);
    if (gsisId === '') { blankGsisId++; continue; }
    const season = Number(row.season);
    const week = Number(row.week);
    if (!Number.isInteger(season) || !Number.isInteger(week)) {
      throw new Error(`${label}: roster row for ${gsisId} has season ${row.season} week ${row.week}`);
    }
    const key = playerWeekKey(season, week, gsisId);
    if (byPlayerWeek.has(key)) {
      throw new Error(
        `${label}: duplicate roster player-week ${key}. The pinned sources have none, so this ` +
        'source is not what was pinned; choosing between the two rows would be inventing an answer.'
      );
    }
    const status = normalizeSourceField(row.status);
    const position = normalizeSourceField(row.position);
    const entry = {
      season,
      week,
      gsisId,
      team: normalizeSourceField(row.team),
      position,
      status,
      // Fail-closed on an unseen code: a source revision that adds one is a
      // plan amendment, never a default.
      statusClass: classifyRosterStatus(status),
      fantasyPosition: position !== '' && isFantasyRosterPosition(position) ? position : null,
      fullName: normalizeSourceField(row.full_name),
    };
    byPlayerWeek.set(key, entry);
    const weekKey = `${season}:${week}`;
    if (!teamsByWeek.has(weekKey)) teamsByWeek.set(weekKey, new Set());
    teamsByWeek.get(weekKey).add(entry.team);
  }

  return { byPlayerWeek, teamsByWeek, blankGsisId, skippedGameType };
}

/**
 * Pure: the roster row for one player-week, or null.
 *
 * Null means "this player has no reconstructed position for this week", which
 * the primary cohort treats as an exclusion that is COUNTED (prereg 4.1: no
 * today's-position fallback). It deliberately does not fall back to an adjacent
 * week: a player absent from week 9's roster was not on a roster in week 9.
 */
function rosterEntryFor(index, { season, week, gsisId }) {
  if (!index || !index.byPlayerWeek) return null;
  return index.byPlayerWeek.get(playerWeekKey(season, week, gsisId)) || null;
}

/**
 * Pure: is this player-week in the primary cohort's active class?
 *
 * `ACT` and `INA` both count (prereg 3.1). Keeping only players who dressed
 * would be the survivorship cohort the rebuild exists to eliminate: a manager
 * holding an inactive player faces a real start/sit decision, and under the
 * primary injury policy the model has to eat the zero.
 */
function isActiveClass(entry) {
  return !!entry && entry.statusClass === 'active';
}

/** Pure: is this the reserve class - the only IR-equivalent signal either season has? */
function isReserveClass(entry) {
  return !!entry && entry.statusClass === 'reserve';
}

// ---------------------------------------------------------------------------
// Trades: a player's team CHANGES within a season
// ---------------------------------------------------------------------------

/**
 * Pure: every week-to-week team change for one player in one season.
 *
 * This is what makes "per-week team" more than a phrase. A traded player's
 * September games belong to his old team's schedule and his November games to
 * his new one; resolving both through today's team gives the wrong opponent for
 * half of them, and `versusOpponent` can reach its two-meeting floor on the
 * strength of that error (plan rev 11 verified it).
 */
function teamTimelineFor(index, { season, gsisId, normalizeTeamKey }) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error('teamTimelineFor requires the production normalizeTeamKey to be injected');
  }
  const weeks = [];
  for (const entry of index.byPlayerWeek.values()) {
    if (entry.season !== Number(season) || entry.gsisId !== gsisId) continue;
    weeks.push(entry);
  }
  weeks.sort((a, b) => a.week - b.week);
  const changes = [];
  let previous = null;
  for (const entry of weeks) {
    const key = normalizeTeamKey(entry.team);
    if (previous !== null && key !== previous) {
      changes.push({ week: entry.week, from: previous, to: key });
    }
    previous = key;
  }
  return {
    weeks: weeks.map((e) => ({ week: e.week, team: e.team, teamKey: normalizeTeamKey(e.team) })),
    changes,
    traded: changes.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Contradictions: reported, never used to exclude
// ---------------------------------------------------------------------------

/**
 * Pure: reconcile the roster's team against the stat row's `gameTeam`.
 *
 * The roster wins, always. The return value carries `contradicted` so the
 * caller can COUNT it for the published report; no caller may filter on it
 * (prereg 4.1). Both sides fold through the production normalization first, or
 * `WAS` versus `WSH` would read as thousands of contradictions that are only a
 * spelling difference.
 *
 * A stat row with NO `gameTeam` is not a contradiction - it is an unenriched
 * row, and the preregistration treats missing as missing.
 */
function reconcileTeam({ rosterTeam, statsGameTeam, normalizeTeamKey }) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error('reconcileTeam requires the production normalizeTeamKey to be injected');
  }
  const rosterKey = rosterTeam ? normalizeTeamKey(rosterTeam) : null;
  const statsRaw = normalizeSourceField(statsGameTeam);
  const statsKey = statsRaw === '' ? null : normalizeTeamKey(statsRaw);
  const contradicted = !!(rosterKey && statsKey && rosterKey !== statsKey);
  return {
    // The AUTHORITY. Never the stats key, even when they disagree.
    teamKey: rosterKey,
    statsTeamKey: statsKey,
    contradicted,
    // Absent enrichment is not disagreement.
    unattributed: rosterKey !== null && statsKey === null,
  };
}

/** Pure: tally contradictions across many reconciliations, for the report. */
function contradictionTally(reconciliations) {
  let compared = 0;
  let contradicted = 0;
  let unattributed = 0;
  for (const r of reconciliations || []) {
    if (r.statsTeamKey !== null) compared++;
    if (r.contradicted) contradicted++;
    if (r.unattributed) unattributed++;
  }
  return { compared, contradicted, unattributed };
}

// ---------------------------------------------------------------------------
// The injury policy
// ---------------------------------------------------------------------------

/**
 * Pure: index injury rows by player-week, keeping ALL revisions of each.
 *
 * Unlike the roster index, duplicates are expected here: the preregistration
 * records exactly two in 2024 (Week 15, successive revisions of one report) and
 * none in 2025. Which revision applies is a question only the as-of policy can
 * answer, so the index keeps them all and `resolveInjuryStatus` decides.
 */
function buildInjuryIndex(injuryRows, { gameType = REG, hasDateModified, label = 'injuries' } = {}) {
  if (typeof hasDateModified !== 'boolean') {
    throw new Error(`${label}: buildInjuryIndex needs to be told whether the file carries date_modified`);
  }
  const byPlayerWeek = new Map();
  for (const row of injuryRows || []) {
    if (normalizeSourceField(row.game_type) !== gameType) continue;
    const gsisId = normalizeSourceField(row.gsis_id);
    if (gsisId === '') continue;
    const key = playerWeekKey(row.season, row.week, gsisId);
    if (!byPlayerWeek.has(key)) byPlayerWeek.set(key, []);
    byPlayerWeek.get(key).push({
      season: Number(row.season),
      week: Number(row.week),
      gsisId,
      reportStatus: normalizeSourceField(row.report_status),
      dateModified: hasDateModified ? normalizeSourceField(row.date_modified) : null,
    });
  }
  return { byPlayerWeek, hasDateModified };
}

/**
 * Pure: the single injury revision that applied as of a cutoff (prereg 3.4).
 *
 * Keep only revisions at or before the week's earliest kickoff, then take the
 * one with the GREATEST `date_modified`. Two rules fail CLOSED rather than
 * guess: an absent `date_modified` column, and an exact tie between two
 * survivors. Both mean the data cannot say which report a manager would have
 * seen, and inventing an answer there is precisely the kind of silent repair
 * this harness exists to eliminate.
 */
function resolveAsOfRevision(revisions, { earliestKickoff, hasDateModified, label = 'injuries' }) {
  if (!hasDateModified) {
    throw new Error(
      `${label}: the as-of injury sensitivity needs date_modified and this file has none. ` +
      'Preregistration section 3.4 fails closed here rather than falling back to a final status, ' +
      'which would be a leak dressed up as an as-of view.'
    );
  }
  if (!earliestKickoff) {
    throw new Error(`${label}: the as-of injury sensitivity needs the week's earliest kickoff`);
  }
  const cutoff = new Date(earliestKickoff).getTime();
  if (!Number.isFinite(cutoff)) {
    throw new Error(`${label}: earliest kickoff ${JSON.stringify(earliestKickoff)} is not a date`);
  }
  const timed = [];
  for (const revision of revisions) {
    if (revision.dateModified === '' || revision.dateModified == null) {
      throw new Error(
        `${label}: revision for ${playerWeekKey(revision.season, revision.week, revision.gsisId)} ` +
        'has a blank date_modified, so it cannot be placed before or after kickoff'
      );
    }
    const at = new Date(revision.dateModified).getTime();
    if (!Number.isFinite(at)) {
      throw new Error(`${label}: date_modified ${JSON.stringify(revision.dateModified)} is not a date`);
    }
    timed.push({ revision, at });
  }
  const surviving = timed.filter((t) => t.at <= cutoff);
  if (surviving.length === 0) return null;
  const latest = Math.max(...surviving.map((t) => t.at));
  const winners = surviving.filter((t) => t.at === latest);
  if (winners.length > 1) {
    const key = playerWeekKey(winners[0].revision.season, winners[0].revision.week, winners[0].revision.gsisId);
    throw new Error(
      `${label}: ${winners.length} injury revisions for ${key} tie exactly on date_modified ` +
      `(${winners[0].revision.dateModified}). Preregistration section 3.4 fails closed on a tie.`
    );
  }
  return winners[0].revision;
}

/**
 * Pure: the `injury_status` one player-week gets under a named policy.
 *
 * Returns a value from the app's own vocabulary `{null, Q, D, O, IR}` and
 * nothing else, so a caller can hand it straight to the players row the
 * snapshot client serves.
 */
function resolveInjuryStatus({
  policy,
  injuryIndex = null,
  rosterEntry = null,
  season,
  week,
  gsisId,
  earliestKickoff = null,
  label = 'injuries',
}) {
  if (!INJURY_POLICY_NAMES.includes(policy)) {
    throw new Error(
      `unknown injury policy ${JSON.stringify(policy)} - the preregistration defines ` +
      `[${INJURY_POLICY_NAMES.join(', ')}]`
    );
  }

  // PRIMARY: null for every player-week, in BOTH seasons (prereg 4.2). Stated
  // plainly in the preregistration and worth restating here: the primary regret
  // estimand exercises only bye availability. It does NOT test O/IR filtering.
  if (policy === INJURY_POLICIES.PRIMARY) return null;

  // S3: the reserve roster status IS the IR-equivalent signal, and the only one
  // either season has. It reads no injury report at all.
  if (policy === INJURY_POLICIES.S3_RESERVE_AS_IR) {
    return isReserveClass(rosterEntry) ? 'IR' : null;
  }

  if (!injuryIndex) throw new Error(`${label}: policy ${policy} needs an injury index`);
  const revisions = injuryIndex.byPlayerWeek.get(playerWeekKey(season, week, gsisId)) || [];
  if (revisions.length === 0) return null;

  if (policy === INJURY_POLICIES.S1_AS_OF_2024) {
    const revision = resolveAsOfRevision(revisions, {
      earliestKickoff,
      hasDateModified: injuryIndex.hasDateModified,
      label,
    });
    return revision ? mapInjuryReportStatus(revision.reportStatus) : null;
  }

  // S2: final report statuses, explicitly leak-prone - the file's statuses are
  // terminal revisions with no timestamp to cut at, so this sensitivity is
  // labelled and can never select.
  if (revisions.length > 1) {
    throw new Error(
      `${label}: ${revisions.length} revisions for ${playerWeekKey(season, week, gsisId)} and no ` +
      'way to order them; the final-status sensitivity assumes one row per player-week'
    );
  }
  return mapInjuryReportStatus(revisions[0].reportStatus);
}

// ---------------------------------------------------------------------------
// The composed view
// ---------------------------------------------------------------------------

/**
 * Pure: the reconstructed view of one player-week - the team, position and
 * injury status the snapshot client should serve for it.
 *
 * `null` for `rosterEntry` produces a view marked `inCohort: false` with a
 * reason, rather than a guess. Every exclusion this produces is countable,
 * which is what the published report needs.
 */
function reconstructPlayerWeek({
  rosterIndex,
  injuryIndex = null,
  policy = INJURY_POLICIES.PRIMARY,
  season,
  week,
  gsisId,
  earliestKickoff = null,
  normalizeTeamKey,
  statsGameTeam = null,
}) {
  if (typeof normalizeTeamKey !== 'function') {
    throw new Error('reconstructPlayerWeek requires the production normalizeTeamKey to be injected');
  }
  const entry = rosterEntryFor(rosterIndex, { season, week, gsisId });
  if (!entry) {
    return {
      inCohort: false,
      reason: 'no-roster-row',
      season: Number(season),
      week: Number(week),
      gsisId,
      team: null,
      teamKey: null,
      position: null,
      injuryStatus: null,
      statusClass: null,
      contradiction: null,
    };
  }
  const reconciliation = reconcileTeam({
    rosterTeam: entry.team, statsGameTeam, normalizeTeamKey,
  });
  const injuryStatus = resolveInjuryStatus({
    policy, injuryIndex, rosterEntry: entry, season, week, gsisId, earliestKickoff,
  });
  if (!APP_INJURY_STATUSES.includes(injuryStatus)) {
    throw new Error(`injury policy ${policy} produced ${JSON.stringify(injuryStatus)}, which is not an app status`);
  }
  return {
    // Cohort membership: active class AND a fantasy position. Both are
    // preregistered; neither falls back to today's players table.
    inCohort: isActiveClass(entry) && entry.fantasyPosition !== null,
    reason: !isActiveClass(entry)
      ? `status-class-${entry.statusClass}`
      : (entry.fantasyPosition === null ? 'no-fantasy-position' : null),
    season: entry.season,
    week: entry.week,
    gsisId,
    team: entry.team,
    teamKey: reconciliation.teamKey,
    position: entry.fantasyPosition,
    rosterPosition: entry.position,
    injuryStatus,
    statusClass: entry.statusClass,
    // Carried, counted, and never used to exclude.
    contradiction: reconciliation,
  };
}

module.exports = {
  INJURY_POLICIES,
  INJURY_POLICY_NAMES,
  APP_INJURY_STATUSES,
  ACTIVE_ROSTER_STATUSES,
  RESERVE_ROSTER_STATUSES,
  REG,
  playerWeekKey,
  buildRosterIndex,
  rosterEntryFor,
  isActiveClass,
  isReserveClass,
  teamTimelineFor,
  reconcileTeam,
  contradictionTally,
  buildInjuryIndex,
  resolveAsOfRevision,
  resolveInjuryStatus,
  reconstructPlayerWeek,
};
