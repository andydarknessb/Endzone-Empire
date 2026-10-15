# Production data state

What production (Supabase project `ircshoclesozpqqjafhf`) actually contains,
so an agent's query against it is read correctly.

## Measured 2026-08-23

Per issue #205's approved measurement, dated 2026-08-23:

| Table | Row count |
|---|---|
| `leagues` | 15 |
| `team_players` | 0 |
| `lineup_entries` | 0 |
| `waiver_players` | 0 |

Leagues exist, so league-shaped queries can still be answered against
production. `team_players`, `lineup_entries` and `waiver_players` are empty:
no roster-shaped behavior (draft results, lineup sets, waiver activity) can
be verified there as of this date.

## Deleted 2026-10-02: 156 snap-only Stat lines (#1762)

On 2026-10-02 at 16:32Z, 156 `player_stats` rows were deleted from production
in one transaction. All were season 2026, week 2.

**Predicate.** Every 2026 row with `fantasy_points = 0` whose every `stats`
key is one of the 17 unscored keys below:

```sql
SELECT count(*) FROM player_stats ps
WHERE season = 2026 AND fantasy_points = 0
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_object_keys(ps.stats) k
    WHERE k NOT IN ('usageOffenseSnaps','usageOffenseSnapPct','usageDefenseSnaps','usageDefenseSnapPct',
                    'usagePassAttempts','usageCompletions','usageCarries','usageTargets','usageAirYards',
                    'usageTargetShare','usageAirYardsShare','usageWopr','epaPassing','epaRushing','epaReceiving',
                    'gameTeam','gameOpponent'));
```

**Counts.** 156 rows matched before the delete, all in week 2. 156 were
deleted (ids within 466842 to 467995). 0 match afterwards. The week 2 2026
row total went from 1205 to 1049.

**What the rows were.** Each held exactly the four snap keys
(`usageOffenseSnaps`, `usageOffenseSnapPct`, `usageDefenseSnaps`,
`usageDefenseSnapPct`) and nothing else; 95 recorded at least one offensive
or defensive snap and 61 recorded none. By position: TE 35, LB 31, CB 25, S
18, DT 15, DE 14, WR 12, RB 5, DB 1. Three fantasy lineup entries that week
held one of these Players, all on a bench; none was in a starting slot.

**Why.** The snap pass created Stat lines from unscored keys alone on its
first production run (2026-09-28), contrary to the #1706 ruling. The Stat
line write (#1760, released 2026-09-29) fixed the writer: the snap source
patches an existing line and never creates one, so the rows cannot come
back.

**Also.** A backup of the deleted rows is held outside the repository.
Cached `projection_runs` were not invalidated; the next Tue/Wed
stat-correction pass invalidates and refills them from each live league's
current week onward (week 4 onward while the live leagues sit on week 4).
The holdout study records the delete as
`backtest-artifacts/holdout-confirm-2026/DEVIATIONS.md` entry 6.

## Rules

A zero from this database is evidence that nothing is there, not evidence
that anything works. Rosters are unpopulated right now, so a query touching
`team_players`, `lineup_entries` or `waiver_players`, or anything joining
through them, returns zero regardless of whether the code is correct. Only a
non-zero base population lets a zero result mean "checked and not found"
instead of "nothing here at all."

**Report the base-table count too.** Anyone granted production reads,
looking for a specific row, should report the row count of the base
population alongside the count of what they searched for (e.g. "0 of 15
leagues have a `team_players` row" instead of just "0 rows found"). That
makes a zero result self-diagnosing.

This table drifts as the app is used. Re-measure, with approval, before
relying on it if the date above is stale for the question at hand.
