# The Line is newest-wins; only a holdout capture bounds the read

Status: accepted (2026-09-11)

`getWeeklyOdds({ season, week, client })` (the odds seam, ADR 0037; the ESPN
implementation, `espnOdds.provider.js`) has always returned the newest
`game_odds_snapshots` row per game with no bound, and both callers —
`projection.service.js`'s live `generateProjections` path and
`holdout.service.js`'s capture path — read it that way. Three comments
disagreed: the `game_odds_snapshots` migration's docblock, that migration's
read-path index comment, and the no-op seam's docblock in
`vegasOdds.provider.js` all promised "the latest snapshot at or before the
run's `input_cutoff`," a bound nothing implemented. #1234's own AC3 ("the
newest snapshot per game is the Line; an older snapshot is never read once a
newer one exists") is a Cory-approved criterion that governed #1234 as
shipped, so the drift was in the comments, not the code.

`MODEL_CONSTANTS.gameEnvironment.maxEffect` ships `0`, so nothing stored in
`game_odds_snapshots` can currently move a projection — but that is a config
value, not a design boundary, and the day a sweep raises it, an unbounded
live read plus the hourly odds Sync run (ADR 0036) means a stored projection
could read a quote observed after the moment it claims to represent, with no
test going red.

## Decision

**Newest-wins is the read contract**, full stop, for every caller. This
matches CONTEXT.md's Line entry ("a line is a snapshot with a time; the
newest one is the line") and #1234's AC3, and it is safe under the "no future
information" rule for a reason specific to this table: `input_cutoff` is the
week's *first kickoff*, not a per-run wall-clock bound, and nothing about the
Line's freshness is audited against it. A live run generated after Thursday
kickoff reading Sunday's posted line is the intended product behaviour — the
alternative, freezing Sunday's games at Thursday's numbers, is worse — not a
leak.

The one place an unbounded read would be a genuine leak is a holdout capture
(`holdout.service.js`), because a capture's whole purpose is to certify what
the model could have known before a fixed cutoff. That guarantee already
held, but only *incidentally*: a capture computes inside one transaction
under a DB-clock guard that fails closed before compute and again before
commit, and `observed_at` is written from the DB clock, so a capture could
never in practice have completed while a future quote existed to read. This
ADR makes the guarantee explicit rather than leaving it to that coincidence:

- The seam gains an optional `observedAtOrBefore` (a Date or ISO string).
  When present, `espnOdds.provider.js`'s real implementation returns, per
  game, the newest snapshot with `observed_at` at or before that instant —
  filtered in SQL before the newest-per-game pick runs, so a game whose only
  snapshots are after the bound is absent from the map, never a null quote.
  When absent, behaviour is unchanged: newest per game, filtered to the
  provider's own source. The no-op provider ignores the argument, since it
  always returns nothing regardless.
- `projection.service.js`'s `generateProjections` gains one optional
  parameter, `oddsObservedAtOrBefore`, forwarded to the seam untouched and
  named so it cannot be mistaken for anything but the odds bound. The live
  path and the versioned-cache path (`getWeeklyProjections`) both pass
  nothing.
- `holdout.service.js`'s `snapshotWeek` passes its own effective cutoff — the
  manifest deadline tightened by the observed first kickoff, the exact value
  already guarding the clock checks — as `oddsObservedAtOrBefore` for every
  arm's projection run. A capture can now never read a quote observed after
  the moment it certifies as pre-kickoff, by construction rather than by
  accident of timing.

Weather is the existing precedent for an unbounded live read carrying no per
-run cutoff at all (it ships at `maxEffect` 0 too), so this decision keeps the
Line consistent with how the codebase already treats a second market-context
input, not a special case invented for this ticket.

## Considered options

- **Bound the live projection path by `input_cutoff` (option 1 in the
  originating issue).** Rejected: `input_cutoff` is the week's first kickoff,
  not a per-run instant, so bounding the live read by it would freeze every
  game in a week to whatever the Line said before the week's earliest game —
  Sunday's total held to Thursday's number — which is a worse product
  outcome than the "leak" it claims to prevent, and it does not match how
  `input_cutoff` is defined or used anywhere else in the schema.
- **Leave the migration's docblock as the aspirational contract and add the
  bound everywhere, including live.** Rejected for the same reason: nothing
  about the live surface needs or wants a per-run bound, and forcing one on
  reads that do not need it is scope the ruling explicitly declines.
- **Bound per-game by each game's own kickoff instead of a single run-level
  cutoff.** Out of scope: no caller today needs finer granularity than "as of
  this capture's cutoff," and the capture's cutoff already covers every game
  in the week uniformly.

## Consequences

- `getWeeklyOdds`'s seam signature is `{ season, week, client,
  observedAtOrBefore }` on both providers; a caller that does not pass the
  new field gets the exact behaviour it had before this ADR.
- The migration docblock, its read-path index comment, and the no-op
  provider's docblock no longer promise an `input_cutoff` bound; they state
  newest-wins as the contract, with the holdout-only bound named explicitly.
- No projection number changes anywhere: `MODEL_CONSTANTS.gameEnvironment
  .maxEffect` is still `0`, `MODEL_VERSION` is not bumped, and the live path
  passes no cutoff at all, so its behaviour is bit-identical to before this
  ADR.
- CONTEXT.md's Line entry and ADR 0037 are unchanged — they were already
  correct and are the truth this ADR aligns the other three comments with.
