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

function round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The steal/reach label for one pick, shared by the Draft assistant's room
 * presenter (roomAssistantFacts.js) and the Draft Sim's post-draft report
 * (draftSim/analysis.js) so the two never disagree about one pick. Promoted
 * here in issue #817: ADR 0027 already promised a shared label with a parity
 * test, but only the THRESHOLD above was ever shared; the label rule had been
 * written a third time in the room and had drifted on degenerate ADP.
 * src/lib/draftSim/stealReachThreshold.parity.test.js drives both venues'
 * real paths through this function and asserts they agree.
 *
 * The market guard is the Sim's and the server's, not the room's old one: an
 * ADP counts only when `Number.isFinite(Number(adp)) && Number(adp) > 0`.
 * Otherwise the pick has no market, its `draftValueScore` is 0 and
 * `adpFallback` is true, so it can never read as a steal or a reach and
 * contributes nothing to Net vs ADP. `draftValueScore` is `round2(adp -
 * pickNumber)`: a pick that landed LATER than its ADP scores negative (a
 * steal), one that landed EARLIER scores positive (a reach), and the swing has
 * to clear stealReachThreshold(round) in that round to earn either label.
 *
 * `round` is OPTIONAL. Omit it (draftPickValue does, since the report keeps its
 * own labelling) and the pick is scored but not classified: `label` is null.
 * This is a stated case, not an accident: without a round there is no threshold
 * to compare against, so returning a label would be a lie. A caller that needs
 * the label passes the round.
 *
 * Server Draft Grades keep their own, DIFFERENT per-team extreme definition
 * (server/services/draftgrade.service.js, CommonJS): this client module makes
 * no attempt to mirror or be imported by that one (issue #817 ruling 3).
 *
 * @param {{ adp: *, pickNumber: number, round?: number }} input
 * @returns {{ label: 'steal'|'reach'|'value'|'no-market'|null, draftValueScore: number, adpFallback: boolean }}
 */
export function stealReachLabel({ adp, pickNumber, round }) {
  const parsedAdp = Number(adp);
  const hasMarketAdp = Number.isFinite(parsedAdp) && parsedAdp > 0;
  if (!hasMarketAdp) {
    return { label: 'no-market', draftValueScore: 0, adpFallback: true };
  }
  const draftValueScore = round2(parsedAdp - Number(pickNumber));
  if (round == null) {
    return { label: null, draftValueScore, adpFallback: false };
  }
  const threshold = stealReachThreshold(round);
  let label = 'value';
  if (draftValueScore <= -threshold) label = 'steal';
  else if (draftValueScore >= threshold) label = 'reach';
  return { label, draftValueScore, adpFallback: false };
}
