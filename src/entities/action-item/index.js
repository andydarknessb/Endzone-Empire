/**
 * Public surface of the Action item entity (ADR 0029: the FSD island's entities
 * layer; ADR 0067 wave 1b). Consumers read the signed-in user's action items
 * (`GET /api/user/action-items`) from HERE and never from an internal path; the
 * entity imports no feature, widget, page or other entity.
 *
 * `useActionItems()` is the read; `yourMoveModel(items, { leagueId, now })` is
 * the pure League Dashboard "Your move" view over it (one card per shared
 * deadline, earliest first).
 *
 * Below-island edge (ADR 0029's 2026-09-05 amendment, plumbing only): `src/hooks/useResource`
 * for the shared cached GET, the same edge the Pickem standings entity names.
 */
export { useActionItems } from './model/useActionItems';
export { yourMoveModel } from './model/yourMoveModel';
