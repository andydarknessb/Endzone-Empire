# Lineup joins the island

Status: accepted (2026-09-11)

ADR 0031 moved Game Center and Matchup Detail into the local Feature-Sliced
Design island; Lineup (`src/components/LineupScreen`, `TeamLineup`) is the
last league surface a manager visits every week that still lives outside it.
The 2026-09-11 redesign (design canvas under `docs/design/team-lineup/`,
artifact d62b62b9) found the page answers "who is in which slot" but not "why
start him": rows carry no game state, no interval, no opponent factor, and
the bye-clustering warning has been a TODO in the component since the
guardrail was written. Managers stitch that context together from other
tabs, or do not.

We decide that Lineup becomes a page slice (`src/pages/lineup`) composed
from widget and feature slices that read only `entities` and `shared`, and
that the legacy pages and their tests are deleted with it, as ADR 0031 did,
rather than shipped beside it behind a flag. The nav item is renamed from
Roster to Lineup; the route `/team` stays.

Rulings that shape the slices:

- **The lineup entry carries its decision context.** `GET /api/team/lineup`
  entries gain projection, Floor (p10), Ceiling (p90), kickoff, game key,
  opponent Team code and a typed Edge line (`{ kind, text }`), computed on
  the server. The Edge line's priority rule needs FLEX eligibility, which
  lives in the server's roster slot rules and is not copied to the client.
  Every league type gets the same row; best ball, which never calls the
  advice endpoint, is why the entry carries these rather than the advice
  payload. Advice stays the suggestions endpoint, and applying advice means
  making exactly the moves it names, never a full re-assignment.
- **The Decision card fetches on open.** Line, weather and Usage are read
  when a manager opens one player's card, not joined into the page payload.
- **Situation rides `live_game_states`.** The 30-second scoreboard poll
  already reads ESPN's scoreboard; it now also reads
  `competitions[].situation` (possession, down and distance text, red zone
  flag, last play text) into four columns on the same row. That table is the
  anon Realtime surface ADR 0009 confined anon to; these columns widen what
  it carries, not who may read it, and none of them is sensitive.
- **The Line is an ESPN provider behind the existing odds seam.**
  `game_odds_snapshots` and its provider seam exist with a no-op
  implementation. An ESPN scoreboard `odds[]` provider fills it as its own
  hourly Sync run (ADR 0036) over the week's slate. Implied team total is
  derived from the newest Line on the Decision card only.
- **Weather is the NWS snapshot, not ESPN's string.** The snapshot with the
  shortest horizon for the game; indoor comes from `nfl_games.roof`.
- **Usage v1 is what nflverse weekly already gives**: targets, carries, air
  yards, target share and fantasy points for the last three weeks beside the
  season average. Snap counts wait for a snap feed and are a follow-up, not a
  blocker. There is no news column and no news panel.
- **No live region on Lineup rows.** Game cells change every thirty seconds
  across nine rows; the only announcement stays the swap result. A reader
  who wants the score reads the summary strip (cf. ADR 0028).

## Considered options

- **Page slice replaces the legacy pages (chosen).** One entry point, tests
  move with it, every lineup bug is found on one surface.
- **Ship the slice beside LineupScreen behind a flag.** Rejected: doubles the
  surface for the season's most-visited page, and ADR 0031's deletion has
  held.
- **Client derives projection, interval and Edge line from the advice
  payload.** Rejected: best ball never calls advice, the FLEX rule would be
  copied to the client, and desktop, mobile and tests would each re-derive
  the same line.
- **A separate `live_game_situations` table.** Rejected: a second Realtime
  channel for four columns that change on the same poll as the clock.
- **A paid odds API, or no Line at all.** Rejected: ESPN's scoreboard carries
  the spread and total at the same price as the clock; without a Line the
  implied team total, the number managers actually reason from, has no
  source.

## Consequences

- Copy that says "optimal" on the best-ball layout goes with the legacy page;
  the glossary now avoids it in user-facing copy.
- `live_game_states` gains four nullable columns behind its own migration
  cycle (one carve-out at a time).
- The Roster Management presentation entry in CONTEXT.md is superseded by
  Ledger row; Game cell, Edge line, Decision card, Bye cluster, Floor and
  Ceiling, Situation, Line and Usage are new terms.
