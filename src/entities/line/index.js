/**
 * Public surface of the Line entity (ADR 0029: the FSD island's entities
 * layer). The Decision card reads a player's Line and Weather from HERE and
 * never from an internal path; the entity itself never imports a feature, a
 * widget, a page or another entity.
 *
 * BELOW-ISLAND EDGES (ADR 0029's audit surface). The hook imports
 * `shared/lib`'s `useEndpoint`, the same plain-read plumbing every League
 * Dashboard widget uses (#669); the model imports nothing at all. The
 * entity's below-island edge count is zero.
 *
 * `weather` lives here rather than in its own entity because both are read
 * off the SAME game (CONTEXT.md's Decision card: "the game with implied team
 * total and weather"), and one endpoint call already returns both alongside
 * `usage` (`entities/player-usage`, the ticket's other new slice, #1236).
 */
export { lineContextFromResponse } from './model/lineModel';
export { useDecisionCardLine } from './model/useDecisionCardLine';
