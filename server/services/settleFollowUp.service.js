const montecarlo = require('./montecarlo.service');
const recap = require('./recap.service');
const trophies = require('./trophy.service');
const digest = require('./digest.service');

/**
 * The Settle follow-up: the post-week analytics that run after a week settles,
 * as one ordered chain. Odds first so the recap reads fresh playoff numbers
 * (the recap reads the latest stored power_rankings row), then trophies, then
 * the recap, then (advance only) the digest. Trophies come before the recap
 * because the recap narrates them (#1854): it reads the trophy rows just
 * written and never recomputes them.
 *
 * `mode` picks each step's variant:
 *   advance    - award every trophy, announce the recap, send the digest.
 *   correction - reconcile only the weekly high score trophy, then store the
 *                recap silently (the correction's own "scores were updated"
 *                notice is the one announcement), no digest.
 *
 * Display data, never worth failing anything over: every step is caught and
 * logged and the next step still runs, so this never rejects for a step
 * failure. Callers choose whether to await it (correction) or not (advance).
 */
const STEPS = {
  advance: [
    { failed: 'power rankings failed', run: ({ leagueId }) => montecarlo.computeLeagueOdds({ leagueId }) },
    { failed: 'trophy awards failed', run: (a) => trophies.awardWeeklyTrophies(a) },
    { failed: 'weekly recap failed', run: (a) => recap.generateWeeklyRecap(a) },
    { failed: 'recap digest failed', run: (a) => digest.sendWeeklyRecapDigest(a) },
  ],
  correction: [
    { failed: 'power rankings failed', run: ({ leagueId }) => montecarlo.computeLeagueOdds({ leagueId }) },
    { failed: 'weekly high score trophy reconcile failed', run: (a) => trophies.reconcileWeeklyHighScoreTrophy(a) },
    { failed: 'recap rebuild failed', run: (a) => recap.computeAndStoreWeeklyRecap(a) },
  ],
};

async function settleFollowUp({ leagueId, season, week, mode }) {
  const steps = Object.hasOwn(STEPS, mode) ? STEPS[mode] : null;
  if (!steps) throw new Error(`settleFollowUp: mode must be 'advance' or 'correction', got ${mode}`);
  for (const step of steps) {
    try {
      await step.run({ leagueId, season, week });
    } catch (err) {
      console.error('settle follow-up (%s): %s for league %s week %s:', mode, step.failed, leagueId, week, err.message);
    }
  }
}

module.exports = { settleFollowUp };
