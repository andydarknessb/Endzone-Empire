/**
 * Public surface of the Draft entity (ADR 0029: the FSD island's entities
 * layer; the Draft feature's first slice, after Matchup). Widgets, pages and the
 * legacy `src/components/DraftBoard` surfaces import the Draft model from HERE
 * and never from an internal path; the entity itself never imports a feature, a
 * widget, a page or another entity.
 *
 * BELOW-ISLAND EDGES (ADR 0029's audit surface). This slice reaches the legacy
 * tree below the island for exactly ONE thing: the shared On-the-clock
 * derivation `src/lib/onTheClock` (deriveOnTheClock), which is the one place the
 * client turns a draft snapshot into the `{ team, state, deadlineAt }` pick-clock
 * value the room, the presenter and the mock draft all speak (#754). The model
 * owns the room's on-the-clock derivation, so it depends on that helper directly
 * rather than re-deriving the clock a second way. It reaches nothing else below
 * the island - no fetch, no socket, no React - so the model stays pure and
 * testable by plain function call. Everything else in this folder is internal.
 *
 * KNOWN ADR 0029 CONFLICT, held open (not a sanctioned edge). "On the clock" is a
 * defined domain term (CONTEXT.md), and ADR 0029 says an entity does not reach
 * below the island for a domain concept; ADR 0031's carve-out is scoped to
 * page-only helpers, which this is not (DraftOrderPanel is already a second island
 * consumer). So this edge is a recorded exception, not an example to copy: the
 * project lead is filing a ticket to move `onTheClock` into the island, and this
 * import moves onto it when that lands. Until then the edge stands, tracked here.
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
