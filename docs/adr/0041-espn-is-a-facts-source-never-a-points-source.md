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
