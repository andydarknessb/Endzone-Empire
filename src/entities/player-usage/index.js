/**
 * Public surface of the Player Usage entity (ADR 0029: the FSD island's
 * entities layer). The Decision card reads a player's Usage from HERE and
 * never from an internal path; the entity itself never imports a feature, a
 * widget, a page or another entity.
 *
 * BELOW-ISLAND EDGES (ADR 0029's audit surface). The hook imports
 * `shared/lib`'s `useEndpoint`, the same plain-read plumbing every League
 * Dashboard widget uses (#669); the model imports nothing at all. The
 * entity's below-island edge count is zero.
 */
export { usageFromResponse } from './model/usageModel';
export { useDecisionCardUsage } from './model/useDecisionCardUsage';
