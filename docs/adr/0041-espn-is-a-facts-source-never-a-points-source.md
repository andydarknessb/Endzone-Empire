# ESPN is a facts source, never a points source

Status: accepted (2026-09-12)

The Decision card's availability contexts (ADR 0040) want facts the repo does
not hold: age, height, college, draft slot and experience; the injury type,
practice note and expected return behind the designation; a dated news list;
depth-chart rank; and Ownership, the share of public ESPN leagues rostering a
player with its seven-day change. ESPN's unofficial, keyless endpoints carry
all of them (`site.web.api.espn.com` athlete v3 and its `/overview`, the team
depth charts, and `lm-api-reads.fantasy.espn.com` player info with
`ownership.percentOwned`), and `players.external_id` already is the ESPN
athlete id (ADR 0035), so no id mapping is needed. The same fantasy endpoint
also carries per-week projected points.

We decide that ESPN supplies facts about a player and never points. Bio,
injury detail, news, depth chart and Ownership are read from ESPN; every
projected number on the card, the bars, Rest of season and Upgrade comes from
the Weekly projection. ESPN's projections are not read, not blended and not
shown as a second opinion. The injury designation stays the feed sync's
(Tank01) and ESPN fills only the detail line beneath it. Calls are server
side only through one client (`server/modules/espnAthleteClient.js`), plain
axios like the scoreboard and never through `tank01Client`, cached in the
resource cache (profile and overview six hours, depth charts and Ownership a
day), with a browser user agent and referer. Ownership is pulled once a day
for the whole pool into `player_ownership` (player, captured date, percent
owned, started, change) and every daily row is kept. When ESPN fails or a
player has no facts, the tile hides and the card renders from stored fields;
nothing on the card blocks on ESPN.

## Considered options

- **Facts from ESPN, points from the engine (chosen).** The card gets the
  detail managers expect, the engine keeps one voice, and a model version
  bump remains the only way a projected number changes.
- **Blend ESPN's weekly projections into the bars where ours are missing.**
  Rejected: two producers in one chart, the holdout study cannot say which
  one was wrong, and it breaks the rule that constants change means version
  bump.
- **Show ESPN's projection beside ours.** Rejected: the glossary already
  warns that Projection alone is never precise enough; a second number is a
  second argument on every card.
- **Read ESPN from the browser.** Rejected: CORS is incidental and revocable,
  the client would carry the retry and cache logic, and a 403 on the manager's
  own network becomes a blank card.

## Consequences

- Two new Sync runs (ADR 0036): ESPN ownership daily and depth charts daily.
  Profile and overview are fetched on card open and cached, not synced.
- The glossary gains Ownership and News; Rostered remains an availability
  state and never a percentage.
- If ESPN closes these endpoints the card loses tiles, not numbers.

## Amendments

- 2026-09-13 (#1308 Ruling). "Cached in the resource cache" above names a
  client module: the resource cache is `src/lib/resourceCache.js` (ADR 0004),
  part of the browser bundle, and nothing under `server/` imports it. The
  server-side reads this ADR requires are cached as follows. Profile and
  overview: an in-process TTL map inside `server/modules/espnAthleteClient.js`,
  the `summaryCache` shape the player router already uses (key by kind and
  athlete id, `{ value, expires }`, bounded), a success held six hours and a
  failure (403, timeout, non-JSON) held five minutes as a `null` entry so a
  blocked host is not re-fetched on every card open. Depth charts and
  Ownership are not cached in memory at all: the daily Sync runs write them to
  `player_depth_chart` and `player_ownership`, and the card reads the latest
  `captured_date` row. The six-hour and one-day durations above stand; only
  the store they named changes.
- 2026-09-29 (#1766, spec #1764). A third ESPN Sync run: NFL roster status.
  The Consequences above name two runs; this makes three. Once a day, one
  request per team to ESPN's site API team roster
  (`.../apis/site/v2/sports/football/nfl/teams/{id}/roster`, read on the
  `site.web.api.espn.com` host because `site.api.espn.com` answers a
  server-side request 403), each athlete resolved through
  `players.external_id` (ADR 0035, unmatched athletes skipped). The roster's
  groups map to a status: offense, defense and specialTeam are Active,
  injuredReserveOrOut and suspended are Reserve, practiceSquad is Practice
  squad. Rows go to `player_nfl_roster_status` (player, captured date, team,
  status), one per player per day, and a second run the same day updates the
  row only when the status changed, since the Saturday run after the 4pm ET
  elevation deadline exists to record a change the morning run did not see.
  Cadence: daily and ordered before the depth-chart run, the Saturday run,
  and a run as each week's holdout capture window opens. A failed team fetch
  writes nothing for that team; every team failing fails the run, as the depth
  chart does. This is a fact and never a point: the card shows "Practice squad"
  or "Reserve" as context, Active shows nothing, and no projected number moves
  and nothing reads the status for availability yet.
