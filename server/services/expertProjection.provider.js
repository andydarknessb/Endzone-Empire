/**
 * Provider boundary for third-party expert-consensus weekly projections.
 *
 * There is deliberately NO implementation behind it. Every well-known free
 * consensus source is either scraped HTML (FantasyPros, RotoWire, article
 * rankings), a personal-use-only API that must not ship in production, or an
 * undocumented endpoint that can change without notice. None of those is an
 * approved source for this app, so wiring one in would mean either violating
 * someone's terms or building on an interface that can silently start lying.
 *
 * The boundary exists anyway so that:
 *  - the projection engine has one place to plug a licensed feed into later,
 *    with the shape already agreed;
 *  - `sourceCoverage.expertConsensus` reports 'unavailable' honestly, and the
 *    lineup UI says "expert consensus unavailable" instead of implying that
 *    experts contributed to a number they never saw.
 *
 * A real provider must return a Map<playerId, { points, source }> and must not
 * fabricate an entry for a player the feed does not cover.
 */

const EXPERT_SOURCE_UNAVAILABLE = 'unavailable';

/** The active provider. Swap this for a real one behind an env flag when a licensed feed exists. */
function noopExpertProvider() {
  return {
    name: null,
    available: false,
    /** @returns {Promise<Map<number, {points: number, source: string}>>} always empty */
    async getWeeklyProjections() {
      return new Map();
    },
  };
}

let activeProvider = noopExpertProvider();

/** The configured provider. Never null — the no-op provider is a valid provider. */
function getExpertProvider() {
  return activeProvider;
}

/** Test/seam hook: install a provider. Pass nothing to restore the no-op. */
function setExpertProvider(provider) {
  activeProvider = provider || noopExpertProvider();
  return activeProvider;
}

/**
 * Coverage descriptor for the projection run's `source_coverage` payload.
 * 'unavailable' is a first-class value here: the UI must be able to tell
 * "no expert input" apart from "expert input that happened to agree".
 */
function expertCoverage() {
  const provider = getExpertProvider();
  return provider.available
    ? { status: 'available', source: provider.name || null }
    : { status: EXPERT_SOURCE_UNAVAILABLE, source: null };
}

module.exports = {
  EXPERT_SOURCE_UNAVAILABLE,
  noopExpertProvider,
  getExpertProvider,
  setExpertProvider,
  expertCoverage,
};
