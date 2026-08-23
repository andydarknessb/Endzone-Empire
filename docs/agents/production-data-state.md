# Production data state

What production (Supabase project `ircshoclesozpqqjafhf`) actually contains,
so a query against it is read correctly.

## Measured 2026-08-23

| Table | Row count |
|---|---|
| `leagues` | 15 |
| `teams` | 31 |
| `team_players` | 0 |
| `lineup_entries` | 0 |
| `waiver_players` | 0 |

Leagues and teams exist, so league- and team-shaped queries can be answered
against production. `team_players`, `lineup_entries` and `waiver_players`
are empty.

## Rules

**Zero is absence, not a pass.** A query against an empty table (right now:
`team_players`, `lineup_entries`, `waiver_players`) returning zero rows means
nothing is there — not that the roster-shaped behavior you were checking
(draft results, lineup sets, waiver activity) is confirmed working. Only a
non-zero base population lets a zero result mean "checked and not found."

**Report the base-table count too.** Anyone granted production reads, when
looking for a specific row, must report the row count of the base population
alongside the count of what they searched for (e.g. "0 of 15 leagues have a
`team_players` row" instead of just "0 rows found"). That makes a zero
result self-diagnosing: an empty table reads differently from a real,
populated table with no match.

This table drifts as the app is used. Re-measure before relying on it if the
date above is stale for the question at hand.
