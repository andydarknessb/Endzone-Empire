/**
 * pickem-board widget (#1265, ADR 0038): tallies one game's revealed
 * picks into the counts the locked card shows ("League picks · BAL 7,
 * IND 2" · "1 no pick", GameCard.dc.html state 4).
 *
 * `othersPicks` is the per-game lookup off the week response's own
 * `othersPicks` map (server/routes/pickem.router.js): keyed by gameKey to
 * an array, LOCKED GAMES ONLY. THE RED-TELL (#1265's acceptance criteria):
 * an unlocked game's gameKey is simply absent from that map, so the lookup
 * reads `undefined`, never `[]` - an empty array would already be a
 * (locked, nobody-revealed) answer, a different fact from "not locked
 * yet". This function trusts that distinction and returns null right
 * through for `undefined` or `null`, which is what tells the card to show
 * only the pre-lock count and no direction at all.
 *
 * The standing trap in this codebase (the scope fence, #1265): the WEEK
 * response's `othersPicks` is an OBJECT keyed by gameKey, not an array, so
 * a truthiness or `.length` test on THAT object reads the wrong way
 * (`{}.length` is `undefined`, always falsy, silently hiding every
 * game's reveal). This function is never handed that object - only the
 * per-game array a caller has already looked up by gameKey - so it never
 * makes that mistake itself; every caller must extract the per-game value
 * with `weekOthersPicks ? weekOthersPicks[gameKey] : undefined`, never a
 * length check on `weekOthersPicks` itself.
 *
 * `myPick` folds the viewer's OWN pick into the same tally: the server
 * never puts the viewer's own pick in `othersPicks` (it is a separate,
 * per-viewer array, `myPicks`), so a card showing "BAL 7" while the viewer
 * picked BAL themselves would otherwise undercount by exactly one.
 * `totalManagers` (the league's own team count, CONTEXT.md: "Teams rows
 * ARE league membership") is what turns "who picked which way" into "and
 * how many picked nothing" - the games above the split's counts.
 */
export function revealTally({ othersPicks, myPick = null, totalManagers = null }) {
  if (othersPicks == null) return null;

  const counts = {};
  for (const pick of othersPicks) {
    if (!pick || !pick.pickedTeam) continue;
    counts[pick.pickedTeam] = (counts[pick.pickedTeam] || 0) + 1;
  }
  let totalPicked = othersPicks.length;
  if (myPick) {
    counts[myPick] = (counts[myPick] || 0) + 1;
    totalPicked += 1;
  }

  const noPick = totalManagers != null ? Math.max(totalManagers - totalPicked, 0) : null;
  return { counts, noPick };
}

export default revealTally;
