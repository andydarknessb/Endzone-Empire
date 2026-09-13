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
export function sortRosterForDrop(roster) {
  const projectionOf = (p) => (p.projected_weekly_points != null ? Number(p.projected_weekly_points) : null);
  return [...(roster || [])].sort((a, b) => {
    const av = projectionOf(a);
    const bv = projectionOf(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });
}

export default sortRosterForDrop;
