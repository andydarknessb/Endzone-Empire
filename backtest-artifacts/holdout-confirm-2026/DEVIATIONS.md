# Deviations

Append-only, per PREREGISTRATION.md section 12: each entry names what changed,
why, and which claims it touches. A deviation that touches a gate voids the
touched claim unless it is purely mechanical.

## 1. 2026-09-15: input data correction, 25 fabricated player_stats rows removed

**What changed.** Twenty-five `player_stats` rows for season 2025 week 1
(ids 438, 439, 441, 443, 444, 448-454, 456, 457, 459-461, 464-468, 470, 471,
540) were deleted from the production database. Twenty-three carried the
identical stat line `{receptions: 4, receivingYards: 40, receivingTDs: 1}`
with `fantasy_points` 0.00 and no `gameTeam`; two (457, 540) carried a
different small line with the same 0.00 points. No code path in the
repository writes those values; the rows were written on the database's
first day, outside the application. A backup of the deleted rows is held
outside the repository. Cached `projection_runs` for 2026 weeks 2-18 were
invalidated at the same time so later weeks recompute from corrected inputs.

**Why.** The week 1 audit found the rows feeding a flat 12.0 half-PPR
projection (one prior game of exactly 12 points) to 16 players in the 2026
cohort, ranking obscure players above real starters on the advice surfaces.

**Which claims it touches.** None of the gates. The engine, its constants and
its Model version are unchanged, and the week 1 captures (snapshots 1-9,
protocol 2, all `is_late = false`) stand exactly as captured: they recorded
the projections the engine made from the inputs that existed at capture, and
the evaluator scores captures against outcomes, not against later inputs.
Captures from week 2 onward see the corrected priors for those 16 players.
This is recorded as an input correction of the purely mechanical class; it
voids nothing.

**Guard added.** A single write funnel now computes `fantasy_points` from the
stored stats for every application write, and a nightly scan records any row
whose stored points disagree with its stats (`player_stats_anomalies`,
surfaced at `/api/health/stats-integrity` and asserted by the hourly uptime
watchdog), so a row of this class can no longer sit unnoticed.

## 2. 2026-09-24: availability correction, players with no NFL team project hard-unavailable (#1589, PR #1591, commit 1946f719726fb50cc5735f416fdf92a79afabae8)

**What changed.** `availabilityFor` gains the `no_team` branch: a player with
a null `nfl_team` now projects `available: false, activeProbability: 0`.
`MODEL_VERSION`, `MODEL_CONSTANTS` and the pinned hash are byte-identical, and
no projected number moves.

**Why.** The week 2 audit (#1589) found teamless QBs at the position-baseline
fallback with `activeProbability` 1 ranking as starters on Start/Sit and
Waivers.

**Which claims it touches.** No section 9 void condition fires: `model_version`
and `constants_hash` stay their season majority. Captures from the merge week
onward write `activeProbability` 0 for null-`nfl_team` rows. Section 5 and
section 7 exclude such a row from Candidate B's coverage denominators
(`scripts/holdout/lib/coverage.js:41`, imported by `successorEval.js:26`), and
section 6 ranks it 0 in both arms' lineups (`scripts/holdout/lib/regret.js:32`,
reached through `evaluate.js:306-332`); that is the treatment the sealed rules
already give a bye / Out / IR designation at capture, applied identically in
every arm. (`evaluate.js` itself never reads `active_probability`; the effect
arrives through `regret.weekRegret` and the coverage module.) Recorded as an
input correction touching no gate (ADR 0044; #1589 ruling (3)): the
eligibility shift is the same class as an Out designation at capture, which
the sealed rules already exclude, and it voids nothing. Captures made before
that merge retain activeProbability 1 on the affected rows; no ledger row,
snapshot or release_sha is rewritten.

## 3. 2026-09-27: input addition, four nflverse column groups persisted as new non-scoring stat keys (#1706)

**What changed.** The nightly nflverse-week finalization pass
(`buildStatUpdates`, `server/services/nflverseSync.service.js`) now also
parses `target_share`, `air_yards_share`, `wopr` and the per-category EPA
columns (`passing_epa`, `rushing_epa`, `receiving_epa`) from the combined
`stats_player_week_<season>.csv` file it already downloads, and writes them
as six new `player_stats.stats` keys (`usageTargetShare`,
`usageAirYardsShare`, `usageWopr`, `epaPassing`, `epaRushing`,
`epaReceiving`), read null-preserving the same as the existing `usage*`
columns (a blank column stays unknown, never a fabricated 0). All six are
added to `NFLVERSE_ONLY_STAT_KEYS` (`server/services/boxScoreApply.service.js`)
so a later Tank01 box-score re-apply carries them forward instead of erasing
them, and none is added to `STAT_KEY_PATHS`
(`server/services/scoringRules.js`): they are not scored and never change
`fantasy_points`. No existing `player_stats.stats` key is rewritten and no
new `player_stats` row is inserted as a side effect — the write is the same
read-merge-upsert `applyNflverseWeekUnit` already used, only the patch is
wider.

**Why.** The projection engine has no challenger yet that reads usage
weighting on targets and air yards or WOPR, but the sync already downloads
these columns and drops them; landing them now, unscored, lets that
challenger be built and measured later without a second backfill.

**Which claims it touches.** None of the gates. `MODEL_VERSION`,
`MODEL_CONSTANTS` and the pinned hash are unchanged
(`scripts/ci/check-model-constants.js` still passes byte-for-byte), no
projected number moves, and `calculateFantasyPoints` output is unchanged for
every existing test fixture since the six new keys are absent from
`STAT_KEY_PATHS` and `calculateFantasyPoints` ignores unknown keys. This is
an input-class addition, not a correction: it adds columns the evaluator has
never read, touching no `player_stats` row's existing keys, no `usage*` key,
no `receptions`, `gameTeam` or `gameOpponent`, and no row count. Recorded as
purely mechanical; it voids nothing.

## 4. 2026-09-29: availability correction, Practice squad players project hard-unavailable (#1767, PR #1787)

**What changed.** `unavailableFor` gains the `practice_squad` branch: a player
whose latest NFL roster status row (`player_nfl_roster_status`, #1766) says
Practice squad and was updated within 48 hours reads `available: false,
activeProbability: 0`. Precedence is bye, No NFL team, Practice squad, then
Out and IR. A missing or stale status reads as Active, and Reserve gates
nothing. The projection engine receives the fact as a
`Map<playerId, status>` read by the caller (`nflRosterStatus.js`
`loadNflRosterStatusById`), not through its own player read: that text is
pinned by the backtest snapshot surface (`scripts/backtest/lib/sqlSurface.js`)
and stays byte-identical. Two callers pass the Map: the live cache path
(`completeRun`) and the holdout capture (`holdout.service.js`
`snapshotWeek`, read once on the capture's own REPEATABLE READ connection
and handed to every arm, required and Challenger). `MODEL_VERSION`,
`MODEL_CONSTANTS` and the pinned hash are byte-identical, and no projected
number moves: mean, median and the interval are computed exactly as before.

**Why.** The 2026-09-29 diagnosis (spec #1764) found practice-squad players
(Phil Mafah NYG, Jawhar Jordan HOU) with `activeProbability` 1 ranking as
Waiver Wire upgrades and startable options. Captures include the fact so
captured availability matches what managers saw (spec #1764 story 19; Cory's
ruling on PR #1787 review finding f2).

**Which claims it touches.** The same as entry 2, and no more. No section 9
void condition fires: `model_version` and `constants_hash` stay their season
majority. Captures from the merge week onward write `activeProbability` 0 for
fresh Practice squad rows; section 5 and section 7 exclude such a row from
Candidate B's coverage denominators (`scripts/holdout/lib/coverage.js`) and
section 6 ranks it 0 in both arms' lineups (`scripts/holdout/lib/regret.js`),
the treatment the sealed rules already give an Out designation at capture,
applied identically in every arm. Backtest snapshot replays and the successor
evaluator (`scripts/holdout/lib/successorEval.js`) pass no Map, so they read
every player Active exactly as before and no replayed week changes. Recorded
as an input correction touching no gate (ADR 0044, the #1589 precedent); it
voids nothing. Captures made before the merge retain activeProbability 1 on
the affected rows; no ledger row, snapshot or release_sha is rewritten.

## 5. 2026-09-29: input correction, a box re-apply keeps the stored two-point conversion keys (#1760, PR #1803, commit 655a41766c118b6547b14aaf2db496fec5f57238, released in b1ac61b0)

**What changed.** The Stat line write now runs through one ownership table
(`STAT_KEY_OWNERSHIP`, `server/services/playerStatsWrite.service.js`): a
replace-kind source is authoritative for the keys it owns and carries every
key it does not own from the prior stored line. The `box` source (the Tank01
and ESPN Live/Final box) does not own `passingTwoPt`, `rushingTwoPt`,
`receivingTwoPt` or `kickReturns`, because no box builder emits them (the
boxes carry only the defensive `twoPointReturn`); nflverse's Tue/Wed
correction (`nflverse-correction`, `CORRECTION_KEYS`) writes all four. Under
the old box path a box apply that landed after a correction stored the box
line plus the 22-key `NFLVERSE_ONLY_STAT_KEYS` carry list, which did not hold
the four keys, so the conversions nflverse had written were erased and
`fantasy_points` dropped by 2 per conversion under the default rules
(`passingTwoPt`, `rushingTwoPt` and `receivingTwoPt` are in `STAT_KEY_PATHS`,
`server/services/scoringRules.js`). Now they survive, and the stored line and
its `fantasy_points` match what the correction wrote. A box apply lands after
a correction only on a recap regeneration (`gameRecap.service.js`), an admin
re-sync, or a Final-box stamp that runs late; a game whose Final box applied
before its correction never hit the old loss. `MODEL_VERSION`,
`MODEL_CONSTANTS` and the pinned hash are untouched (the merge changes no
file under the projection engine, the holdout capture or `scripts/holdout`),
and the change rewrites no `player_stats` row by itself: a row that lost its
conversions before the release keeps the loss until the next correction pass
rewrites that week.

**Why.** Spec #1758 / #1760 replaced four caller-chosen carry lists with one
table. The old list's own rule was "only keys the live feed cannot
regenerate"; the three conversion keys met that rule and were missing from
it, so the old behaviour was a data loss, not a scoring decision. Whether
this file needed an entry was raised on PR #1803 (formal-001 f1) and ruled
on 2026-10-01: yes, because entry 3 rests on "none is added to
`STAT_KEY_PATHS` ... never change `fantasy_points`", and this is the first
carried key that is scored; without this entry the file would misdescribe
what a box re-apply carries.

**Which claims it touches.** None of the gates. Section 5 outcome truth is
the pinned nflverse bytes re-scored by `calculateFantasyPoints`; no stored
fantasy-point column is consumed, and the evaluator is pure over ledger rows
and those actuals (`scripts/holdout/lib/evaluate.js`, `regret.js`
`actualPoints`, `coverage.js`, `rosters.js` `preWeekRanking`), so no outcome
and no roster ranking moves. The effect is on capture input only: the engine
reads prior-week `player_stats.stats` (`scripts/backtest/lib/sqlSurface.js`
`priorPlayerStats`, SQL text unchanged) and re-prices each line with
`calculateFantasyPoints(stats, rules)` (`server/services/projectionFeatures.js`
invariant 2), so from the first capture after the 2026-09-29 release a prior
week that would have lost a conversion to a late box apply now carries it,
which is the value the pinned nflverse source gives that week. No section 9
void condition fires: `model_version` and `constants_hash` stay their season
majority and the arms still share one feature snapshot. The successor
evaluator (`server/scripts/run-successor-eval.js`) re-prices `player_stats`
as its own actuals and so sees the kept keys; it is advisory (#1439, ADR
0044), not a gate. Recorded as an input correction of the purely mechanical
class, the same class as entries 1 and 3 (ADR 0044; #1760 ruling); it voids
nothing. Captures made before the release retain the priors they read; no
ledger row, snapshot or release_sha is rewritten.
