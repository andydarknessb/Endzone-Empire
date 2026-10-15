# A practice-fed Challenger is captured on game day beside its own Control

Status: proposed (2026-10-15); the 2027 preregistration (#1948) adopts or amends it

The 2027 candidate #1925 feeds Practice participation into the Appearance
probability. The editorial scorecard (#1928) shows why it is worth a slot:
calls that turned on a Wednesday to Friday practice report went 8 of 8 for
the editorial and 4 of 8 for the capture in week 4 of 2026, and 18 of 29
against 17 of 29 in week 5. ADR 0056 already moves the Start verdict on the
same facts, but only the verdict; the number stays blind to them.

ADR 0050 writes every Challenger in the scheduled arm's transaction, 24
hours before the week's first kickoff. For a Practice participation arm
that is too early to test anything. In a week that opens on Thursday the
scheduled capture lands on Wednesday evening (Eastern; week 6 of 2026 at
8:19pm), before any report for that week's Sunday games has reached us, so
the arm would see last week's facts and nothing else.

We measured when the reports reach us (2026 weeks 5 and 6,
`player_practice_observations`). nflverse publishes once a day at about
02:01 ET with the previous day's report, and our poll reads it within 16
minutes. So a game's final report is in hand by about 02:30 ET on the day
after it is issued: Saturday for a Sunday game, Thursday for a Thursday
game (week 5, DAL at TB: 18.2 hours before kickoff), and on Thanksgiving
Thursday morning for the 12:30pm game.

We decide, for #1925's arm:

1. **The arm.** Capture kind `challenger:practice`, Model version
   `<Champion>+practice`, built like the three inert Challengers of PR #1947
   (`MODEL_CONSTANTS_BY_VERSION`, one change over its base). The change: for
   a player the Unavailable verdict leaves available, #1441's Appearance
   probability is replaced by a calibrated probability read from a lookup
   table. It never overrides an Unavailable verdict (Out, IR and the rest
   stay 0 in both arms). The mean, median and interval stay conditional on
   an Appearance (#1441 ruled choice 5; DECISION_RULE.md sections 1 and 4);
   the unconditional number is mean times active probability, and that
   product is the point estimate the arm moves.
2. **Its inputs**, as of the capture instant only (observations with
   `observed_at` at or before it):
   - the latest Game status as nflverse reports it (`report_status`), null
     meaning no designation;
   - the latest practice participation (full, limited, did not participate,
     none observed);
   - ADR 0056's no-practice-all-week fact, with its coverage and rest rules
     unchanged.
   A player with none of these that week keeps #1441's rate. Depth chart
   rank stays out; it is #1924's arm.
3. **The table.** The unit is a player-game: one per player per week, his
   facts as of that week's capture. One cell per Game status (none,
   Questionable, Doubtful) crossed with the latest participation, plus a
   no-practice-all-week cell for Questionable. Each cell holds the realized
   Appearance rate over 2026 weeks 5 to 18 (the first weeks with Practice
   participation history), read once after the week 18 capture closes on
   2027-01-09T18:00Z. A cell under 30 player-games falls back to its Game
   status row; a Game status row under 30 player-games (Doubtful is near
   that line: about 2 a week in weeks 4 and 5) is not replaced at all, and
   the arm leaves that status at the Control's value. The table, its counts
   and its source query are frozen in the preregistration before the first
   capture; 2026 is the fitting season and 2027 the judged one.
4. **The capture.** One capture per game day at 06:00 ET, covering every
   game kicking off that ET day, from one REPEATABLE READ snapshot, writing
   two arms in one transaction: `challenger:practice` and a paired Control
   under kind `game-control`. `game-control` is pinned to the
   preregistration's Control constants and constants hash, the same as the
   weekly Control kind (ADR 0050 point 3), so a promotion at a checkpoint
   never splits it. 06:00 ET is after that morning's nflverse publication
   and at least 3.5 hours before the earliest kickoff on record (2026: the 9:30am ET
   games abroad). The capture records the nflverse `source_last_updated` it
   saw: a capture whose stamp is not from that ET day is stale. A capture
   written after 07:30 ET, or within 2 hours of the day's first kickoff, is
   late. A stale or late game day leaves its week unjudged for this pair;
   a week is a Survivor for the pair only when every one of its game days
   was captured on time and fresh.
5. **The comparison.** The arm is judged against `game-control` only, never
   against the weekly `scheduled` arm, so both sides come from the same
   snapshot, the same injury sync and the same morning. ADR 0050's other
   requirements apply to the pair: a non-`candidate:*` kind, failure
   isolation (the game-day transaction cannot touch the weekly capture at
   all), exclusion from `/api/health` `REQUIRED_ARMS`, and Cory's ruling on
   the `HOLDOUT_PROTOCOL_VERSION` bump.
6. **The pass rule.** The unit is the Survivor week, as for every
   Challenger under ADR 0050 point 2: the arm is promoted only at a
   preregistered checkpoint, after K Survivor weeks ahead of `game-control`
   by the preregistered margin, with K, the margin and the primary metric
   set once for every Challenger. For this arm the metric is computed on
   the affected set, and two more conditions must also hold at the
   checkpoint:
   - Affected set: the player-games with any Game status or any Practice
     participation observation as of the capture. It is fixed by facts
     recorded at the capture, before any result.
   - Calibration: over the checkpoint's Survivor weeks, the arm's Brier
     score for active probability against realized Appearance on the
     affected set beats `game-control`'s.
   - No harm: over the same weeks, on every captured player-game, the
     primary metric is not worse than `game-control`'s by more than the
     margin.
   Wherever the Control's active probability is null (Doubtful under
   v3.2), every metric, not only the Brier score, takes it as the 2026
   realized Appearance rate for that Game status, so the arm cannot win a
   row just by supplying a number.

## Considered options

- **A game-day capture at 06:00 ET with a paired, pinned Control
  (chosen).** Sees every final report under the measured once-a-day
  publication, Thanksgiving included, and the pair shares one snapshot,
  which is what ADR 0050's same-transaction rule protects. Costs a new
  capture job, a new Control kind and two projection runs per game day.
- **Inside the scheduled capture, as ADR 0050 writes it.** No new job, but
  the arm would see no current-week report for any Sunday game, so it could
  only fail.
- **Kickoff minus 24 or minus 12 hours, per game.** Minus 24 misses a
  Thursday game's final report; minus 12 lands at 00:30 ET for the
  Thanksgiving 12:30pm game, before that morning's publication. A fixed
  morning time has neither failure and runs once per day, not per game.
- **Kickoff minus 90 minutes, after inactives.** Availability is then
  nearly known, which tests the inactive list, not the model, and lands
  after most managers set lineups.
- **Judge the arm on the whole pool only.** Most players carry no
  designation or report, so the arm and its Control tie on them and the
  difference drowns; the affected set is where the arm can win or lose.

## Consequences

- Nothing changes in 2026: no code path, capture, constant or Model
  version (ADR 0044). The table is read after 2027-01-09T18:00Z, from data
  the poll is already writing.
- On acceptance, ADR 0050 is amended for this arm only (it is not written
  in the scheduled transaction; the other Challengers keep that rule), and
  CONTEXT.md's Capture, Capture window and Shadow arm entries gain the
  game-day capture: one game day rather than one week, with the window and
  late rule of point 4.
- The arm reads nflverse's Game status; both arms keep reading the
  ESPN-fed status for the Unavailable verdict. The two sources can
  disagree for a few hours on a report day; the arm's change is reading
  the nflverse facts, so that difference is the thing being tested, not a
  leak.
- #1925 stays the build ticket and stays blocked by #1441. If the 2027
  Champion is v3.1 and #1441 is not served, the arm carries #1441's rate as
  well and differs from its Champion by two changes; the preregistration
  says so, and a pass credits both.
- The judged set depends on the nflverse daily publication. If it moves
  later than about 05:30 ET or skips a day, the staleness rule drops those
  game days rather than letting the arm be judged blind.
- The 2027 preregistration tracker #1948 lists the arm with a pointer here.
- Spec #2322.
