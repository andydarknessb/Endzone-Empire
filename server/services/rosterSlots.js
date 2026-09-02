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
 * src/lib/lineupAttention.js carries a CLIENT mirror of these starter keys
 * (`DEFAULT_STARTER_SLOT_ORDER`); src/lib/lineupAttention.parity.test.js pins
 * the two equal, in order, against this module.
 *
 * Ownership note: the standard shape is defined ONCE, here. Do not change its
 * contents as a side effect of anything - the two mirrors above are validated
 * against it.
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
