# free_baseline_v3.1 release provenance

Release `2c52e0f`, deployed 2026-07-28 ~15:54 UTC (workflow run 30375627945),
verified live via `/api/health` `release` field. Commits: `5eb7696`
(deterministic distributions + version bump), `7de6fc8` (post-correction
cache invalidation), `2c52e0f` (invalidation widened to `week >=`, aggregate
failure surfacing, scheduler containment).

Everything below was measured read-only against the shared database on
2026-07-28, before the 2026 season started. Season data (2024, 2025,
weeks 2-18) was static throughout.

## Artifact inventory

Replay outputs: per-player rows of
`[season, week, playerId, mean, median, p10, p90, vsMeetings, vsContribution]`
for the six fantasy positions, weeks 2-18, both seasons — 14,016 rows each,
default constants, default scoring.

| File | Checkout | Model version |
|---|---|---|
| `replay-pre.json` | `266060a` (pre-a404cf0) | free_baseline_v3 |
| `replay-head.json` | `a404cf0` run 1 | free_baseline_v3 |
| `replay-head2.json` | `a404cf0` run 2 (determinism control) | free_baseline_v3 |
| `replay-v31-run1.json` | `2c52e0f` run 1 | free_baseline_v3.1 |
| `replay-v31-run2.json` | `2c52e0f` run 2 (determinism control) | free_baseline_v3.1 |

Scripts: `replay-driver.js` (produces a replay from any checkout),
`replay-attrib.js` (commit-vs-ambient attribution), `qa-diff.js`
(determinism + mean-preservation), `median-gate.js` (the release gate),
`perf-test.js`, `data-checks.js` / `data-checks-scoped.js` (cohort and
team-key audits). They resolve the repository root and their data files
relative to this directory (`__dirname`), so they run from the archive
as-is; `replay-driver.js` additionally takes an explicit checkout root as
its first argument.

## Key measured results

**a404cf0 vs 266060a (both free_baseline_v3):** zero mean changes on all
14,016 rows; zero quantile changes attributable to the commit (313 quantile
diffs appeared, but the identical 313 rows differed between two runs of the
SAME commit — ambient nondeterminism from the unordered league scan, fixed
in 5eb7696); 426 rows of versusOpponent metadata changed (the ungated
contradiction check), zero in the control.

**v3.1 determinism (the fix's proof):** two full replays at `2c52e0f`
differ on 0 of 14,016 rows across all nine fields. Pre-fix ambient
divergence was 313 rows (late-season weeks: 2024 w10+, 2025 w12+, where the
league scan went parallel).

**v3 -> v3.1 median-delta gate** (mean equality is NOT point-output
equality: production `points` is the sampled median, and the version string
feeds the simulation seed):

- means: 0 of 14,016 changed;
- medians: 4,714 changed (33.6%); |delta| p50 0.73, p90 3.05, max 23.20 pts;
- within-week-position ranking inversions: 35,326 of 656,376 comparable
  pairs (5.38%);
- synthetic first-16 rosters: 11 of 34 roster-weeks pick a different
  lineup; mean regret 12.52 -> 12.23;
- paired metric deltas (identical cohorts): MAE -0.014, RMSE -0.017,
  rho +0.0004, pairAcc -0.0011, regret -0.29, coverage -0.0009.

All deltas are mixed-sign and inside the re-roll noise band: no systematic
accuracy change. Note for future sweeps: 5.38% pair inversions / ~0.3
regret between two equally-valid draws of the SAME model is the measured
noise floor of these metrics as instrumented — margins below it (e.g. the
+0.002 pairAcc that selected usage-25) are unresolvable without common-seed
serialized arms.

**Performance:** league-scan ORDER BY cost nil (median 1488ms with vs
1551ms without, network-dominated, 7,369 rows); invalidation DELETE plans
as an index scan on `projection_runs_season_week_index` with `season =` and
`week >=` as index conditions; cold-cache `generateProjections` ~2.8s for a
401-player week (pre-existing bundle-load cost).

## Open items recorded at release time

- Stranded `free_baseline_v3` (and older) rows in `projection_runs` are
  unreachable but not deleted. Deliberately deferred until the rollback
  window closes; then record row count/storage and do one narrowly scoped
  cleanup.
- 2026 prospective holdout: freeze BEFORE any experimentation — append-only
  pre-kickoff predictions and inputs; mutable cache rows are not an
  evaluation ledger.
- Harness rebuild (point-in-time cohorts, stored historical team context,
  valid rosters) must precede the frozen usage-0/25/40/60 + placebo sweep.
- Known non-blocking races: concurrent generation can recreate a run after
  invalidation with pre-correction inputs (needs advisory locking or an
  input-revision check); partial nflverse sync lacks week-level atomicity.
