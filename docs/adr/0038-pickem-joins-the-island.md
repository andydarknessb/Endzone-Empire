# Pick'em joins the island

Status: accepted (2026-09-11)

ADR 0031 moved Game Center and Matchup Detail into the local Feature-Sliced
Design island and ADR 0037 moved Lineup; Pick'em (`src/components/LeaguePickem`
and the two hooks under `src/hooks`) is the last weekly manager surface still
outside it, and in a pick'em league it is the whole game. The 2026-09-11
redesign (design canvas under `docs/design/pickem/`, artifact b17586c6) found
the board gives a manager nothing to decide with: two abbreviations in a toggle,
a kickoff time, and a confidence dropdown, while the server already snapshots
the Line every hour, the forecast every horizon, and the Situation every
thirty seconds for other pages.

We decide that the island now covers Pick'em. It becomes a page slice
(`src/pages/pickem`) composed from widget and feature slices that read only
`entities/pickem-game`, `entities/pickem-standings` and `shared`. ADR 0020's
import rules and ADR 0029's entity rules bind unchanged. The old folder and
hooks are deleted with their tests; there is no shim (the ruling on #1246).

The slices, in the order the spec's tickets deliver them:

- Entities: `pickem-game` (the slate, picks, lock and phase, plus the Line,
  weather, Record, Venue, Broadcast, Situation and final extras a game
  carries) and `pickem-standings` (rank ties, accuracy, best week, trend).
- Features: `pick-winner`, `rank-confidence`, `save-picks`; `pick-week` is
  reused from ADR 0031.
- Widgets: `pickem-board` (kickoff-window groups of game cards and the save
  bar), `pickem-standings`, `pickem-settings`.
- Page: `pickem`, on the existing `/league/:leagueId/pickem` route.

Rulings recorded on the spec that shape the slices:

- Other managers' picks are revealed at lock and never before. Before lock a
  card shows only how many managers have picked, never which way; the split
  appears once the game is locked. The service's locked-only filter is not
  widened.
- "Insight" is not a term. A game carries the glossary's nouns as separate
  optional fields (`line`, `weather`, `venue`, `broadcast`, `records`,
  `situation`, `linescores`, `headline`), each absent when its source has
  nothing, and the card renders nothing for an absent field. Picks never
  depend on any of them.
- The Line is the newest `game_odds_snapshots` row for the game; the favorite
  is derived from the spread's sign at read time. No new odds table.
- Weather comes from the existing forecast snapshots, not from ESPN's
  scoreboard summary, so wind and precipitation chance can be shown.
- Record, Venue and Broadcast are columns on the live game row, written by the
  hourly Line Sync run; win probability, linescores and the headline are
  columns on the same row, written by the thirty-second poll. Nothing on the
  client calls ESPN.
- Kickoff times render in the viewer's zone through `shared/lib/kickoff`;
  kickoff-window labels are zone-independent.
- Team marks are team-colour monograms, not hotlinked logos.
- Confidence is chosen from a per-card menu of 1 to N with ranks already used
  disabled, matching the server's validation; the UI never says "rank".

Consequences: a fourth surface on the `dash-*` tokens, Barlow Condensed and
Archivo, which makes the app tokens the minority on league pages and brings
the "merge or diverge" question in `tokens.js` closer; five new nullable
columns and one JSON column on `live_game_states`; and the Pick'em week
endpoint grows from four fields per game to a dozen, all optional.
