# Editorial feed: preregistration (#2524)

Status: sealed when this file reaches origin, which must be before the week 8 first kickoff (2026-10-30T00:15Z). After that, nothing below changes. A change is a deviation, recorded at the foot of this file with its date, and it voids the verdict.

## Question

Does blending the Editorial QB and TE ranks into the engine's point estimate order those positions better than the engine alone? #1928 met its week 8 rule on method calls, but that lead is within noise (22-17 disagreements, sign test p = 0.52). The ranking edge it showed came from weeks 4-7 (n-weighted rho, QB editorial 0.23 vs capture 0.07, TE 0.45 vs 0.27). Those weeks chose the question, so they are not judged here.

## The arm

A derived arm, not a capture. It is a pure function of two inputs that are both sealed before kickoff:

- the on-time `scheduled` PPR capture for the week (`projection_snapshots`, `capture_kind = 'scheduled'`, `NOT is_late`), the same comparator #1928 used;
- the week's calls file, `src/content/articles/week<N>-start-sit-darkness-report.calls.json`, its `rankings.QB` and `rankings.TE`.

For each position, the moved set is the ranked players who have a capture row, whom the capture does not hold unavailable, and who carry no `"injury": true` call that week. Within the moved set, the player at editorial rank r receives the r-th highest capture point estimate of that set as his expert points. The blended estimate is `expertConsensusBlend` (`server/services/projectionModel.js`) at blend weight **0.5**, the existing seam's formula `(1 - w) * estimate + w * expertPoints`. Every other player keeps his capture estimate. A player the capture holds unavailable scores 0, as in the engine column.

The weight is fixed, not fitted: four weeks of 14-player rhos cannot fit it.

Nothing changes in the engine. No Model version, constant, capture, `capture_kind` or `HOLDOUT_PROTOCOL_VERSION` moves in 2026 (ADR 0044), and the holdout-confirm-2026 study is not touched.

## Measurement

`node scripts/editorial/score-calls.js --all`, run after the week 18 games are final. Per week and position, `rankingRho` gives the Spearman rho against actual PPR points over one player set (the editorial ranking's players who have a capture row), for the editorial order, the engine order (`engineRho`) and the blend (`blendedRho`). Actuals and appearance rules are the scorer's, unchanged. The verdict uses the `editorialFeed` block of that output (`EDITORIAL_FEED` in the script).

## Judged weeks

2026 weeks 8 to 18. A week is judged only if all of these hold:

- its calls file reached origin before that week's first kickoff (`nfl_games.kickoff_at`), checked at verdict time with `git log origin/integration --format=%cI -- <file>` against the merge or push time on GitHub;
- no commit touched the file after that first kickoff;
- the scorer did not skip the week (no capture, no stats, games still to play).

A week that fails any of these is removed from the run before the verdict is read. The Tuesday score is the score of record. Later stat corrections are reported, not re-scored (#1928 ruling).

## Pass rule

The unit is the position-week, one per judged week at QB and one at TE, counted only when both `blendedRho` and `engineRho` exist on a non-empty set.

The arm passes only if both hold:

1. **Pooled rho:** the n-weighted mean of `blendedRho` over all position-weeks is higher than that of `engineRho`.
2. **Sign test:** a one-sided exact sign test on position-weeks (blend above capture is favorable, ties dropped) gives p ≤ 0.10.

Fewer than 6 judged weeks leaves the arm **unjudged**, which is not a pass.

Power is low: with 22 position-weeks the sign test needs 15 favorable. A fail means the gain was not shown. It does not mean the feed does harm.

## Outcomes

- **Pass:** `free_baseline_v3.2+editorial` goes on the 2027 preregistration (#1948) as a Challenger. Its live form is ruled there, with an ADR: the provider reading the calls file, and its timing, because the ranks land about 15 hours after the scheduled capture.
- **Fail or unjudged:** `MODEL_CONSTANTS.expertConsensus.blendWeight` stays 0, and the seam stays parked.

Either way, the verdict and the `editorialFeed` block are posted on #1948.

## Deviations

None.
