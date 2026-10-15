# Editorial: the weekly flow

The Weekly Darkness Report (start/sit) is written from facts in the database and rulings written by Cory. Nothing is invented between the two.

## Weekly flow

1. **Dump, Wednesday**, after the ~00:19Z scheduled projection capture has landed:
   `node scripts/editorial/dump-week.js --season 2026 --week 6 --out <path.json>`
   Read-only. Season and week default to the upcoming season and the first week whose last kickoff is still ahead. The document has nine sections: `games`, `projections`, `usage`, `depthChart`, `injuries`, `dst`, `idp`, `fpa`, `meta`. Points are PPR. Team codes are normalised to WAS everywhere except `game_key`, which keeps WSH as the opaque odds/weather key (e.g. `2026_06_DAL_WSH`). Exit code 2 with a stderr warning means there was no scheduled snapshot to read.
2. **Rulings file**, written by Cory: `docs/editorial/week<N>-rulings.md` (contract below).
3. **Writer** turns the dump and the rulings into the article and a calls file.
4. **Calls file is committed before the first kickoff** of the week, so the calls are on record before any result. It lives beside the article: `src/content/articles/week<N>-start-sit-darkness-report.calls.json`.
5. **Tuesday scorer**: `node scripts/editorial/score-calls.js --calls src/content/articles/week<N>-start-sit-darkness-report.calls.json` scores the calls against actual points, the frozen capture's PPR read and the served Start verdict (rebuilt, see below). `node scripts/editorial/score-calls.js --all` scores every `week<N>-start-sit-darkness-report.calls.json` and prints the season ledger: one line per week, season totals (editorial / capture / served, method and injury calls) and the n-weighted per-position rank correlation. A week with no scheduled capture or no `player_stats` rows yet is skipped. `--json` works with both modes.

No article or calls file is produced without the rulings file.

## Served (rebuilt) column

Nothing persists the Start verdict the app served at kickoff (`lineup_overrides` stores a swap band per pair, `projection_snapshot_players` has no practice input), so `score-calls.js` rebuilds it read-only, in the same `BEGIN READ ONLY` transaction, for every row of the capture (the ranking needs the whole pool). It mirrors `startVerdictFor`:

- As of = the earlier of the row's frozen `game_kickoff_at` minus 60 seconds (`ADVICE_LEAD_MS`, lineupOverride.service.js) and now.
- A capture row whose stored availability is not available passes straight through (`startVerdictOf` of the stored verdict). Every other row gets `startVerdictOf(unavailableFor(...))` with the capture's `injury_status`, the Position-baseline marker from `factors.dataQuality.reasons`, the Backup quarterback fact (`backupQuarterbackIds` over QB depth chart rows captured within the 3 days up to the as-of date) and that player's `player_practice_observations` rows seen by the as-of instant.
- The latest observation's `report_status` replaces the capture's status only when that status is null or a game designation (Questionable, Doubtful, Out): a report replaces it, a null report means no designation. Roster statuses (IR, suspended, PUP) always stand.
- Served call per player: unavailable or not recommended is SIT; recommendable is START when the capture's point estimate (the number stands, ADR 0056) ranks inside the position cutoff among the capture rows not served unavailable, else SIT.

Known gaps: `report_status` is nflverse's game designation, while the live served read uses the ESPN-fed `players.injury_status`, so mid-week (before nflverse publishes designations) a Questionable player reads as no designation and never reads `no_practice`; practice observations start 2026-10-02, so earlier weeks show no `no_practice`; the Backup quarterback check reads each QB's current `players` team and injury status, not the as-of values.

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
  "rankings": { "QB": [{ "rank": 1, "name": "Lamar Jackson", "team": "BAL", "playerId": 1234 }] },
  "calls": [
    { "id": "C1", "name": "Lamar Jackson", "position": "QB", "playerId": 1234, "verdict": "START", "condition": "if active", "injury": true }
  ]
}
```

- `article` is `week<N>-start-sit-darkness-report`. `scoring` is always `"ppr"`; the cutoffs are the #1928 method.
- Call fields: `id`, `name`, `position`, `playerId`, `verdict`, `condition` (`"if active"` or `null`), `injury` (boolean).
- `rankings` has one array per position from `## Tiers`, each entry `{ rank, name, team, playerId }`.
