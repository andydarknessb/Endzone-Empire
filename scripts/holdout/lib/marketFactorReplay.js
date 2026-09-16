'use strict';

/**
 * #1484: "market on" vs "market off", replayed over the existing ledger with
 * no deploy.
 *
 * `projectPlayer` (projectionModel.js) already computes a market factor every
 * run from the odds sync - `factors.gameEnvironment`, with `impliedPoints`,
 * `opponentImplied`, `slateAverageImplied` and the uncapped `rawEffect` - but
 * ships it inert: `MODEL_CONSTANTS.gameEnvironment.maxEffect` is 0, so
 * `clamp(rawEffect, 0)` is always 0 and `scored` is always false. Because
 * every holdout snapshot row stores that `rawEffect` alongside the captured
 * mean/median/p10/p25/p75/p90, "market on" can be scored against "market off"
 * over the ledger's Survivor cohort for every week where the odds sync had
 * run at capture, with no reprojection and no deploy: re-apply a candidate
 * cap (and optional shrinkage) to the ALREADY-CAPTURED distribution and
 * compare MAE, Spearman rho, pairwise accuracy and interval coverage against
 * `player_stats`, per scoring profile.
 *
 * How re-applying the factor to a captured row is computed (and why this is
 * exact, not an approximation): `gameEnvironment` is applied by
 * `projectPlayer`'s `applyFactor` as the LAST multiplicative step before
 * `simulateDistribution` - `next = running * (1 + effect)` - and
 * `simulateDistribution`'s residual pool is added AROUND that finished mean
 * (the residuals are additive, not scaled). Replacing a shipped effect of 0
 * with a candidate effect therefore shifts the WHOLE distribution by one
 * constant, `delta = capturedMean * candidateEffect`: mean, median, p10, p25,
 * p75 and p90 all move by `delta`, and the interval WIDTHS (p90-p10, p75-p25)
 * are unchanged, because the residual draws themselves never depended on
 * `gameEnvironment`. That is exactly what `replayRows` below does - it is a
 * replay of the capped-factor arithmetic, not a re-run of the model.
 *
 * Weeks whose capture reports "no slate baseline" (or any other
 * `gameEnvironment` unavailable reason) are EXCLUDED from the comparison, not
 * imputed - `weekEligibility` below is what draws that line, per row, off the
 * SAME captured `factors.gameEnvironment.available` flag the engine itself
 * set at capture time.
 *
 * Pure module: no I/O, no database, no clock (`evaluateMarketFactor`'s
 * `generatedAt` is the one exception, an informational timestamp on the
 * output, never read back into a comparison). The runner
 * (`server/scripts/compare-market-factor.js`) is the I/O shell that reads the
 * ledger and `player_stats` and hands this module plain rows.
 *
 * Reuses `scripts/holdout/lib/successorEval.js`'s `metricsForArm` and
 * `aggregateWeekly` verbatim for MAE/rho/pairwise/coverage - no new metric
 * code, same rule #1439's ruling already established.
 */

const successorEval = require('./successorEval');

/**
 * A ledger decimal column, coerced to a number or null - never a bare
 * `typeof v === 'number'` check. `projection_snapshot_players`' mean/median/
 * p10-p90 columns are `t.decimal`, and node-pg returns them as STRINGS (no
 * NUMERIC type parser registered) - the same reason `successorEval.js`'s own
 * `numOrNull` exists. Reimplemented here (not exported by that module) rather
 * than reaching past its public surface.
 */
function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Same shape as `console`-facing reports elsewhere in this codebase: 4 decimal places, or 'n/a'. */
function fmt(value, digits = 4) {
  return isNum(value) ? value.toFixed(digits) : 'n/a';
}

/**
 * Identical to `projectionModel.js`'s own `clamp` (not exported there):
 * symmetric cap at `limit`, plus `+ 0` to fold a `-0` result (produced
 * whenever a negative `value` gets clamped to a `limit` of exactly 0, e.g.
 * the `market-off` arm) back to `0` - IEEE754 addition of `-0` and `+0` is
 * `+0`, so this changes nothing for any other value.
 */
function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value)) + 0;
}

/**
 * The candidate effect for one captured `factors.gameEnvironment` payload
 * under arm `{ maxEffect, shrink }` - `null` when there is nothing to apply:
 * the factor is absent, was captured `available: false` (whatever the
 * reason), or its `rawEffect` is not a finite number. Otherwise the SAME
 * derivation `projectPlayer` uses, `clamp(rawEffect * shrink, maxEffect)`,
 * just run against the candidate's own cap/shrink instead of the shipped
 * (inert) constants.
 */
function marketEffectFor(factor, { maxEffect, shrink = 1 } = {}) {
  if (!factor || factor.available !== true) return null;
  const raw = numOrNull(factor.rawEffect);
  if (raw === null) return null;
  return clamp(raw * shrink, maxEffect);
}

const SHIFTED_FIELDS = ['mean', 'median', 'p10', 'p25', 'p75', 'p90'];

/**
 * New row objects - inputs are never mutated - with mean/median/p10/p25/p75/
 * p90 shifted by `numOrNull(row.mean) * effect` wherever an effect applies,
 * and left exactly as captured otherwise. Every row carries `marketEffect`:
 * the effect actually applied, or `null` when nothing was (no factor, an
 * unavailable factor, or a captured mean this arm could not coerce to a
 * number).
 */
function replayRows(rows, arm) {
  return rows.map((row) => {
    const factor = row.factors && row.factors.gameEnvironment;
    const effect = marketEffectFor(factor, arm);
    const mean = effect === null ? null : numOrNull(row.mean);
    if (effect === null || mean === null) {
      return { ...row, marketEffect: null };
    }
    const delta = mean * effect;
    const next = { ...row, marketEffect: effect };
    for (const field of SHIFTED_FIELDS) {
      const value = numOrNull(row[field]);
      next[field] = value === null ? row[field] : value + delta;
    }
    return next;
  });
}

/**
 * Whether a captured week has ANY row with a scored-eligible market quote
 * (`factors.gameEnvironment.available === true`), and, when none do, the most
 * common reason it does not - so the report can say WHY a week was excluded
 * rather than just that it was. `'no gameEnvironment factor stored'` covers a
 * row whose `factors` predates this factor existing at all (no key, as
 * opposed to a key with `available: false`).
 */
function weekEligibility(rows) {
  let available = 0;
  const reasonCounts = new Map();
  for (const row of rows) {
    const factor = row.factors && row.factors.gameEnvironment;
    if (factor && factor.available === true) {
      available += 1;
      continue;
    }
    const reason = (factor && factor.reason) || 'no gameEnvironment factor stored';
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
  }
  if (available > 0) return { eligible: true, available, reason: null };
  let bestReason = 'no gameEnvironment factor stored';
  let bestCount = -1;
  for (const [reason, count] of reasonCounts) {
    if (count > bestCount) {
      bestReason = reason;
      bestCount = count;
    }
  }
  return { eligible: false, available: 0, reason: bestReason };
}

const CAPS_DEFAULT = [0.05, 0.10, 0.15, 0.25];
const SHRINKS_DEFAULT = [1, 0.5];

function armKey(maxEffect, shrink) {
  return `cap${maxEffect.toFixed(2)}-shrink${shrink}`;
}

/**
 * The arm list `evaluateMarketFactor` scores by default: the `market-off`
 * control first (`maxEffect: 0`, reproducing today's shipped inert factor
 * exactly - `replayRows` under this arm never applies a delta, since
 * `clamp(x, 0)` is always 0 but `marketEffectFor` still returns 0, not null;
 * see the note on `market-off` in `evaluateMarketFactor`'s doc), then every
 * cap x shrink combination.
 */
function buildArms({ caps = CAPS_DEFAULT, shrinks = SHRINKS_DEFAULT } = {}) {
  const arms = [{ key: 'market-off', maxEffect: 0, shrink: 1 }];
  for (const maxEffect of caps) {
    for (const shrink of shrinks) {
      arms.push({ key: armKey(maxEffect, shrink), maxEffect, shrink });
    }
  }
  return arms;
}

const ARMS_DEFAULT = buildArms();

/**
 * The whole comparison: per profile, split captured `scheduled`-arm weeks
 * into eligible/excluded (`weekEligibility`), then for every arm and every
 * eligible week replay the captured rows (`replayRows`) and score them with
 * `successorEval.metricsForArm` against `actuals` - the SAME metric function
 * the #1439 gate uses, so a market-factor comparison and a successor-model
 * comparison are read the same way.
 *
 * `profiles` is `[{ name, weeks: [{ header: { season, week }, rows }],
 * actuals }, ...]` - the exact shape `run-successor-eval.js`'s
 * `loadProfile`/`loadCapturedWeeks`/`loadActuals` already produce, so the
 * runner passes them through unchanged.
 *
 * `market-off` is included as an explicit arm (not just "the captured row
 * unmodified") so every arm in the report, including the control, goes
 * through the identical `replayRows` -> `metricsForArm` path - a market-off
 * column computed a different way would risk silently comparing two
 * different code paths rather than two different constants.
 */
function evaluateMarketFactor({ profiles, arms = ARMS_DEFAULT }) {
  const result = { generatedAt: new Date().toISOString(), arms, profiles: {} };
  for (const profile of profiles) {
    const eligibleWeeks = [];
    const excludedWeeks = [];
    for (const week of profile.weeks) {
      const eligibility = weekEligibility(week.rows);
      if (eligibility.eligible) {
        eligibleWeeks.push(week);
      } else {
        excludedWeeks.push({ week: week.header.week, reason: eligibility.reason });
      }
    }

    const byArm = {};
    for (const arm of arms) {
      const weekly = eligibleWeeks.map((week) => {
        const replayed = replayRows(week.rows, arm);
        return {
          week: week.header.week,
          ...successorEval.metricsForArm({
            rows: replayed, actuals: profile.actuals, season: week.header.season, week: week.header.week,
          }),
        };
      });
      byArm[arm.key] = { weekly, season: successorEval.aggregateWeekly(weekly) };
    }

    result.profiles[profile.name] = {
      eligibleWeeks: eligibleWeeks.map((week) => ({ season: week.header.season, week: week.header.week })),
      excludedWeeks,
      byArm,
    };
  }
  return result;
}

/**
 * Markdown report: one table per profile, rows = arms, columns MAE / rho /
 * pairwise / cov80 / cov50 / weeks scored - plus the excluded weeks and their
 * reasons, and, when a profile has zero eligible weeks, a plain sentence
 * instead of an empty table (a profile whose ledger never saw a market quote
 * at capture, like the 2026 week 1 launch).
 */
function renderReport(result) {
  const lines = [];
  lines.push('# Market factor replay (#1484)');
  lines.push('');
  lines.push(`generated: ${result.generatedAt}`);
  lines.push('');
  for (const [profileName, profile] of Object.entries(result.profiles)) {
    lines.push(`## ${profileName}`);
    lines.push('');
    if (profile.eligibleWeeks.length === 0) {
      lines.push('no week with a market quote at capture; nothing to compare');
      lines.push('');
    } else {
      lines.push(`eligible weeks: ${profile.eligibleWeeks.map((w) => w.week).join(', ')}`);
      lines.push('');
      lines.push('| arm | MAE | rho | pairwise | cov80 | cov50 | weeks |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- |');
      for (const arm of result.arms) {
        const season = profile.byArm[arm.key].season;
        lines.push(
          `| ${arm.key} | ${fmt(season.mae)} | ${fmt(season.spearman)} | ${fmt(season.pairwise)} `
          + `| ${fmt(season.cov80)} | ${fmt(season.cov50)} | ${season.weeksScored} |`
        );
      }
      lines.push('');
    }
    if (profile.excludedWeeks.length > 0) {
      lines.push('excluded weeks:');
      for (const { week, reason } of profile.excludedWeeks) lines.push(`- week ${week}: ${reason}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

module.exports = {
  numOrNull,
  fmt,
  clamp,
  marketEffectFor,
  replayRows,
  weekEligibility,
  armKey,
  buildArms,
  CAPS_DEFAULT,
  SHRINKS_DEFAULT,
  ARMS_DEFAULT,
  evaluateMarketFactor,
  renderReport,
};
