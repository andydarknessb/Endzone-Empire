# League-scoped readers price under the league's rules

Status: accepted (2026-09-02)

`player_stats.fantasy_points` is written by the box-score sync with
`calculateFantasyPoints(stats)` and no league in scope, so it is the
DEFAULT-rules price of every player-week, the same for every league. The
settle pass never reads it: it prices each counted row with
`calculateFantasyPoints(row.stats, rulesForLeague(league))`, which is how a
custom-scoring league earns its own score of record. But three league-scoped
readers took the stored column as if it were league-priced: hindsight
(`weekHindsight`, and through it `seasonHindsight` and the recap's bench
blunder), the live what-if (`liveWhatIf`), and the recap's waiver steal (a SQL
`ORDER BY` on the column).

In a league whose rules differ from the defaults (full PPR, six-point passing
TDs, IDP, custom DEF tiers, anything) every one of those numbers disagreed
with the score of record on the same page. It was not only the total: hindsight
feeds `optimalLineup` a different per-player price than the settle pass counted,
so it could name a different SET of optimal starters, and the waiver steal
could crown a different player, than the league's own rules choose. ADR 0023
decided hindsight's population and left this pricing question open, pointing
here.

We decide that a league-scoped reader prices `player_stats.stats` under
`rulesForLeague(league)`, the identical formula and rules object the settle
pass uses for that league, through the one pricer in the scoring module. A
player-week with no `player_stats` row prices at 0, as the old `COALESCE` did.
There is no second pricing that happens to agree: the readers call the same
`calculateFantasyPoints` the settle pass does. In a best-ball league with
custom rules, hindsight's actual (which equals its optimal, ADR 0023) equals
the score the settle pass wrote.

`player_stats.fantasy_points` stays what it is - the default-rules price,
written with no league in scope - and is never presented as a league's number.
Surfaces with no league in scope may read it and say so: public player pages,
the Game Center top performers (NFL-game-scoped, documented as default
scoring), projection baselines and season position rank all keep reading the
column deliberately.

## Considered options

- **Price `stats` under the league's rules (chosen).** The score of record and
  its advisors are one number under one rules object. The readers select
  `player_stats.stats` and call the settle pass's pricer; the waiver steal
  becomes a pure `pickWaiverSteal(rows, rules)` over the week's pickups,
  losing its SQL ordering on the column.
- **Keep reading the column and relabel the surfaces as "default scoring".**
  Rejected, for the reason ADR 0023 rejected the same option for the
  population: a bench or steal number that contradicts the score of record on
  the same page is wrong, not supplementary.
- **Add a per-league points column to `player_stats`.** Rejected: a second
  stored number to keep in sync with `stats` and with the rules, and a
  migration on a shared production table, to cache what one pricer already
  computes from data the readers already load.

## Consequences

- In a custom-scoring league, hindsight, the live what-if and the waiver steal
  change to the league's own numbers; in a default-scoring league (the column
  and the rules agree) nothing changes.
- The live what-if prices the in-progress week from the same `stats` jsonb the
  box-score sync refreshes every few minutes alongside the column, so the live
  advisor moves on the cadence it does today.
- Weekly DEF rows are priced directly, as the settle pass already prices them.
  The `hasTeamDefenseTiers` guard is for SEASON AGGREGATES of DEF stats and is
  not in this path.
- No client change: Matchup Detail's bench line, the Lineup screen's season
  bench total and the Recap card render whatever the API returns.
- The stored `fantasy_points` column is unchanged, and the box-score sync still
  writes it. It remains the default-rules price and the source for the
  no-league-in-scope surfaces named above.
- ADR 0023's open pricing consequence is amended, append-only, to point here.
