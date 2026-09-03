/**
 * The Draft assistant (issue #784 Summary, ADR 0027, CONTEXT.md glossary
 * term "Draft assistant"): a private, opt-in voice in the Draft room and the
 * Draft Sim that comments on a manager's own Picks, Queue and Pick clock.
 * "Polk High Legend" (src/lib/draftAssistant/voices/polkHighLegend.js) is its
 * first voice, not the assistant's own name.
 *
 * This directory holds the venue-agnostic pieces only: pure functions over a
 * facts object, no DOM, no presenter. A thin presenter per venue (the
 * existing pickAnnouncement.js / PickAnnouncer.jsx split, per ruling 13)
 * turns real Draft state into a facts object and calls lineFor() with it.
 *
 * THE FACTS SHAPE, as built by a presenter and consumed by lineFor():
 * {
 *   trigger:              one of src/lib/draftAssistant/triggers.js's TRIGGERS
 *   player: {
 *     name:                string
 *     position:             string ('QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | ...)
 *     nfl_team:             string | null
 *     injury_status:        string | null
 *   },
 *   pickNumber:            number, the overall pick this fact describes
 *   round:                 number, 1-based
 *   draftRounds:           number, total rounds in the draft
 *   adp:                   number | null, the player's market ADP
 *   label:                 'steal' | 'reach' | 'value' | 'no-market'
 *                            (src/lib/stealReach.js's stealReachLabel, the
 *                            same rule analysis.js's pickValues() uses)
 *   earlyKickerOrDefense:  boolean (earlyKickerOrDefense() below)
 *   auto:                  boolean, true when the pick carries the Autopick flag
 *   netVsAdp:               number, the manager's running Net vs ADP so far
 *                            (feeds miseryStage() below)
 * }
 *
 * Every field always exists on the object; a field this trigger has no use
 * for is simply not referenced by that trigger's templates. Approved
 * measures only (ruling 1): this shape never carries a rank, a "value"
 * number of its own, or anything Best available produces.
 */
export { earlyKickerOrDefense } from './earlyKickerOrDefense';
export { miseryStage, MISERY_BANDS } from './miseryStage';
export { createLineGenerator, fillTemplate } from './lineFor';
export { TRIGGERS, ALL_TRIGGERS } from './triggers';
export { SELECTION_COOLDOWN_MS } from './selectionCooldown';
export { LINES as POLK_HIGH_LEGEND_LINES } from './voices/polkHighLegend';
