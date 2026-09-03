/**
 * How far off market a Draft pick has to be, in that round, to read as a
 * steal or a reach. Scaled by round because ADP noise widens as the board
 * thins: a 10-pick swing in round 1 is a story, in round 12 it's rounding.
 *
 * Promoted out of src/lib/draftSim/analysis.js (issue #785, ADR 0027) so the
 * Draft assistant and the Draft Sim's post-draft report share one definition
 * instead of two that could drift apart. analysis.js re-imports this rather
 * than keeping its own copy; src/lib/draftSim/stealReachThreshold.parity.test.js
 * pins that.
 *
 * Server Draft Grades keep their own, DIFFERENT per-team extreme definition
 * (server/services/draftgrade.service.js) — the glossary already says the two
 * are separate questions, and this module makes no attempt to mirror that one.
 */
export function stealReachThreshold(round) {
  return 6 + 1.5 * round;
}
