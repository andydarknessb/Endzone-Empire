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
