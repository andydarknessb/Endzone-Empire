'use strict';

/**
 * Scores a week's Editorial calls (CONTEXT.md "Editorial call") against actual
 * points and against the engine's own pre-kickoff PPR read. Read-only: one
 * `BEGIN READ ONLY` transaction on DATABASE_URL, rolled back. Writes nothing.
 *
 *   node scripts/editorial/score-calls.js --calls <path> [--json]
 *   node scripts/editorial/score-calls.js --all [--json]
 *
 * Inputs the engine side reads:
 *  - Engine: the on-time (`NOT is_late`) `capture_kind = 'scheduled'` snapshot
 *    for the file's season/week under the PPR preset (`projection_snapshots` +
 *    `projection_snapshot_players`), point estimate via `pointEstimateFor`. A
 *    player with no child row is reported as missing; the live projection run
 *    is never consulted.
 *  - Actuals: `player_stats.stats` re-priced with `calculateFantasyPoints`
 *    under the PPR preset (never the stored `fantasy_points` column). No stat
 *    row scores 0.
 *  - Inactive = no Appearance: no stat row, or a stat line with every figure
 *    zero (`decision.service.madeAppearance`). The ledger carries no
 *    post-game active flag, so that is the only signal there is. Accepted
 *    gap: an active player with no snap and no stat reads as no Appearance,
 *    narrower than CONTEXT's Appearance.
 *
 * Positional finish = 1 + the count of players at that position with strictly
 * more actual points, over every `player_stats` row at the position that week
 * plus every ledger row at it (absent stats = 0). The engine is ranked among
 * the ledger rows at the position that the engine itself holds available
 * (`factors.availability.available !== false`, the `classifyProjectionEntry`
 * test): its call is START when its estimate ranks inside the position cutoff
 * among those rows, else SIT; a call player whose own row is unavailable
 * (IR, out, bye, no team, practice squad) is an engine SIT. In the ranking
 * rho the engine's order scores an unavailable row 0.
 *
 * Served (rebuilt): the Start verdict the app would have served at kickoff,
 * rebuilt read-only (nothing persists it; docs/editorial/README.md has the
 * rules and the known gaps). `--all` scores every week's calls file and prints
 * the season ledger.
 *
 * The rankings table carries a `blend` column: the capture's order with the editorial QB/TE ranks fed
 * through `expertConsensusBlend` (weight 0.5, ranks become points inside the ranked set). `--all` also
 * prints the preregistered editorial-feed test (#2524, weeks 8-18): docs/editorial/editorial-feed-preregistration.md.
 *
 * Calls flagged `"injury": true` turn on a Wed-Fri practice report or game
 * designation the Tuesday capture could not see; the summary reports the
 * paired hit rates split into injury-driven and method calls.
 */

const fs = require('fs');
const path = require('path');
const { spearman } = require('../backtest/lib/metrics');
const { binomialUpperTail } = require('../holdout/lib/inference');
const { expertConsensusBlend, MODEL_CONSTANTS } = require('../../server/services/projectionModel');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'];

// Preregistered in docs/editorial/editorial-feed-preregistration.md (#2524); these values must not change.
const EDITORIAL_FEED = Object.freeze({
  weight: 0.5, positions: Object.freeze(['QB', 'TE']), season: 2026, firstWeek: 8, lastWeek: 18, alpha: 0.10, minWeeks: 6,
});

/** Pure: 1-based rank of `points` in `values` (descending), ties share the best rank. */
function finishOf(points, values) {
  return 1 + values.filter((v) => v > points).length;
}

/**
 * Pure: does one call hit? `null` when voided. START/FLEX hit when the player
 * appeared and finished inside the cutoff; SIT/OUT hit when he finished
 * outside it or did not appear. A conditional "if active" call on a player
 * who did not appear is void, not a miss.
 */
function judge({ verdict, condition, finish, cutoff, appeared }) {
  if (condition === 'if active' && !appeared) return null;
  const inside = appeared && finish <= cutoff;
  return verdict === 'START' || verdict === 'FLEX' ? inside : !inside;
}

/**
 * Pure: `Map<playerId, blended estimate>` for the editorial feed: over the ranked players the feed
 * moves (in ledger, available, finite estimate, not in `injuryIds`) the r-th editorial rank gets the
 * r-th highest estimate in that set as expert points, blended at `weight`. Others are absent.
 * A repeated playerId counts once, at its best rank.
 */
function editorialBlend(ranking, ledger, injuryIds, weight) {
  const moved = [...ranking].sort((a, b) => a.rank - b.rank).filter((r, i, all) => {
    const l = ledger.get(r.playerId);
    return all.findIndex((x) => x.playerId === r.playerId) === i && l && !l.unavailable && Number.isFinite(l.estimate) && !injuryIds.has(r.playerId);
  });
  const points = moved.map((r) => ledger.get(r.playerId).estimate).sort((a, b) => b - a);
  return new Map(moved.map((r, i) => [r.playerId, expertConsensusBlend({
    value: ledger.get(r.playerId).estimate,
    expert: { points: points[i], source: 'editorial' },
    constants: { ...MODEL_CONSTANTS.expertConsensus, blendWeight: weight },
  }).value]));
}

/**
 * Pure: rho of the editorial order, the engine's order and the editorial-feed blend vs actual points,
 * over the players in both the ranking and the ledger (the same set).
 */
function rankingRho(ranking, ledger, actuals, injuryIds = new Set()) {
  const blend = editorialBlend(ranking, ledger, injuryIds, EDITORIAL_FEED.weight);
  const blendOrder = (r) => (ledger.get(r.playerId).unavailable ? 0 : blend.get(r.playerId) ?? ledger.get(r.playerId).estimate);
  const rows = ranking.filter((r) => ledger.has(r.playerId));
  const act = (r) => (actuals.get(r.playerId) || { points: 0 }).points;
  return {
    n: rows.length,
    missing: ranking.filter((r) => !ledger.has(r.playerId)).map((r) => r.name),
    editorialRho: spearman(rows.map((r) => -r.rank), rows.map(act)),
    engineRho: spearman(rows.map((r) => engineOrder(ledger.get(r.playerId))), rows.map(act)),
    blendedRho: spearman(rows.map(blendOrder), rows.map(act)),
    servedRho: rows.every((r) => ledger.get(r.playerId).served)
      ? spearman(rows.map((r) => servedOrder(ledger.get(r.playerId))), rows.map(act))
      : null,
  };
}

/** Pure: what the served verdict expects of a ledger row, 0 when it served the player unavailable. */
function servedOrder(l) {
  return l.served.outcome === 'unavailable' ? 0 : l.estimate;
}

/** Pure: what the engine expects of a ledger row, 0 when it holds the player unavailable. */
function engineOrder(l) {
  return l.unavailable ? 0 : l.estimate;
}

/**
 * Pure: the whole scoring. `ledger`: Map playerId -> { position, estimate, unavailable };
 * `actuals`: Map playerId -> { position, points, appeared }.
 */
function scoreCalls(file, ledger, actuals) {
  const cutoffs = file.cutoffs;
  const pool = {};
  for (const pos of POSITIONS) {
    pool[pos] = new Map();
    for (const [id, l] of ledger) if (l.position === pos) pool[pos].set(id, 0);
    for (const [id, a] of actuals) if (a.position === pos) pool[pos].set(id, a.points);
  }
  const engineEstimates = (pos) => [...ledger.values()]
    .filter((l) => l.position === pos && l.estimate != null && !l.unavailable).map((l) => l.estimate);

  const servedEstimates = (pos) => [...ledger.values()]
    .filter((l) => l.position === pos && l.estimate != null && l.served && l.served.outcome !== 'unavailable').map((l) => l.estimate);
  const withServed = [...ledger.values()].some((l) => l.served);

  const calls = file.calls.map((c) => {
    const a = actuals.get(c.playerId) || { points: 0, appeared: false };
    const cutoff = cutoffs[c.position];
    const finish = finishOf(a.points, [...pool[c.position].values()]);
    const editorialHit = judge({ ...c, finish, cutoff, appeared: a.appeared });
    const l = ledger.get(c.playerId);
    const engineMissing = !l || l.estimate == null;
    const engineUnavailable = !engineMissing && !!l.unavailable;
    const engineRank = engineMissing || engineUnavailable ? null : finishOf(l.estimate, engineEstimates(c.position));
    const engineCall = engineMissing ? null : (engineUnavailable || engineRank > cutoff ? 'SIT' : 'START');
    const engineHit = engineMissing || editorialHit === null
      ? null
      : judge({ verdict: engineCall, condition: null, finish, cutoff, appeared: a.appeared });
    // Served: unavailable and not_recommended never start; a recommendable player starts inside the cutoff
    // of the estimate ranking among the rows not served unavailable (the verdict moves, the number stands).
    const served = !engineMissing && l.served ? l.served : null;
    const servedRank = served && served.outcome === 'recommendable' ? finishOf(l.estimate, servedEstimates(c.position)) : null;
    const servedCall = served ? (servedRank !== null && servedRank <= cutoff ? 'START' : 'SIT') : null;
    const servedHit = servedCall === null || editorialHit === null
      ? null
      : judge({ verdict: servedCall, condition: null, finish, cutoff, appeared: a.appeared });
    return {
      id: c.id, name: c.name, position: c.position, verdict: c.verdict, condition: c.condition, injury: !!c.injury,
      actual: a.points, appeared: a.appeared, finish, editorialHit,
      engineEstimate: engineMissing ? null : l.estimate, engineUnavailable, engineRank, engineCall, engineHit,
      servedOutcome: served ? served.outcome : null, servedReason: served ? served.reason : null, servedRank, servedCall, servedHit,
    };
  });

  const counted = calls.filter((c) => c.editorialHit !== null);
  const paired = counted.filter((c) => c.engineHit !== null);
  const hits = (list, key) => list.filter((c) => c[key]).length;
  const split = (list) => ({
    n: list.length,
    editorialHits: hits(list, 'editorialHit'),
    engineHits: hits(list, 'engineHit'),
    ...(withServed ? { servedHits: hits(list, 'servedHit') } : {}),
  });
  const injuryIds = new Set(file.calls.filter((c) => c.injury === true).map((c) => c.playerId));
  const rankings = {};
  for (const pos of POSITIONS) {
    if (file.rankings[pos]) rankings[pos] = rankingRho(file.rankings[pos], ledger, actuals, injuryIds);
  }
  return {
    rankings,
    calls,
    summary: {
      calls: calls.length,
      void: calls.length - counted.length,
      engineMissing: calls.filter((c) => c.engineCall === null).map((c) => c.name),
      editorial: { n: counted.length, hits: hits(counted, 'editorialHit') },
      paired: split(paired),
      pairedMethod: split(paired.filter((c) => !c.injury)),
      pairedInjury: split(paired.filter((c) => c.injury)),
    },
  };
}

const GAME_DESIGNATIONS = { Q: 'Q', QUESTIONABLE: 'Q', D: 'D', DOUBTFUL: 'D', O: 'O', OUT: 'O' };

/**
 * Pure: the injury status the app would hold at kickoff. `snapshotStatus` is the
 * capture's frozen status; the latest observation (`reportStatus`, nflverse's
 * game designation) replaces it only when the snapshot status is null or a game
 * designation. A null report never changes it (nflverse fills `report_status` only on the
 * week's final report, so null earlier means not designated yet). Roster statuses (IR, suspended, ...) stand.
 */
function servedInjuryStatus(snapshotStatus, observationsAsOf) {
  const key = snapshotStatus == null ? null : String(snapshotStatus).toUpperCase();
  if (key !== null && !GAME_DESIGNATIONS[key]) return snapshotStatus;
  if (!observationsAsOf || observationsAsOf.length === 0) return snapshotStatus;
  const latest = observationsAsOf.reduce((a, b) => (new Date(b.observedAt) >= new Date(a.observedAt) ? b : a));
  if (latest.reportStatus == null) return snapshotStatus;
  return GAME_DESIGNATIONS[String(latest.reportStatus).toUpperCase()] || latest.reportStatus;
}

const ADVICE_LEAD_MS = 60 * 1000; // lineupOverride.service.js: the advice is read a minute before kickoff

/** Pure: the instant the served verdict is rebuilt for, a minute before kickoff and never in the future. */
function servedAsOf(kickoffAt, now) {
  const kickoff = kickoffAt == null ? NaN : new Date(kickoffAt).getTime();
  return new Date(Number.isFinite(kickoff) ? Math.min(kickoff - ADVICE_LEAD_MS, now.getTime()) : now.getTime());
}

/**
 * Pure: the Start verdict `{ outcome, reason, numberTrusted }` the Weekly projection read
 * (`startVerdictFor`) would give one snapshot row at `asOf`: a stored unavailable verdict
 * passes through, the rest is `unavailableFor` with the practice facts seen by then.
 */
function servedVerdictFor({ factors, injuryStatus, kickoffAt, observations, backup, asOf }) {
  const { unavailableFor, startVerdictOf } = require('../../server/services/unavailable');
  const { isPositionBaselineEntry } = require('../../server/services/projection.service');
  const stored = (factors && factors.availability) || {};
  if (stored.available === false) return startVerdictOf(stored);
  return startVerdictOf(unavailableFor({
    injuryStatus: servedInjuryStatus(injuryStatus, observations),
    positionBaseline: isPositionBaselineEntry({ factors }),
    backup,
    practice: { observations, kickoffAt },
    now: asOf,
  }));
}

/** Pure: the observations seen by `asOf` (one observed exactly at asOf counts). */
function observationsAsOf(observations, asOf) {
  return observations.filter((o) => new Date(o.observedAt) <= asOf);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Pure: the QB depth chart rows (`captured_date` as 'YYYY-MM-DD') a game's Backup check may
 * see as of `asOf`: charted on a UTC day strictly before the asOf day (the kickoff-day chart can
 * land after a 00:15Z kickoff) and within 3 days of it.
 */
function chartsBefore(chartRows, asOf) {
  const lo = dayOf(asOf.getTime() - 3 * DAY_MS);
  const hi = dayOf(asOf.getTime());
  return chartRows.filter((c) => c.captured_date >= lo && c.captured_date < hi);
}

/**
 * Pure: depth chart rows shaped for `backupQuarterbackIds`, with the team and injury status the
 * capture froze (`captured`: Map playerId -> { position, nfl_team, injury_status }), never
 * today's `players` row. A chart player with no QB capture row is left out.
 */
function captureChartRows(chartRows, captured) {
  return chartRows.filter((c) => (captured.get(c.player_id) || {}).position === 'QB')
    .map((c) => ({ ...c, nfl_team: captured.get(c.player_id).nfl_team, injury_status: captured.get(c.player_id).injury_status }));
}

const SUMMARY_LINES = ['paired', 'pairedMethod', 'pairedInjury'];

/**
 * Pure: season totals from per-week results `[{ week, summary, rankings }]` (scoreCalls output
 * plus the week): hits and n summed per line, and each position's rho as the n-weighted mean of
 * the weekly rhos (a week with no rho for a metric is left out of that mean; n is the total), plus the
 * preregistered `editorialFeed` test over `EDITORIAL_FEED`'s season and weeks (each result needs `season`).
 */
function seasonLedger(weekResults) {
  const totals = Object.fromEntries(SUMMARY_LINES.map((k) => [k, { n: 0, editorialHits: 0, engineHits: 0, servedHits: 0 }]));
  for (const w of weekResults) {
    for (const k of SUMMARY_LINES) for (const f of Object.keys(totals[k])) totals[k][f] += w.summary[k][f] || 0;
  }
  const rankings = {};
  for (const pos of POSITIONS) {
    const rows = weekResults.map((w) => w.rankings[pos]).filter(Boolean);
    if (rows.length === 0) continue;
    const mean = (key) => {
      const used = rows.filter((x) => x[key] != null && x.n > 0);
      const weight = used.reduce((t, x) => t + x.n, 0);
      return weight ? used.reduce((t, x) => t + x.n * x[key], 0) / weight : null;
    };
    rankings[pos] = {
      n: rows.reduce((t, x) => t + x.n, 0),
      editorialRho: mean('editorialRho'), engineRho: mean('engineRho'), blendedRho: mean('blendedRho'), servedRho: mean('servedRho'),
    };
  }
  const feed = EDITORIAL_FEED;
  const pw = weekResults.filter((w) => w.season === feed.season && w.week >= feed.firstWeek && w.week <= feed.lastWeek)
    .flatMap((w) => feed.positions.map((pos) => ({ week: w.week, ...w.rankings[pos] }))
      .filter((x) => x.n > 0 && x.blendedRho != null && x.engineRho != null));
  const pooled = (key) => (pw.length ? pw.reduce((t, x) => t + x.n * x[key], 0) / pw.reduce((t, x) => t + x.n, 0) : null);
  const favorable = pw.filter((x) => x.blendedRho > x.engineRho).length;
  const unfavorable = pw.filter((x) => x.blendedRho < x.engineRho).length;
  const judged = [...new Set(pw.map((x) => x.week))].sort((a, b) => a - b);
  const p = binomialUpperTail(favorable + unfavorable, favorable);
  const [blendedRho, engineRho] = [pooled('blendedRho'), pooled('engineRho')];
  const editorialFeed = {
    weeks: judged, positionWeeks: pw.length, favorable, unfavorable, ties: pw.length - favorable - unfavorable, p, blendedRho, engineRho,
    verdict: judged.length < feed.minWeeks ? 'unjudged' : blendedRho > engineRho && p <= feed.alpha ? 'pass' : 'fail',
  };
  const weeks = weekResults.map((w) => ({ week: w.week, ...Object.fromEntries(SUMMARY_LINES.map((k) => [k, w.summary[k]])) }));
  return { weeks, totals, rankings, editorialFeed };
}

/**
 * Thin DB loader: the on-time scheduled PPR capture, the served verdict rebuilt per ledger row
 * and the re-priced actuals for one week, plus whether any of the week's games are still to be
 * played (`gamesPending`: a kickoff later than 4 hours ago). The caller owns `pool` (opened once, ended once).
 */
async function load({ season, week }, pool) {
  const model = require('../../server/services/projectionModel');
  const { pointEstimateFor, backupQuarterbackIds } = require('../../server/services/projection.service');
  const { SCORING_PRESETS, calculateFantasyPoints } = require('../../server/services/scoringRules');
  const { madeAppearance } = require('../../server/services/decision.service');
  const rules = SCORING_PRESETS.ppr;
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const head = await client.query(
      `SELECT "id", "model_version", "captured_at", "capture_not_after"
       FROM "projection_snapshots"
       WHERE "season" = $1 AND "week" = $2 AND "scoring_profile" = 'ppr' AND "scoring_hash" = $3
         AND "capture_kind" = 'scheduled' AND NOT "is_late"
       ORDER BY "captured_at" DESC LIMIT 1`,
      [season, week, model.scoringHash(rules)]
    );
    if (head.rows.length === 0) return { capture: null };
    const [h] = head.rows;
    const rows = await client.query(
      `SELECT "player_id", "position", "mean", "median", "factors", "nfl_team", "injury_status", "game_kickoff_at"
       FROM "projection_snapshot_players" WHERE "snapshot_id" = $1`,
      [h.id]
    );
    // numeric columns arrive as strings: coerce, or the rank comparisons go lexicographic
    const num = (v) => (v == null ? null : Number(v));
    const now = new Date();
    // his game's kickoff as loadPracticeFacts reads it (team-week MIN), on the capture's frozen team
    const kicks = await client.query(
      `SELECT "sp"."player_id", MIN("g"."kickoff_at") AS "kickoff_at"
       FROM "projection_snapshot_players" "sp" JOIN "nfl_games" "g"
         ON "g"."season" = $1 AND "g"."week" = $2
        AND fn_normalize_nfl_team("g"."nfl_team") = fn_normalize_nfl_team("sp"."nfl_team")
       WHERE "sp"."snapshot_id" = $3 GROUP BY "sp"."player_id"`,
      [season, week, h.id]
    );
    const kickoffById = new Map(kicks.rows.map((k) => [k.player_id, k.kickoff_at]));
    const kickoffs = rows.rows.map((r) => kickoffById.get(r.player_id) ?? r.game_kickoff_at);
    const asOfs = kickoffs.map((k) => servedAsOf(k, now));
    const lo = Math.min(now, ...asOfs) - 3 * DAY_MS;
    const hi = Math.max(now, ...asOfs);
    // the observations as practiceParticipation.loadWeekObservations maps them, plus report_status
    const observed = await client.query(
      `SELECT "player_id", "practice_status", "practice_primary_injury", "report_status", "report_primary_injury", "observed_at"
       FROM "player_practice_observations" WHERE "season" = $1 AND "week" = $2 ORDER BY "observed_at", "id"`,
      [season, week]
    );
    const obsById = new Map();
    for (const o of observed.rows) {
      if (!obsById.has(o.player_id)) obsById.set(o.player_id, []);
      obsById.get(o.player_id).push({
        practiceStatus: o.practice_status, practicePrimaryInjury: o.practice_primary_injury,
        reportStatus: o.report_status, reportPrimaryInjury: o.report_primary_injury, observedAt: o.observed_at,
      });
    }
    // the QB depth charts backupQuarterbackIds reads; team and status come from the capture, not players
    const charts = await client.query(
      `SELECT "player_id", "rank", "team_code", "captured_date"::text AS "captured_date"
       FROM "player_depth_chart"
       WHERE "position_group" = 'QB' AND "captured_date" BETWEEN $1::date AND $2::date`,
      [dayOf(lo), dayOf(hi)]
    );
    const chartRows = captureChartRows(charts.rows, new Map(rows.rows.map((r) => [r.player_id, r])));
    const backupsBy = new Map();
    const backupsAt = (asOf) => {
      if (!backupsBy.has(asOf.getTime())) backupsBy.set(asOf.getTime(), backupQuarterbackIds(chartsBefore(chartRows, asOf), asOf));
      return backupsBy.get(asOf.getTime());
    };
    const ledger = new Map(rows.rows.map((r, i) => {
      const asOf = asOfs[i];
      return [r.player_id, {
        position: r.position,
        estimate: num(pointEstimateFor({ mean: num(r.mean), median: num(r.median), modelVersion: h.model_version })),
        unavailable: !!(r.factors && r.factors.availability && r.factors.availability.available === false),
        served: servedVerdictFor({
          factors: r.factors, injuryStatus: r.injury_status, kickoffAt: kickoffs[i],
          observations: observationsAsOf(obsById.get(r.player_id) || [], asOf),
          backup: r.position === 'QB' && backupsAt(asOf).has(r.player_id), asOf,
        }),
      }];
    }));
    const stats = await client.query(
      `SELECT s."player_id", p."position", s."stats" FROM "player_stats" s
       JOIN "players" p ON p."id" = s."player_id"
       WHERE s."season" = $1 AND s."week" = $2 AND p."position" = ANY($3::text[])`,
      [season, week, POSITIONS]
    );
    const actuals = new Map(stats.rows.map((r) => [r.player_id, {
      position: r.position,
      points: calculateFantasyPoints(r.stats, rules),
      appeared: madeAppearance(r.stats),
    }]));
    const pending = await client.query(
      `SELECT COUNT(*)::int AS "n" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2 AND "kickoff_at" > $3::timestamptz`,
      [season, week, new Date(now.getTime() - 4 * 60 * 60 * 1000)]
    );
    return { capture: h, ledger, actuals, gamesPending: pending.rows[0].n > 0 };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

const f2 = (v) => (v == null ? '-' : Number(v).toFixed(2));
const pct = (h, n) => (n ? `${h}/${n} (${Math.round((100 * h) / n)}%)` : '0/0');

function render(file, capture, r) {
  const out = [`Editorial calls: ${file.article} (season ${file.season}, week ${file.week}, ${file.scoring})`];
  out.push(`Capture: model ${capture.model_version}, captured ${new Date(capture.captured_at).toISOString()}, scheduled arm, PPR`);
  out.push('Served = the Start verdict rebuilt read-only as of a minute before kickoff (docs/editorial/README.md).');
  out.push('', 'Rankings (Spearman rho vs actual points, same player set)');
  for (const [pos, x] of Object.entries(r.rankings)) {
    out.push(`  ${pos.padEnd(3)} n=${String(x.n).padEnd(2)} editorial ${f2(x.editorialRho)}  capture ${f2(x.engineRho)}  blend ${f2(x.blendedRho)}  served (rebuilt) ${f2(x.servedRho)}${x.missing.length ? `  no ledger row: ${x.missing.join(', ')}` : ''}`);
  }
  out.push('', 'Calls');
  out.push('  id   name                    pos verdict cond      inj actual fin  app  ed    cap-call cap-est cap-rk cap   srv-call srv-why        srv-rk srv');
  const mark = (h) => (h === null ? 'void' : h ? 'HIT' : 'miss');
  for (const c of r.calls) {
    out.push(`  ${c.id.padEnd(4)} ${c.name.slice(0, 23).padEnd(23)} ${c.position.padEnd(3)} ${c.verdict.padEnd(7)} ${(c.condition || '').padEnd(9)} ${c.injury ? 'inj' : '   '} ${f2(c.actual).padStart(6)} ${String(c.finish).padStart(4)}  ${c.appeared ? 'yes' : 'no '}  ${mark(c.editorialHit).padEnd(5)} ${(c.engineCall || 'MISSING').padEnd(8)} ${f2(c.engineEstimate).padStart(6)} ${(c.engineUnavailable ? 'unav' : String(c.engineRank ?? '-')).padStart(5)}  ${(c.engineHit === null ? '-' : mark(c.engineHit)).padEnd(5)} ${(c.servedCall || '-').padEnd(8)} ${(c.servedReason || c.servedOutcome || '-').padEnd(14)} ${String(c.servedRank ?? '-').padStart(6)}  ${c.servedHit === null ? '-' : mark(c.servedHit)}`);
  }
  const s = r.summary;
  const pair = (x) => `editorial ${pct(x.editorialHits, x.n)}, capture ${pct(x.engineHits, x.n)}, served ${pct(x.servedHits, x.n)}`;
  out.push('', `Void (if-active, did not appear): ${s.void}. Capture row missing: ${s.engineMissing.length ? s.engineMissing.join(', ') : 'none'}.`);
  out.push(`Editorial, all non-void calls: ${pct(s.editorial.hits, s.editorial.n)}`);
  out.push(`Same non-void calls with a capture row (n=${s.paired.n}): ${pair(s.paired)}`);
  out.push(`  method calls, decide the week (n=${s.pairedMethod.n}): ${pair(s.pairedMethod)}`);
  out.push(`  injury-driven calls, reported only (n=${s.pairedInjury.n}): ${pair(s.pairedInjury)}`);
  return out.join('\n');
}

const ARTICLES_DIR = path.join(__dirname, '..', '..', 'src', 'content', 'articles');
const CALLS_FILE = /^week(\d+)-start-sit-darkness-report\.calls\.json$/;

/** Every week's calls file under src/content/articles, sorted by week. */
function allCallsFiles() {
  return fs.readdirSync(ARTICLES_DIR).map((f) => CALLS_FILE.exec(f)).filter(Boolean)
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- readdir names matched by CALLS_FILE cannot contain separators
    .map((m) => ({ week: Number(m[1]), path: path.join(ARTICLES_DIR, m[0]) })).sort((a, b) => a.week - b.week);
}

function renderLedger(ledger, skipped) {
  const trio = (x) => `editorial ${pct(x.editorialHits, x.n)}, capture ${pct(x.engineHits, x.n)}, served ${pct(x.servedHits, x.n)}`;
  const out = ['Season ledger (served = rebuilt, see docs/editorial/README.md)', ''];
  for (const w of ledger.weeks) {
    out.push(`week ${w.week}: method (n=${w.pairedMethod.n}) ${trio(w.pairedMethod)}`);
    out.push(`        injury (n=${w.pairedInjury.n}) ${trio(w.pairedInjury)}`);
  }
  for (const s of skipped) out.push(`week ${s.week}: skipped, ${s.reason}`);
  const t = ledger.totals;
  out.push('', `Season totals, ${ledger.weeks.length} week(s), same non-void calls with a capture row`);
  out.push(`  all calls (n=${t.paired.n}): ${trio(t.paired)}`);
  out.push(`  method calls (n=${t.pairedMethod.n}): ${trio(t.pairedMethod)}`);
  out.push(`  injury-driven calls (n=${t.pairedInjury.n}): ${trio(t.pairedInjury)}`);
  out.push('', 'Rankings (n-weighted mean of the weekly Spearman rho)');
  for (const [pos, x] of Object.entries(ledger.rankings)) {
    out.push(`  ${pos.padEnd(3)} n=${String(x.n).padEnd(3)} editorial ${f2(x.editorialRho)}  capture ${f2(x.engineRho)}  blend ${f2(x.blendedRho)}  served (rebuilt) ${f2(x.servedRho)}`);
  }
  const e = ledger.editorialFeed;
  out.push('', 'Editorial feed (#2524, preregistered: docs/editorial/editorial-feed-preregistration.md)');
  out.push(`  judged weeks (${e.weeks.length}): ${e.weeks.join(', ') || 'none'}; position-weeks ${e.positionWeeks}`);
  out.push(`  pooled rho (QB+TE, n-weighted): blend ${f2(e.blendedRho)}, capture ${f2(e.engineRho)}`);
  out.push(`  sign test: blend better ${e.favorable}, worse ${e.unfavorable}, ties ${e.ties}; one-sided p ${f2(e.p)}`);
  out.push(`  verdict: ${e.verdict}`);
  return out.join('\n');
}

function readCalls(file) {
  const calls = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (calls.scoring !== 'ppr') throw new Error('score-calls: only scoring "ppr" is supported');
  return calls;
}

async function main(argv) {
  const at = argv.indexOf('--calls');
  const all = argv.includes('--all');
  if (all === (at >= 0)) throw new Error('score-calls: exactly one of --calls <path> or --all is required');
  if (at >= 0 && !argv[at + 1]) throw new Error('score-calls: --calls <path> is required');
  if (!process.env.DATABASE_URL) {
    try { process.loadEnvFile(); } catch (e) { /* no .env in cwd; the pool reports a missing URL */ }
  }
  const pool = require('../../server/modules/pool');
  try {
    if (!all) {
      const file = readCalls(argv[at + 1]);
      const { capture, ledger, actuals } = await load(file, pool);
      if (!capture) throw new Error(`score-calls: no on-time scheduled PPR capture for ${file.season} week ${file.week}`);
      const result = scoreCalls(file, ledger, actuals);
      console.log(argv.includes('--json')
        ? JSON.stringify({ article: file.article, capture, ...result }, null, 2)
        : render(file, capture, result));
      return;
    }
    const scored = [];
    const skipped = [];
    for (const { week, path: callsPath } of allCallsFiles()) {
      const file = readCalls(callsPath);
      const { capture, ledger, actuals, gamesPending } = await load(file, pool);
      const reason = !capture ? 'no on-time scheduled PPR capture'
        : gamesPending ? 'games still to play' : actuals.size === 0 ? 'no player_stats rows yet' : null;
      if (reason) skipped.push({ week, reason });
      else scored.push({ week, season: file.season, article: file.article, capture, ...scoreCalls(file, ledger, actuals) });
    }
    const ledgerOut = seasonLedger(scored);
    console.log(argv.includes('--json')
      ? JSON.stringify({ ...ledgerOut, skipped, weekResults: scored }, null, 2)
      : renderLedger(ledgerOut, skipped));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  });
}

module.exports = {
  finishOf, judge, editorialBlend, EDITORIAL_FEED, rankingRho, scoreCalls, spearman, servedInjuryStatus, servedAsOf, servedVerdictFor, seasonLedger,
  observationsAsOf, chartsBefore, captureChartRows,
};
