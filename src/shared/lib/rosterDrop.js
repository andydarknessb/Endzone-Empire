// Worst-weekly-projection-first roster sort (#1307, ADR 0031's 2026-09-11
// amendment #1269: "A helper with domain meaning may be reached until a
// second island slice consumes it. At that point it is promoted ... a
// promotion is a move, never a copy."). Restated from WaiverWire.jsx's own
// original claim-dialog drop-pick sort; once `features/add-player` and
// `features/claim-player` both needed the identical rule (a second island
// consumer), formal review round 1 (f7) required the promotion rather than
// a third copy - the sibling-feature "duplicate on purpose" defense
// `claim-player` gave is exactly the case this rule resolves.
//
// Worst-projection-first so the natural cut order comes first; roster
// entries without a weekly projection sort after ones that have it and fall
// back to caller order (position, name) among themselves.
//
// A player in an IR slot is left out: his stash is what grants the extra
// spot (irPolicy.rosterCapacity), so dropping him frees none and the add or
// claim that needed the room is refused - the server's dropSuggestion skips
// IR the same way. shortcut: a recovered occupant grants no spot and would
// free one, but the manager benches him first; read eligibility if that bites.
export function sortRosterForDrop(roster) {
  const projectionOf = (p) => (p.projected_weekly_points != null ? Number(p.projected_weekly_points) : null);
  return (roster || []).filter((p) => p.lineup_slot !== 'IR').sort((a, b) => {
    const av = projectionOf(a);
    const bv = projectionOf(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });
}

export default sortRosterForDrop;
