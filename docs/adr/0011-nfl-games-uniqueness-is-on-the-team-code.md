# nfl_games uniqueness is enforced on the team code, not the raw code

Status: accepted (2026-08-26)

`nfl_games` holds one row per NFL team per week, and its only uniqueness
constraint is on the raw team code: `(season, week, nfl_team)` as Tank01
spells it. Every consumer that joins `nfl_games` to `players` now folds both
sides through `fn_normalize_nfl_team` (#227, #287), because the two columns
speak different vocabularies (`WSH` in the schedule, `WAS` or a full team
name in `players`; see Team code and Raw team code in CONTEXT.md). Folding is
correct, and it introduced an exposure the raw comparison did not have: a
legacy `WAS` row sitting beside a `WSH` row for one team-week folds into one
key and double-counts at every folded site, where before it matched at most
one of them.

The decision: uniqueness on `nfl_games` is on the team code. A unique index on
`(season, week, fn_normalize_nfl_team(nfl_team))` is added beside the raw
constraint, so the database rejects the second spelling at insert time
instead of leaving four call sites to trust that no writer ever inserts an
alias. The raw constraint stays: it is the `ON CONFLICT` arbiter the schedule
writers upsert against, and the functional index is strictly tighter, so
keeping both changes nothing for a canonical writer.

## Why

Four sites rest on the same unstated invariant, "no writer inserts an
alias": `bye.service.js` (`computeByeWeeks`), `digest.service.js` (the on-bye
join), `projectionFeatures.js` (the league scan's defense key) and
`projection.service.js` (`getPositionDefense`). #320 counted three and asked
whether the answer is an index or a note at the constraint. A note records the
dependency; it does not enforce it, and the failure it would describe is a
silent double-count in a projection aggregate, which is the shape of defect
nobody notices from the output. The function is declared `IMMUTABLE` and
`PARALLEL SAFE`, so Postgres accepts it in an index expression, and the
`players` table already carries a functional index on the same expression, so
the pattern is established in this schema.

The index is safe to add today. Read from production on 2026-08-26: 1,632
`nfl_games` rows, zero team-weeks that collide under the fold, and the only
raw code that differs from its team code anywhere in the table is `WSH`
(both `nfl_team` and `opponent`). A migration that creates the index will not
fail on existing data.

Two alternatives were considered. Folding the writers so `nfl_games` stores
team codes was rejected: the schedule speaks Tank01's vocabulary by design,
the ESPN clock and Tank01 game ids key on that spelling, and rewriting live
rows is a larger change with its own consumers to re-verify. The note-only
option was rejected for the reason above.

## Consequences

- A hand-inserted or third-party row that spells a team differently from the
  row already present for that team-week fails with a unique violation. That
  is the intended behaviour; the alternative was a silent double-count.
- The raw unique index and the writers' `ON CONFLICT (season, week, nfl_team)`
  upserts are unchanged. A canonical writer never trips the new index.
- `getPositionDefense` still keys its map by the raw `opponent`, and
  `decision.service.startSitAdvice` still looks it up with a raw opponent
  read from the same table. That pairing is raw-on-raw by one writer's
  spelling and remains deliberate; it is recorded at both sites (#320), not
  changed here.
- Migrations are a carve-out: the maintainer merges, applies and verifies
  `knex_migrations`, and does not stack this with another migration on the
  same night.
