/**
 * Public surface of the Draft entity (ADR 0029: the FSD island's entities
 * layer; the Draft feature's first slice, after Matchup). Widgets, pages and the
 * legacy `src/components/DraftBoard` surfaces import the Draft model from HERE
 * and never from an internal path; the entity itself never imports a feature, a
 * widget, a page or another entity.
 *
 * BELOW-ISLAND EDGES (ADR 0029's audit surface). This slice reaches below the
 * island for nothing. The On-the-clock derivation `deriveOnTheClock` the model
 * uses to turn a draft snapshot into the `{ team, state, deadlineAt }`
 * pick-clock value the room, the presenter and the mock draft all speak (#754)
 * now lives in the shared layer itself, `src/shared/lib/onTheClock` (#997),
 * imported by its file path rather than through `shared/lib`'s barrel index
 * (that barrel re-exports `useEndpoint`, and pulling it in from the Draft
 * room would make the room's harness coverage think the room reaches a live
 * API client through this entity, which it does not); it is no longer a
 * reach below the island, so the ADR 0029 conflict this docblock used to
 * record is closed. The model reaches nothing else below the island either -
 * no fetch, no socket, no React - so it stays pure and testable by plain
 * function call. Everything else in this folder is internal.
 */
export {
  pickFromSnapshotRow,
  pickFromPickedEvent,
  deadlineFromLeague,
  onTheClockFor,
  emptyDraftModel,
  applyBoardSnapshot,
  applyLandedPick,
  applyDraftComplete,
} from './model/draftModel';
