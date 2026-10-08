# Editorial: the weekly flow

The Weekly Darkness Report (start/sit) is written from facts in the database and rulings written by Cory. Nothing is invented between the two.

## Weekly flow

1. **Dump, Wednesday**, after the ~00:19Z scheduled projection capture has landed:
   `node scripts/editorial/dump-week.js --season 2026 --week 6 --out <path.json>`
   Read-only. Season and week default to the upcoming season and the first week whose last kickoff is still ahead. The document has nine sections: `games`, `projections`, `usage`, `depthChart`, `injuries`, `dst`, `idp`, `fpa`, `meta`. Points are PPR. Team codes are normalised to WAS everywhere except `game_key`, which keeps WSH as the opaque odds/weather key (e.g. `2026_06_DAL_WSH`). Exit code 2 with a stderr warning means there was no scheduled snapshot to read.
2. **Rulings file**, written by Cory: `docs/editorial/week<N>-rulings.md` (contract below).
3. **Writer** turns the dump and the rulings into the article and a calls file.
4. **Calls file is committed before the first kickoff** of the week, so the calls are on record before any result.
5. **Tuesday scorer**: `node scripts/editorial/score-calls.js --calls <path>` scores the calls against actual points and the engine's own pre-kickoff PPR read.

No article or calls file is produced without the rulings file.

## Rulings file contract

Path: `docs/editorial/week<N>-rulings.md`. Three sections.

### `## Rulings`

One line per ruling:

```
C1: Lamar Jackson (QB, BAL, #1234) - START if active - Cleared Friday, Cincinnati allows the most QB points per game
C1: Huntley (QB, BAL, #4321) - SIT - Backup, only plays if Lamar is out
C2: Dorian Thompson-Robinson (QB, CLE, #5678) - SIT - Third string, no snaps
```

Format: `<id>: <name> (<position>, <team>, #<playerId>) - <verdict> - <reason>`. The angle brackets in this prose are placeholders, not literal text.

- `<verdict>` is exactly one of `START`, `FLEX`, `SIT`, `OUT`, optionally followed by the literal words `if active` (the first C1 line has the condition; C2 has none).
- Positions allowed in calls: `QB`, `RB`, `WR`, `TE`, `DEF` only. Kicker and IDP rulings are article-only and never become calls.
- An id may repeat across lines when one ruling covers two players (the two C1 lines above).

### `## Injury flags`

The ids (C1, C2, ...) whose verdict is injury-driven. Each becomes `"injury": true` in the calls file; every other call is `false`.

### `## Tiers`

Per position, ordered lines: `<rank>. <name> (<team>, #<playerId>)`. These become `rankings` in the calls file.

## Calls file contract

The consumer is `scripts/editorial/score-calls.js`. The writer emits this header exactly:

```json
{
  "season": 2026,
  "week": 6,
  "article": "week6-start-sit-darkness-report",
  "scoring": "ppr",
  "cutoffs": { "QB": 12, "RB": 24, "WR": 30, "TE": 12, "DEF": 12 },
  "rankings": { "QB": [{ "rank": 1, "name": "Lamar Jackson", "playerId": 1234 }] },
  "calls": [
    { "id": "C1", "name": "Lamar Jackson", "position": "QB", "playerId": 1234, "verdict": "START", "condition": "if active", "injury": true }
  ]
}
```

- `article` is `week<N>-start-sit-darkness-report`. `scoring` is always `"ppr"`; the cutoffs are the #1928 method.
- Call fields: `id`, `name`, `position`, `playerId`, `verdict`, `condition` (`"if active"` or `null`), `injury` (boolean).
- `rankings` has one array per position from `## Tiers`, each entry `{ rank, name, playerId }`.
