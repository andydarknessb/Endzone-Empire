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

## 2. 2026-09-16 (authored; takes effect on merge after the week 18 capture): successor free_baseline_v3.2, three constants changes

**What changed.** `MODEL_VERSION` moves to `free_baseline_v3.2` with three
constants deltas (ADR 0047, spec #1438): `decision.lineupRanking` 'median'
-> 'mean' and the printed point estimate follows it (#1483);
`simulation.truncateAtPositionFloor` true, truncating each position group's
simulated draws at the lowest score the group has recorded over the stored
seasons before the Floor and Ceiling are read (#1483);
`opponent.priorSeasonPseudoGames` 4, seeding each defense's points allowed
per position with the prior season's value as a four-pseudo-game prior so
the opponent factor applies from week 1 (#1485). The market factor's
`gameEnvironment.maxEffect` stays 0; its retrospective replay over the
ledger's stored `rawEffect` (#1484, `server/scripts/compare-market-factor.js`)
is the evidence that would raise it, and no captured week carries a market
quote yet. v3.1's constants are preserved verbatim as
`MODEL_CONSTANTS_V3_1` and pinned by hash to the constants every scheduled
capture of this study stores, so the successor evaluator's rebuilt-v3.1
column remains v3.1. The CI constants pin
(`scripts/ci/check-model-constants.js`) is re-pinned to v3.2 in the same
commit.

**Why.** Week 2 2026: Terry McLaurin (mean 7.37 / median 10.06 / p10 -7.34)
was ranked over DK Metcalf (mean 9.03 / median 8.21 / p10 0.24) on the
median against every computed input, with a Floor no wide receiver has ever
scored; the same card printed a matchup allowance while the opponent factor
reported an insufficient sample and contributed nothing.

**Which claims it touches.** None of the v3.1 gates, PROVIDED the merge lands
after the final 2026 capture: no scheduled capture is taken under v3.2
constants, so the evaluator's majority rule drops nothing. Candidate A
(section "Candidate A - lineup decision rule") is the one preregistered test
this successor overlaps: v3.2 adopts the 'mean' flip on the frozen-artifact
evidence and the week 1 2026 audit regardless of Candidate A's verdict on
the v3.1 ledger; that test still runs and its verdict is recorded as
preregistered, and this entry is the disclosure that the flip was decided
before it. The successor itself is judged by #1439 against the sealed v3.1
captures (ADR 0044), which are untouched.
