# The next engine version is gated on the 2026 holdout ledger

Status: accepted (2026-09-15)

The week 1 2026 audit of Endzone Forecast (free_baseline_v3.1) found the
engine performing as its 2024/2025 backtest predicted (Spearman .59, pairwise
accuracy .71, 80% interval coverage .85 on the half-PPR Survivor cohort) and
named four engine changes worth making: count only Appearances when
averaging a player's production, derive an Appearance probability from Game
status and recent Appearances instead of the current all-or-nothing value,
give a player with no history an ADP-derived prior instead of no projection,
and price kickers from their team's scoring rather than their own recency.
Each is a Model version change. The holdout-confirm-2026 study is sealed on
v3.1, and its evaluator drops any captured week whose constants hash
disagrees with the majority, so a mid-season deploy of any of them would
throw away the very weeks that could judge it.

We decide that these changes ship together as one successor version after
the 2026 week 18 capture closes, and that the successor is accepted only if
it beats v3.1 on the 2026 holdout ledger: re-projecting the ledger's Survivor
cohort for weeks 1-18 from the same pre-kickoff inputs the captures recorded
and comparing MAE, Spearman rho, pairwise accuracy and interval coverage on
the three captured scoring profiles. The 2024/2025 reconstructed backtest
remains a secondary check, never the gate. A successor evaluation script is
part of the successor's work, not an afterthought.

## Considered options

- **Gate on the 2026 holdout ledger (chosen).** The ledger exists so a
  successor can be scored against predictions that were sealed before any
  outcome existed. Its Survivor cohort is the population the engine actually
  serves, and its inputs were frozen at capture, so the comparison cannot be
  tuned on its own test set. Costs a season of waiting and the evaluation
  script.
- **Gate on the 2024/2025 backtest, as v3.1 was.** Immediate, but the rev-38
  study documented that cohort's survivorship and the tuning-on-the-test-set
  problem, and every candidate constant was already selected on those two
  seasons. A successor chosen there has no untouched evidence behind it.
- **Ship each change mid-season as its own version.** Fastest feedback, and
  each change is small. Rejected because the sealed study is measuring v3.1;
  every constants change drops captured weeks under the evaluator's majority
  rule, so the season's evidence would be spent on nothing.

## Consequences

- No Model version change ships before the 2026 week 18 capture, whatever
  the audit finds in later weeks; findings accumulate on the successor's spec.
- Data corrections that do not change the engine (a fabricated stat row
  removed, a stale team cleared) may ship in season and are recorded in the
  study's DEVIATIONS.md as input corrections touching no gate.
- The successor's acceptance numbers are the ledger's, so the ledger's
  Survivor rules (no late capture, no schedule-invalid week) bound what the
  successor can be judged on; a season with too few Survivors leaves the
  successor unjudged, not approved.
