# A quarterback behind an available teammate is a Backup, never an Upgrade

Status: accepted (2026-10-03)

Case Keenum started Chicago's week 3 game for an injured Caleb Williams and
scored 24.48. That one game is real evidence, so he is no longer a
Position-baseline projection (ADR 0053), and v3.1 projects his one-game pace
with an active probability of 1: 20.25 for week 5. On 2026-10-03 the Depth
chart ranks him QB3 behind Tyson Bagent, who is available. He will not play,
yet the Upgrade reads him +4.25 over a 16-point rostered quarterback, and
Start/sit advice would start him over a real starter.

The engine has no Appearance input until v3.2 (#1438, #1441), and ADR 0044
forbids moving a number in season. ADR 0053 met the same shape by keeping the
number and changing the verdict; this does the same with the Depth chart rank.

We decide:

1. A **Backup quarterback** is a QB whose team's newest Depth chart (QB
   group, captured within 48 hours of now) ranks him behind another QB on that
   same chart who is still on that NFL team and whose Game status is not Out
   or IR. A Questionable or Doubtful QB ahead of him still counts as ahead: no
   guessed appearances. A missing or stale chart, or a player absent from it,
   reads not-Backup.
2. The verdict is the Weekly projection read's, beside Position-baseline:
   the read loads the chart once per call, `backupFor(id)` answers it and
   `availabilityFor(id)` returns `unavailableFor({ backup: true })`: available,
   never auto-recommended, reason `backup`. Precedence: bye, No NFL team,
   Practice squad, Out, IR, Position-baseline (`no_history`), then Backup,
   then Doubtful, no-practice and Questionable.
3. Every reader that branches on Position-baseline takes the same branch for
   a Backup quarterback: the Upgrade is `null` (no pill or tile, sorts last),
   Waiver Targets skip him, Start/sit advice and the Optimizer never
   auto-recommend him. Unlike Position-baseline his number is evidence, so it
   is still shown, with a "Backup" tag where Doubtful shows its tag.
   Where a lineup is valued rather than shown (Start/sit advice's optimal
   lineup and the Upgrade's roster baseline), a Backup quarterback is worth 0,
   as an Unavailable roster player is: he will not play, so a started Backup
   is advised to the bench and does not hide a real starter's Upgrade.
4. QB only. Behind a starter, a backup quarterback scores nothing; a
   second-string RB, WR or TE plays snaps.

## Considered options

- **Rank him down by Depth chart rank in the engine.** Rejected: moves a
  projected number in season (ADR 0044). That is #1924's 2027 Challenger.
- **Make him Unavailable.** Rejected: he can play if the starter is hurt in
  the game, and Keenum did.
- **Wait for v3.2's Appearance probability.** Rejected: fourteen more weeks of
  backups ranked as Upgrades.

## Consequences

- The holdout ledger and every capture are untouched: the verdict is derived
  on read, never stored.
- Depth chart rank now gates a verdict, not only a Challenger; it still never
  moves a served projection.
- A chart that lags a real promotion reads the promoted QB as a Backup for up
  to a day; the manager can still start him.
- Retires by itself once a Model version carries Appearance probability, by
  removing the read's chart load.

## Amendment (2026-10-07, #2044)

Backup now outranks Position-baseline in the reason precedence. Rule 2's
precedence line above is superseded by this one: bye, No NFL team, Practice
squad, Out, IR, Backup, then Position-baseline (`no_history`), then Doubtful,
no-practice and Questionable.

The old order was set while `backup` was a separate fact every reader could
read beside the reason, so it only decided which note showed. Under the Start
verdict (spec #2042) there is one reason per player, and it decides the zero in
a valued lineup (rule 3): a rostered QB who is both Position-baseline and
Backup reads `backup`, so he is worth 0 in Start/sit advice's optimal lineup
and in the Upgrade's roster baseline, and the Lineup wire carries
`backup: true, positionBaseline: false` for him. His number stays untrusted
either way (`numberTrusted: false`). Ruling, approved by Cory:
https://github.com/andydarknessb/Endzone-Empire/issues/2044#issuecomment-6039675475
