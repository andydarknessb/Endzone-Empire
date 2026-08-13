/**
 * Provider boundary for third-party sportsbook odds (game total + spread).
 *
 * Deliberately NO implementation behind it, for the same reason
 * `expertProjection.provider.js` has none: every odds source is either a
 * licensed commercial feed, a personal-use-only tier that must not ship in
 * production, or a scraped page that can silently start lying. None of those
 * is an approved source, so the socket is built and left empty rather than
 * filled with something that violates a term of service or breaks without
 * notice.
 *
 * The boundary exists anyway so that:
 *  - `projectionModel.gameEnvironmentEffect` has one place to read a market
 *    quote from, with the shape already agreed;
 *  - `sourceCoverage.vegasOdds` reports 'unavailable' honestly, so the lineup
 *    UI can say "market data unavailable" instead of implying a book priced a
 *    game it never saw.
 *
 * ODDS MOVE, AND THAT IS THE WHOLE DESIGN CONSTRAINT. A Thursday total of 41
 * is a different measurement from the 47 the same game closed at, and a
 * provider queried after kickoff may return neither. Reading a live endpoint
 * at projection time and again at evaluation time reproduces exactly the
 * defect `holdout.service.js` exists to eliminate: numbers that are not what
 * the model knew when it spoke. So a provider's output is not consumed
 * directly by the engine — it is SNAPSHOTTED into `game_odds_snapshots` with
 * the observation time, and the engine reads the snapshot.
 *
 * A real provider must return a Map<gameKey, GameOdds> and must not fabricate
 * an entry for a game the book has not priced.
 *
 * @typedef {Object} GameOdds
 * @property {number} total       - the over/under, in points
 * @property {number} spread      - HOME team's spread; negative means home is
 *                                  favoured, matching every book's convention
 * @property {string} source      - provider identifier, stored for provenance
 * @property {string} observedAt  - ISO-8601 instant the quote was observed
 */

const VEGAS_SOURCE_UNAVAILABLE = 'unavailable';

/**
 * "Is this an actual number?" — deliberately NOT `Number.isFinite(Number(v))`,
 * which is the same trap `projectionModel.isNum` documents: `Number(null)` is
 * 0, so a book that has posted a total but pulled the spread would silently
 * become a pick-em and hand back two confident implied totals nobody quoted.
 * Duplicated rather than imported so this boundary stays free of a model
 * dependency; it is four lines and the shared version is not exported.
 */
function isNum(v) {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return false;
  return Number.isFinite(Number(v));
}

/** The active provider. Swap this for a real one behind an env flag when a licensed feed exists. */
function noopVegasOddsProvider() {
  return {
    name: null,
    available: false,
    /**
     * Called as `getWeeklyOdds({ season, week, client })`. A real provider is
     * expected to read `game_odds_snapshots` for the newest quote at or before
     * the run's input cutoff rather than hitting a live endpoint — see the
     * "odds move" note in the module docblock.
     *
     * @returns {Promise<Map<string, GameOdds>>} always empty
     */
    async getWeeklyOdds() {
      return new Map();
    },
  };
}

let activeProvider = noopVegasOddsProvider();

/** The configured provider. Never null — the no-op provider is a valid provider. */
function getVegasOddsProvider() {
  return activeProvider;
}

/** Test/seam hook: install a provider. Pass nothing to restore the no-op. */
function setVegasOddsProvider(provider) {
  activeProvider = provider || noopVegasOddsProvider();
  return activeProvider;
}

/**
 * Coverage descriptor for the projection run's `source_coverage` payload.
 * 'unavailable' is a first-class value here for the same reason it is on the
 * expert boundary: the UI must be able to tell "no market input" apart from
 * "a market that happened to price this game as average".
 */
function vegasCoverage() {
  const provider = getVegasOddsProvider();
  return provider.available
    ? { status: 'available', source: provider.name || null }
    : { status: VEGAS_SOURCE_UNAVAILABLE, source: null };
}

/**
 * Pure: split a game total and spread into the two teams' implied point
 * totals. This is the whole of the market's arithmetic and it is worth stating
 * once rather than inlining at every call site.
 *
 *   home = total / 2 - spread / 2      away = total / 2 + spread / 2
 *
 * With `total = 47` and `spread = -3` (home favoured by 3): home 25, away 22,
 * which sum back to the total and differ by the spread. Returns nulls rather
 * than guesses when either input is missing or non-finite.
 */
function impliedTeamPoints({ total = null, spread = null } = {}) {
  if (!isNum(total) || !isNum(spread)) {
    return { home: null, away: null };
  }
  const t = Number(total);
  const s = Number(spread);
  return { home: t / 2 - s / 2, away: t / 2 + s / 2 };
}

/**
 * Pure: the mean implied team total across every team playing this week.
 *
 * The comparison baseline `gameEnvironmentEffect` measures a team against,
 * taken from the slate the player actually played in rather than a hardcoded
 * league constant that would rot as scoring rates drift — and would quietly
 * mis-price every projection in a season where the league got faster.
 *
 * Games with a half-quote are SKIPPED rather than counted at half weight: a
 * game with no spread has no two implied totals to contribute, and letting it
 * in through the total alone would bias the mean toward whichever games the
 * book had priced least. Returns null when nothing usable is left, which makes
 * the factor unavailable instead of making every team look average.
 */
function slateAverageImplied(oddsByGameKey) {
  if (!oddsByGameKey || typeof oddsByGameKey.values !== 'function') return null;
  let sum = 0;
  let teams = 0;
  for (const quote of oddsByGameKey.values()) {
    const { home, away } = impliedTeamPoints(quote || {});
    if (home === null || away === null) continue;
    sum += home + away;
    teams += 2;
  }
  return teams > 0 ? sum / teams : null;
}

module.exports = {
  VEGAS_SOURCE_UNAVAILABLE,
  noopVegasOddsProvider,
  getVegasOddsProvider,
  setVegasOddsProvider,
  vegasCoverage,
  impliedTeamPoints,
  slateAverageImplied,
};
