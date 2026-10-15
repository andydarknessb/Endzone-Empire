# A practice-fed Challenger is captured per game, twelve hours before kickoff, beside its own Control

Status: accepted (2026-10-15)

The 2027 candidate #1925 feeds Practice participation into the Appearance
probability. The editorial scorecard (#1928) shows why it is worth a slot:
calls that turned on a Wednesday to Friday practice report went 8 of 8 for
the editorial and 4 of 8 for the capture in week 4 of 2026, and 18 of 29
against 17 of 29 in week 5. ADR 0056 already moves the Start verdict on the
same facts, but only the verdict; the number stays blind to them.

ADR 0050 writes every Challenger in the scheduled arm's transaction, about
24 hours before the week's first kickoff. For a Practice participation arm
that is too early to test anything. In a week that opens on Thursday the
scheduled capture lands on Wednesday evening (Eastern; week 6 of 2026 at
8:19pm), before any report for that week's Sunday games has reached us, so
the arm would see last week's facts and nothing else. We measured when the reports reach us (2026 weeks 5 and 6,
`player_practice_observations`): nflverse publishes once a day at about
02:01 ET with the previous day's report, and our poll reads it within 16
minutes. A Sunday game's final report (Friday) lands Saturday about 02:15
ET, roughly 35 hours before a 1pm kickoff. A Thursday game's final report
(Wednesday) lands Thursday about 02:15 ET, 18.2 hours before an 8:15pm
kickoff; a capture 24 hours out would have missed seven week 5 designations
for DAL at TB.

We decide that #1925's arm is captured per game, not per week:

1. **The arm.** Capture kind `challenger:practice`, Model version
   `<Champion>+practice`, built like the three inert Challengers of PR #1947
   (`MODEL_CONSTANTS_BY_VERSION`, one change over its base). The change:
   the Appearance probability of #1441 is replaced, for a player with a Game
   status or any Practice participation observation that week, by a
   calibrated probability read from a lookup table. The mean, median and
   interval stay conditional on an Appearance, as #1441 ruling 5 stores
   them; the unconditional number every reader that needs one takes is mean
   times active probability (DECISION_RULE.md section 4). That product is
   the point estimate the arm moves.
2. **Its inputs**, as of the capture instant only (observations with
   `observed_at` at or before it):
   - the latest Game status (`report_status`), null meaning no designation;
   - the latest practice participation (full, limited, did not participate,
     none observed);
   - ADR 0056's no-practice-all-week fact, with its coverage and rest rules
     unchanged;
   - #1441's rate for everyone else.
   Depth chart rank stays out; it is #1924's arm.
3. **The table.** One cell per Game status (none, Questionable, Doubtful)
   crossed with the latest participation, plus a no-practice-all-week cell
   for Questionable. Each cell holds the realized Appearance rate over the
   2026 observations (weeks 5 to 18, the first weeks with Practice
   participation history), read once after the week 18 capture closes on
   2027-01-09T18:00Z. A cell with fewer than 30 observations falls back to
   its Game status row. The table, its row counts and its source query are
   frozen in the 2027 preregistration before the first capture; 2026 is
   only the fitting season and 2027 the judged one.
4. **The capture.** One capture per game at kickoff minus 12 hours, from
   the game's own REPEATABLE READ snapshot, writing two arms in one
   transaction: `challenger:practice` and a paired Control under kind
   `game-control`, which is the Champion's constants at the same instant.
   Twelve hours clears the Thursday final report by six hours and puts every
   other slot well after its final report. The capture records the
   nflverse `source_last_updated` it saw; a game whose newest source stamp
   is more than 30 hours old is captured but marked stale and left out of
   the judged set.
5. **The comparison.** The arm is judged against `game-control` only, never
   against the weekly `scheduled` arm, so both sides saw the same injury
   sync and the same reports. ADR 0050's requirements apply to the pair: a
   non-`candidate:*` kind, failure isolation (the per-game transaction
   cannot touch the weekly capture at all), exclusion from `/api/health`
   `REQUIRED_ARMS`, and Cory's ruling on the `HOLDOUT_PROTOCOL_VERSION`
   bump.
6. **The pass rule.** The arm must clear all three, with K, the margin and
   the alpha set once for every Challenger in the preregistration:
   - Primary: DECISION_RULE.md's pairwise test (half_ppr) on the affected
     set, the players with a Game status or any observation that was not a
     full practice as of the capture. Both arms see those inputs, so the
     set is fixed before any result.
   - Calibration: on the affected set, the arm's Brier score for active
     probability against realized Appearance beats `game-control`'s. A
     Control probability that is null (Doubtful under v3.2) is scored at
     the 2026 marginal rate for its Game status, so the Control is not
     punished for declining to guess.
   - No harm: on every captured player, the pairwise test does not lose by
     more than the margin.

## Considered options

- **Per-game capture at kickoff minus 12 hours, paired Control (chosen).**
  Sees every final report under the measured once-a-day publication, and
  the pair shares one snapshot, which is what ADR 0050's same-transaction
  rule protects. Costs a new capture job, a new Control kind and two
  projection runs per game.
- **Inside the scheduled capture, as ADR 0050 writes it.** No new job, but
  the arm would see no current-week report for any Sunday game, so it could
  only fail.
- **Kickoff minus 24 hours.** Misses a Thursday game's final report (18.2
  hours before kickoff in week 5).
- **Kickoff minus 90 minutes, after inactives.** Availability is then
  nearly known, which tests the inactive list, not the model, and lands
  after most managers set lineups.
- **Judge the arm on the whole pool only.** Most players carry no
  designation, so the arm and its Control tie on them and the difference
  drowns; the affected set is where the arm can win or lose.

## Consequences

- Nothing changes in 2026: no code path, capture, constant or Model
  version (ADR 0044). The table is read after 2027-01-09T18:00Z, from data
  the poll is already writing.
- ADR 0050 is amended for this arm only: it is not written in the
  scheduled transaction. The other Challengers keep ADR 0050's rule.
- #1925 stays the build ticket and stays blocked by #1441. If the 2027
  Champion is v3.1 and #1441 is not served, the arm carries #1441's rate as
  well and differs from its Champion by two changes; the preregistration
  says so, and a pass credits both.
- The judged set depends on the nflverse daily publication. If it moves
  later than about 02:30 ET or skips days, the 30-hour staleness mark drops
  those games rather than letting the arm be judged blind.
- The 2027 preregistration tracker #1948 lists the arm with a pointer here.
- Spec #2322.
