/**
 * The Draft assistant's ten triggers (issue #784 ruling 7, ADR 0027). Every
 * fact object lineFor() is handed carries exactly one of these as
 * `facts.trigger`.
 *
 * "Your Pick" fires as exactly one of the first five, in the priority order
 * listed: a picked player is labelled once, so PICK_STEAL / PICK_REACH win
 * over PICK_EARLY_KDEF / PICK_RB / PICK_GENERIC when more than one could
 * apply. QUEUE_PICKED_BY_OTHER is Draft room only; the Sim has no Queue
 * (verified 2026-09-03). PICK_AUTO fires instead of any of the five "your
 * Pick" triggers when the pick carries the auto flag, never alongside one.
 */
export const TRIGGERS = {
  PICK_STEAL: 'pick:steal',
  PICK_REACH: 'pick:reach',
  PICK_EARLY_KDEF: 'pick:earlyKickerOrDefense',
  PICK_RB: 'pick:runningBack',
  PICK_GENERIC: 'pick:generic',
  QUEUE_PICKED_BY_OTHER: 'queue:pickedByOtherTeam',
  TURN_START: 'turn:start',
  CLOCK_URGENT: 'clock:urgentEdge',
  POOL_PLAYER_SELECTED: 'pool:playerSelected',
  PICK_AUTO: 'pick:autopick',
};

export const ALL_TRIGGERS = Object.values(TRIGGERS);
