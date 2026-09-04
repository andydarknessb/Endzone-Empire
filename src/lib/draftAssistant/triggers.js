/**
 * The Draft assistant's eleven triggers (issue #784 ruling 7 as amended by its
 * 2026-09-03 ruling on #815, ADR 0027). Every fact object lineFor() is handed
 * carries exactly one of these as `facts.trigger`.
 *
 * "Your Pick" fires as exactly one of the first five, in the priority order
 * listed: a picked player is labelled once, so PICK_STEAL / PICK_REACH win
 * over PICK_EARLY_KDEF / PICK_RB / PICK_GENERIC when more than one could
 * apply. QUEUE_PICKED_BY_OTHER is Draft room only; the Sim has no Queue
 * (verified 2026-09-03). PICK_AUTO fires instead of any of the five "your
 * Pick" triggers when the pick carries the auto flag, never alongside one.
 *
 * THE TWO POOL TRIGGERS ARE VENUE-SPLIT (issue #815, amending #784 ruling 7).
 * A single shared pool trigger once meant two opposite things and drew the
 * same departure copy for both; it is removed outright, with no alias, so a
 * browse can never draw a departure line again:
 *   - POOL_PLAYER_BROWSED: Draft room only. The viewer opening a player's
 *     quick view from the pool table (weighing a still-available player). Its
 *     copy is a scouting register that never asserts a draft event. The Sim
 *     has no browse action (a pool row click there IS the pick), so this
 *     trigger never fires in the Sim.
 *   - POOL_PLAYER_TAKEN: Draft Sim only. Another team's pick removing a
 *     player from the pool, cooldown-throttled; keeps the eight departure
 *     lines that shipped under the old trigger. The Draft room still never
 *     reacts to another team's un-queued pick (it has the Queue snipe).
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
  POOL_PLAYER_BROWSED: 'pool:playerBrowsed',
  POOL_PLAYER_TAKEN: 'pool:playerTaken',
  PICK_AUTO: 'pick:autopick',
};

export const ALL_TRIGGERS = Object.values(TRIGGERS);
