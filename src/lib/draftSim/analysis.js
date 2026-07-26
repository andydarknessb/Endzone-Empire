/**
 * Post-draft report for the Draft Simulator: per-pick market value, an A–F
 * grade against the CPU field, position balance, bye stacking, and plain-English
 * roster-construction critiques.
 *
 * SYNC OBLIGATION (repo convention — see src/lib/positionCapsFeasibility.js).
 * These are hand-mirrored from pure server functions so a mock draft is graded
 * by exactly the same rules a real league draft is:
 *   - `draftPickValue`, `gradeTeams`, `gradeDraftValues` mirror
 *     server/services/draftgrade.service.js (lines ~34, ~55, ~71), including the
 *     [1.0, 0.33, -0.33, -1.0] z-score thresholds, the stddev-0 => 'B' rule, the
 *     id tie-break, and the `rosterValue = optimal + 0.25 * bench` weighting.
 *   - `optimalLineup` mirrors server/services/lineup.service.js (~line 363):
 *     most-restrictive-slot-first greedy fill.
 * If any of those change on the server, change them here.
 */
import {
  templateFor, slotEligible, expandEligibility, POSITION_GROUPS,
} from './templates';
import { rosterFor, roundOfPick } from './engine';
import { positionGroupKey, slotCapacityFor, benchToleranceFor } from './cpuBrain';

function round2(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Mirrored server primitives
// ---------------------------------------------------------------------------

const GRADE_THRESHOLDS = [
  { min: 1.0, grade: 'A' },
  { min: 0.33, grade: 'B' },
  { min: -0.33, grade: 'C' },
  { min: -1.0, grade: 'D' },
  { min: -Infinity, grade: 'F' },
];

/** Mirror of draftgrade.service.js gradeTeams. */
export function gradeTeams(teamValues) {
  if (teamValues.length === 0) return [];
  const values = teamValues.map((t) => t.rosterValue);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);

  const rows = teamValues.map((t) => {
    const z = stddev === 0 ? null : (t.rosterValue - mean) / stddev;
    const grade = z === null ? 'B' : GRADE_THRESHOLDS.find((g) => z >= g.min).grade;
    return { ...t, rosterValue: Math.round(t.rosterValue * 100) / 100, grade };
  });
  rows.sort((a, b) => b.rosterValue - a.rosterValue || a.teamId - b.teamId);
  return rows.map((row, i) => ({ ...row, rank: i + 1 }));
}

/** Mirror of draftgrade.service.js draftPickValue. */
export function draftPickValue({ pickNumber, marketAdp }) {
  const actualPick = Number(pickNumber);
  const parsedAdp = Number(marketAdp);
  const hasMarketAdp = Number.isFinite(parsedAdp) && parsedAdp > 0;
  const safeAdp = hasMarketAdp ? parsedAdp : actualPick;
  return {
    marketAdp: round2(safeAdp),
    draftValueScore: round2(safeAdp - actualPick),
    adpFallback: !hasMarketAdp,
  };
}

/** Mirror of draftgrade.service.js gradeDraftValues. */
export function gradeDraftValues(teamValues) {
  const normalized = teamValues.map((team) => ({
    ...team,
    draftValueScore: round2(team.draftValueScore),
  }));
  const originalByTeam = new Map(normalized.map((team) => [team.teamId, team]));
  const graded = gradeTeams(normalized.map((team) => ({
    teamId: team.teamId,
    name: team.name,
    rosterValue: -team.draftValueScore,
  })));
  return graded.map(({ teamId, grade, rank }) => {
    const original = originalByTeam.get(teamId);
    return {
      ...original,
      rosterValue: round2(original.rosterValue),
      draftValueScore: round2(original.draftValueScore),
      grade,
      rank,
    };
  });
}

/** Mirror of lineup.service.js optimalLineup (greedy, most-restrictive slot first). */
export function optimalLineup(players, rosterSlots, pointsFor = new Map()) {
  const slots = rosterSlots
    .filter((s) => s.count > 0)
    .sort((a, b) => expandEligibility(a.eligiblePositions).size - expandEligibility(b.eligiblePositions).size);
  const available = [...players].sort(
    (a, b) => (Number(pointsFor.get(b.playerId)) || 0) - (Number(pointsFor.get(a.playerId)) || 0)
  );
  const taken = new Set();
  const starters = [];
  let total = 0;
  for (const { key: slot, count } of slots) {
    for (let i = 0; i < count; i++) {
      const pick = available.find(
        (p) => !taken.has(p.playerId) && slotEligible(slot, p.position, rosterSlots)
      );
      if (!pick) continue; // roster can't fill this slot — leave it empty
      taken.add(pick.playerId);
      const points = Number(pointsFor.get(pick.playerId)) || 0;
      starters.push({ playerId: pick.playerId, position: pick.position, slot, points });
      total += points;
    }
  }
  return { starters, total: Math.round(total * 100) / 100 };
}

// ---------------------------------------------------------------------------
// Sim-specific analysis
// ---------------------------------------------------------------------------

/**
 * How far off market a pick has to be, in that round, to read as a steal or a
 * reach. Scaled by round because ADP noise widens as the board thins — a
 * 10-pick swing in round 1 is a story, in round 12 it's rounding.
 */
export function stealReachThreshold(round) {
  return 6 + 1.5 * round;
}

/** Projected-points lookup for optimalLineup / bench math. */
export function pointsMap(state) {
  return new Map(state.players.map((p) => [p.playerId, Number(p.projectedPoints) || 0]));
}

/**
 * Per-pick market valuation for every pick in the draft. `label` is one of
 * 'steal' | 'reach' | 'value' | 'no-market'; players without market ADP (IDP)
 * are never called a steal or a reach, only labelled 'no-market'.
 */
export function pickValues(state) {
  const byId = new Map(state.players.map((p) => [p.playerId, p]));
  const teamById = new Map(state.teams.map((t) => [t.id, t]));
  return state.picks.map((pick) => {
    const player = byId.get(pick.playerId) || {};
    const round = roundOfPick(state, pick.pickNumber);
    const value = draftPickValue({ pickNumber: pick.pickNumber, marketAdp: player.adp });
    const threshold = stealReachThreshold(round);
    let label = 'value';
    if (value.adpFallback) label = 'no-market';
    else if (value.draftValueScore <= -threshold) label = 'steal';
    else if (value.draftValueScore >= threshold) label = 'reach';
    return {
      pickNumber: pick.pickNumber,
      round,
      teamId: pick.teamId,
      teamName: (teamById.get(pick.teamId) || {}).name || '',
      isUser: !!(teamById.get(pick.teamId) || {}).isUser,
      auto: !!pick.auto,
      playerId: pick.playerId,
      name: player.name || 'Unknown player',
      position: player.position || null,
      nflTeam: player.nflTeam || null,
      byeWeek: player.byeWeek ?? null,
      projectedPoints: player.projectedPoints ?? null,
      adp: player.adp ?? null,
      marketAdp: value.marketAdp,
      draftValueScore: value.draftValueScore,
      adpFallback: value.adpFallback,
      threshold: round2(threshold),
      label,
    };
  });
}

/**
 * Every team's roster value and cumulative market delta, graded A–F against
 * each other by the server's z-score matrix.
 */
export function overallGrade(state) {
  const template = templateFor(state.config.leagueType);
  const pointsFor = pointsMap(state);
  const valuesByTeam = new Map();
  for (const pick of pickValues(state)) {
    if (!valuesByTeam.has(pick.teamId)) valuesByTeam.set(pick.teamId, 0);
    valuesByTeam.set(pick.teamId, valuesByTeam.get(pick.teamId) + pick.draftValueScore);
  }

  const teamValues = state.teams.map((team) => {
    const roster = rosterFor(state, team.id);
    const optimal = optimalLineup(roster, template.slots, pointsFor);
    const starterIds = new Set(optimal.starters.map((s) => s.playerId));
    const benchValue = roster
      .filter((p) => !starterIds.has(p.playerId))
      .reduce((sum, p) => sum + (Number(pointsFor.get(p.playerId)) || 0), 0);
    return {
      teamId: team.id,
      name: team.name,
      isUser: !!team.isUser,
      starterPoints: optimal.total,
      benchPoints: round2(benchValue),
      rosterValue: optimal.total + 0.25 * benchValue,
      draftValueScore: round2(valuesByTeam.get(team.id) || 0),
    };
  });

  return gradeDraftValues(teamValues);
}

/** The canonical position keys a template can roster, in display order. */
export function balanceKeysFor(template) {
  const keys = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  for (const group of Object.keys(POSITION_GROUPS)) {
    if (template.slots.some((slot) => (slot.eligiblePositions || []).includes(group))) keys.push(group);
  }
  return keys;
}

/** A representative literal position code for a balance key ('DL' -> 'DL', 'RB' -> 'RB'). */
function sampleCodeFor(key) {
  return (POSITION_GROUPS[key] || [key])[0];
}

/**
 * Starting slots dedicated to exactly this position — the number you MUST
 * roster to field a legal lineup. Excludes FLEX/SFLX, which any of several
 * positions can cover.
 */
export function dedicatedStartersFor(template, key) {
  const code = sampleCodeFor(key);
  return template.slots
    .filter((slot) => (slot.eligiblePositions || []).length === 1
      && slotEligible(slot.key, code, template.slots))
    .reduce((sum, slot) => sum + slot.count, 0);
}

/**
 * Per-position counts against a sane window. `min` is the dedicated starting
 * requirement (you cannot field a lineup below it); `max` is starting capacity
 * plus the bench tolerance the CPU brain uses.
 */
export function positionBalance(state, teamId) {
  const template = templateFor(state.config.leagueType);
  const roster = rosterFor(state, teamId);
  return balanceKeysFor(template).map((key) => {
    const count = roster.filter((p) => positionGroupKey(p.position) === key).length;
    const min = dedicatedStartersFor(template, key);
    const max = slotCapacityFor(template, sampleCodeFor(key)) + benchToleranceFor(key);
    let status = 'ok';
    if (count < min) status = 'critical';
    else if (count > max) status = 'warn';
    return { position: key, count, min, max, status };
  });
}

/**
 * Bye-week concentration among the team's projected STARTERS (bench byes don't
 * cost you a week). Three starters on one bye is a warning, four is a hole.
 */
export function byeStacking(state, teamId) {
  const template = templateFor(state.config.leagueType);
  const pointsFor = pointsMap(state);
  const roster = rosterFor(state, teamId);
  const { starters } = optimalLineup(roster, template.slots, pointsFor);
  const byId = new Map(roster.map((p) => [p.playerId, p]));

  const byWeek = new Map();
  for (const starter of starters) {
    const week = (byId.get(starter.playerId) || {}).byeWeek;
    if (week == null) continue;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(byId.get(starter.playerId));
  }

  return [...byWeek.entries()]
    .filter(([, players]) => players.length >= 3)
    .map(([week, players]) => ({
      week: Number(week),
      count: players.length,
      names: players.map((p) => p.name),
      severity: players.length >= 4 ? 'critical' : 'warn',
    }))
    .sort((a, b) => b.count - a.count || a.week - b.week);
}

const SEVERITY_ORDER = { critical: 0, warn: 1, info: 2 };

/**
 * Plain-English roster-construction critiques. Every issue carries a concrete
 * `suggestion` — the point of the report is telling you what to do differently,
 * not just what went wrong.
 */
export function rosterConstruction(state, teamId) {
  const template = templateFor(state.config.leagueType);
  const pointsFor = pointsMap(state);
  const roster = rosterFor(state, teamId);
  const picks = pickValues(state).filter((p) => p.teamId === teamId);
  const issues = [];

  const kdefOpenRound = state.rounds - 2;
  const countOf = (key) => roster.filter((p) => positionGroupKey(p.position) === key).length;

  const earlyKicker = picks.find((p) => p.position === 'K' && p.round < kdefOpenRound);
  if (earlyKicker) {
    issues.push({
      id: 'early-kicker',
      severity: 'warn',
      title: `Kicker in round ${earlyKicker.round}`,
      detail: `${earlyKicker.name} came off the board at pick ${earlyKicker.pickNumber}, ${kdefOpenRound - earlyKicker.round} round(s) before kickers are worth a pick.`,
      suggestion: 'Kickers are close to interchangeable week to week — take one in the last two rounds and spend that pick on a starter or a high-upside bench bat.',
    });
  }

  const earlyDef = picks.find((p) => p.position === 'DEF' && p.round < kdefOpenRound);
  if (earlyDef) {
    issues.push({
      id: 'early-def',
      severity: 'warn',
      title: `Defense in round ${earlyDef.round}`,
      detail: `${earlyDef.name} at pick ${earlyDef.pickNumber} spends real draft capital on the most streamable position in fantasy.`,
      suggestion: 'Wait on team defense and stream the best weekly matchup instead — the difference between DEF1 and DEF12 is a fraction of a starting flex.',
    });
  }

  const earlyRounds = picks.filter((p) => p.round <= 6);
  const rbByRoundSix = earlyRounds.filter((p) => p.position === 'RB').length;
  if (earlyRounds.length >= 6 && rbByRoundSix < 2) {
    issues.push({
      id: 'late-rb',
      severity: 'warn',
      title: `Only ${rbByRoundSix} running back through six rounds`,
      detail: 'Running back is the thinnest position on the board — waiting this long usually means starting a committee back you did not want.',
      suggestion: 'Even a zero-RB build wants two backs by the end of round 6. Target the last starter-volume back before the tier breaks.',
    });
  }

  if (template.id !== 'superflex') {
    const earlyQb = picks.find((p) => p.position === 'QB' && p.round <= 2);
    if (earlyQb) {
      issues.push({
        id: 'early-qb',
        severity: 'info',
        title: `Quarterback in round ${earlyQb.round}`,
        detail: `${earlyQb.name} is a fine player, but in a one-quarterback league the gap between QB1 and QB10 is smaller than the gap between RB1 and RB25.`,
        suggestion: 'In a single-QB format, let quarterback come to you in the middle rounds and bank the early picks on running back and receiver.',
      });
    }
  }

  const { starters } = optimalLineup(roster, template.slots, pointsFor);
  const starterIds = new Set(starters.map((s) => s.playerId));
  const bench = roster.filter((p) => !starterIds.has(p.playerId));
  const thinPositions = ['RB', 'WR'].filter(
    (key) => countOf(key) > 0 && bench.filter((p) => positionGroupKey(p.position) === key).length === 0
  );
  if (thinPositions.length > 0) {
    issues.push({
      id: 'no-depth',
      severity: 'warn',
      title: `No bench depth at ${thinPositions.join(' or ')}`,
      detail: 'Every rostered player at that position is a starter, so one injury or bye leaves an empty slot in your lineup.',
      suggestion: 'Spend a late pick on a backup with standalone value behind a fragile starter — bye weeks alone guarantee you will need one.',
    });
  }

  // Deliberately measured against the DEDICATED TE slot, not TE-eligible FLEX
  // capacity: nobody drafts a third tight end intending to flex him.
  const teCount = countOf('TE');
  const teStarters = dedicatedStartersFor(template, 'TE');
  if (teStarters > 0 && teCount > teStarters + benchToleranceFor('TE')) {
    issues.push({
      id: 'te-overinvest',
      severity: 'info',
      title: `${teCount} tight ends rostered`,
      detail: `Only ${teStarters} starts at tight end in this format, so the extras occupy bench spots that could hold upside.`,
      suggestion: 'One starting tight end plus at most one backup is enough — spend the rest on running back or receiver lottery tickets.',
    });
  }

  for (const stack of byeStacking(state, teamId)) {
    issues.push({
      id: `bye-week-${stack.week}`,
      severity: stack.severity,
      title: `${stack.count} starters on bye in week ${stack.week}`,
      detail: `${stack.names.join(', ')} are all off that week.`,
      suggestion: 'Spread byes across the schedule when two players grade out the same — or plan a waiver move now for that week.',
    });
  }

  for (const row of positionBalance(state, teamId)) {
    if (row.status !== 'critical') continue;
    issues.push({
      id: `unfilled-${row.position}`,
      severity: 'critical',
      title: `Cannot field a starting ${row.position}`,
      detail: `You rostered ${row.count} but the lineup requires ${row.min}.`,
      suggestion: `Add a ${row.position} before week 1 — an empty starting slot scores zero every week.`,
    });
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/**
 * The user's bench strength against the CPU field. Mirrors the 0.25 x bench
 * weighting draftgrade.service.js applies to roster value, but reports the raw
 * z-score so the UI can say "top of the league" instead of a number.
 */
export function benchQuality(teamRows, userTeamId) {
  const mine = teamRows.find((t) => t.teamId === userTeamId);
  if (!mine) return null;
  const values = teamRows.map((t) => t.benchPoints);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  const z = stddev === 0 ? 0 : (mine.benchPoints - mean) / stddev;
  let label = 'about average';
  if (z >= 1) label = 'among the best in the league';
  else if (z >= 0.33) label = 'better than most';
  else if (z <= -1) label = 'the thinnest in the league';
  else if (z <= -0.33) label = 'thinner than most';
  return {
    benchPoints: round2(mine.benchPoints),
    leagueMean: round2(mean),
    stddev: round2(stddev),
    z: round2(z),
    label,
  };
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'];
const CRITICAL_GRADE_CAP = 'C';

/**
 * A roster that cannot field a legal starting lineup is not an A, whatever the
 * market math says — value hoarded at two positions games the z-score. Any
 * critical issue caps the letter at C; the raw market grade is kept alongside
 * so the report can say exactly why the letter came down.
 */
export function applyGradeCap(valueGrade, issues) {
  const criticalCount = issues.filter((issue) => issue.severity === 'critical').length;
  if (criticalCount === 0) return { grade: valueGrade, valueGrade, capped: false, criticalCount: 0 };
  const capped = GRADE_ORDER.indexOf(valueGrade) < GRADE_ORDER.indexOf(CRITICAL_GRADE_CAP);
  return {
    grade: capped ? CRITICAL_GRADE_CAP : valueGrade,
    valueGrade,
    capped,
    criticalCount,
  };
}

/**
 * The whole post-draft report for the user's team.
 * `{ grade, rank, teams[], picks[], positionBalance[], issues[], totals }`.
 */
export function analyzeDraft(state) {
  const user = state.teams.find((t) => t.isUser) || state.teams[0];
  const teams = overallGrade(state);
  const mine = teams.find((t) => t.teamId === user.id) || null;
  const allPicks = pickValues(state);
  const myPicks = allPicks.filter((p) => p.teamId === user.id);
  const issues = rosterConstruction(state, user.id);
  const graded = applyGradeCap(mine ? mine.grade : 'B', issues);

  return {
    grade: graded.grade,
    valueGrade: graded.valueGrade,
    gradeCapped: graded.capped,
    criticalCount: graded.criticalCount,
    rank: mine ? mine.rank : null,
    teamCount: teams.length,
    teams,
    picks: myPicks,
    allPicks,
    positionBalance: positionBalance(state, user.id),
    issues,
    totals: {
      steals: myPicks.filter((p) => p.label === 'steal').length,
      reaches: myPicks.filter((p) => p.label === 'reach').length,
      noMarket: myPicks.filter((p) => p.label === 'no-market').length,
      draftValueScore: mine ? mine.draftValueScore : 0,
      starterPoints: mine ? mine.starterPoints : 0,
      benchQuality: benchQuality(teams, user.id),
    },
  };
}
