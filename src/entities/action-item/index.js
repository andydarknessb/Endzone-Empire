/**
 * Public surface of the Action item entity (ADR 0029: the FSD island's entities
 * layer; ADR 0067 wave 1b). Consumers read the signed-in user's action items
 * (`GET /api/user/action-items`) from HERE and never from an internal path; the
 * entity imports no feature, widget, page or other entity.
 *
 * `useActionItems()` is the read; `playModel(items, { now, leagueId? })` is
 * the pure Play grouping over it (the Shared Lock Rule: one lock, one Play,
 * earliest first), shared by Home and the League dashboard's Your move.
 * `itemType` and `lineupProblemFor` (model/actionItemModel.js) are the one
 * client reader of an item's id format (`type:leagueId[:key]`, spec #2532):
 * a surface asks for an item's type or for this week's Lineup problem here
 * rather than splitting the id itself.
 *
 * Below-island edge (ADR 0029's 2026-09-05 amendment, plumbing only): `src/hooks/useResource`
 * for the shared cached GET, the same edge the Pickem standings entity names.
 */
export { useActionItems } from './model/useActionItems';
export { playModel, playName } from './model/playModel';
export { itemType, lineupProblemFor } from './model/actionItemModel';
