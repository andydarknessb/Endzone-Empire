/**
 * The standard default roster-slot shape, lifted out of lineup.service as a
 * PURE LEAF so a jsdom test can import it without dragging in the pg pool.
 *
 * lineup.service.js's first load-time require is the pg pool (`../modules/pool`
 * -> `require('pg')`, pool options built at module scope from `process.env`),
 * so a client-side parity test that imported the service to read this constant
 * would pull pg into a jsdom bundle. This module has NO load-time require of
 * any kind: it is a value and nothing else, importable from either tree.
 *
 * `lineup.service` re-exports this same reference (`DEFAULT_ROSTER_SLOTS`), so
 * every existing server consumer (decision.service, lineupOptimizer, the
 * backtest sweep script, the service's own defaults) keeps resolving the
 * identical array unchanged. The value lives here; the service is now a
 * pass-through for it.
 *
 * This module is the SERVER-SIDE single source of the standard shape. Client
 * src/ cannot import it at runtime (react-scripts's ModuleScopePlugin confines
 * the bundle to src/), so client mirrors exist and this is what they are
 * measured against:
 *
 *   - src/lib/lineupAttention.js's `DEFAULT_STARTER_SLOT_ORDER` (the starter
 *     KEYS only) is PINNED to this module by lineupAttention.parity.test.js.
 *   - src/lib/draftSim/templates.js exports a THIRD, byte-identical
 *     `DEFAULT_ROSTER_SLOTS`. It is PINNED to this module by
 *     src/lib/draftSim/templates.parity.test.js (#692), which compares the
 *     two whole-object and in order, not just by key: this copy also carries
 *     `count` and `eligiblePositions`, so a drift in either is real.
 *
 * So do not treat this as the only copy: changing the contents here does not
 * propagate to either client mirror. lineupAttention.parity.test.js pins keys
 * only, so a count or eligiblePositions drift passes it silently; the
 * whole-object templates.parity.test.js is what fails on a count or
 * eligiblePositions drift in templates.js.
 *
 * There is no third, hand-kept client copy. The commissioner roster form
 * (src/components/LeagueDashboard/CommissionerTools.jsx) derives its one-click
 * lineup templates from templates.js's pinned DEFAULT_ROSTER_SLOTS rather than
 * keeping its own literal, and CommissionerTools.test.jsx additionally pins the
 * Standard template's rendered rows (keys and counts, in order) back to this
 * leaf. So there are two client copies — lineupAttention.js (keys only) and
 * templates.js (whole object) — and both are covered by a parity test.
 */

const DEFAULT_ROSTER_SLOTS = [
  { key: 'QB', label: 'QB', count: 1, eligiblePositions: ['QB'] },
  { key: 'RB', label: 'RB', count: 2, eligiblePositions: ['RB'] },
  { key: 'WR', label: 'WR', count: 2, eligiblePositions: ['WR'] },
  { key: 'TE', label: 'TE', count: 1, eligiblePositions: ['TE'] },
  { key: 'FLEX', label: 'FLEX', count: 1, eligiblePositions: ['RB', 'WR', 'TE'] },
  { key: 'K', label: 'K', count: 1, eligiblePositions: ['K'] },
  { key: 'DEF', label: 'DEF', count: 1, eligiblePositions: ['DEF'] },
];

module.exports = { DEFAULT_ROSTER_SLOTS };
