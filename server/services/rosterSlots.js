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
 *     `DEFAULT_ROSTER_SLOTS`. It is NOT pinned by anything, and its comment
 *     still cites lineup.service.js for a value that no longer lives there, so
 *     this extraction leaves that citation stale. Pinning it is out of scope
 *     here and tracked by #692; it is named rather than hidden so an author
 *     changing this shape knows templates.js will not follow on its own.
 *
 * So do not treat this as the only copy: changing the contents here does not
 * propagate to templates.js, and only the lineupAttention mirror has a test
 * that will notice.
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
