# Hindsight reads the week as played

Status: accepted (2026-09-02)

Hindsight compares what a team started in a settled week with the best legal
lineup it could have started, and the weekly recap names the league's worst
such gap as its bench blunder. Until now hindsight ran that comparison over
every lineup row of the week with no tenure exclusion at all: neither the
own-kickoff rule the score of record applies (#228, ADR 0006) nor best ball's
last-kickoff bound (#635, ADR 0022). Its "actual" was also read off the slots
the rows happened to carry, which in best ball, where every row sits on the
bench, made a team's entire optimal show as points left there.

So a standard-league manager who picked a player up on Monday, after his
game, was told he left that player's points on a bench he could never have
started from, and in best ball, where the optimal lineup IS the score of
record, the number on the matchup page contradicted the settled score for any
team that churned after a kickoff (#736).

We decide that hindsight reads the week as played: the same population the
settle pass counts, through the same helper, with both exclusions. A player
the score of record did not count cannot have been left on the bench. In
best ball the lineup that scored is the best lineup available, so a team's
actual is its score of record and nothing is ever left on the bench; the
recap's blunder pick therefore never names a best-ball team.

## Considered options

- **Read the settle population (chosen).** One helper beside the tenure
  predicates in the lineup module; the settle pass, the re-score of a final
  week and hindsight all call it. The scoring module already refuses a
  second population that merely happens to agree with the first, and
  hindsight was exactly that second population.
- **Refuse best ball with a 409, as start/sit advice does.** Rejected. Start/sit
  refuses best ball because there is no decision to advise; hindsight has a
  legitimate best-ball reading, the lineup that scored. It would also have
  left the standard-league gap above open, and blanked the matchup page's
  bench line and the lineup page's season bench total in best-ball leagues.
- **Leave it, documented as a supplementary stat.** Rejected: a number that
  contradicts the score of record on the same page is not supplementary, it
  is wrong.

## Consequences

- Standard-league hindsight changes for any team that had a post-game pickup
  that week: he leaves the optimal lineup, as he left the score of record.
- A best-ball team's hindsight reports actual equal to optimal and zero left
  on the bench. The matchup page hides the bench line in best ball rather
  than printing a zero that carries no information.
- The population helper is the one place both exclusions live. A new reader of
  a settled week calls it or is wrong; it does not ask the predicates itself.
- Pricing is NOT decided here. Hindsight still reads the stored per-player
  points, which are written under the default scoring rules, while the settle
  pass prices under the league's. In a custom-scoring league the two can
  still differ by pricing alone; that is #739 and needs its own ruling.
- ADR 0022's last consequence is amended to point here.
