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

Leagues and teams exist, so league- and team-shaped queries can still be
answered against production. `team_players`, `lineup_entries` and
`waiver_players` are empty: no roster-shaped behavior (draft results, lineup
sets, waiver activity) can be verified there as of this date.

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
