# ESPN facts client fixtures (#1308)

Captured through the IC's researcher worker (ADR 0010 decisions 1 and 3; #1308
Ruling item 2 and its two amendments), never hand-written. The researcher's
reply carried only path/status/bytes/sha256 for each file — never the
payload — and the IC compared that sha256 against its own copy before
committing (a mismatch would have been a failed capture, not a fixture).
Athlete: Drake Maye, ESPN athlete id `4431452` (New England Patriots QB, a
real active NFL athlete as of capture time). Team: NE (ESPN numeric team id
17).

## athlete-profile.json

- URL: `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/4431452`
- Captured: 2026-09-15T01:34Z (researcher-reported, UTC)
- HTTP status: 200
- Bytes: 71334
- sha256: `5a7613d0ba416a8df89f564764641421c6931bd7626f3761d28c1bf3f8e59094`
- Athlete id: 4431452
- No trim.

## athlete-overview.json

- URL: `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/4431452/overview`
- Captured: 2026-09-15T01:34Z (researcher-reported, UTC)
- HTTP status: 200
- Bytes: 173911
- sha256 (pre-trim, as captured): `7a615562020a0cf21c4b13ac7bacc9145c6c6c8d2a275d34ea7ac7e1f37f05ff`
- sha256 (post-trim, the committed file): `06d9e4fdc1441672f2e033c3db6e07ce7541f8c06f155a4be92c40cd49fe1aaa`
- Athlete id: 4431452
- Trim: `news[]` cut to its first 5 entries (was 13). No other change.

## team-depth-chart.json

- URL: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/17/depthcharts?lang=en&region=us`
  (ESPN's core API needs a numeric team id and an explicit season segment;
  `.../teams/17/depthcharts` with no season 404s. Team id 17 = New England
  Patriots.)
- Captured: 2026-09-15T01:44Z (researcher-reported, UTC)
- HTTP status: 200
- Bytes: 20213
- sha256: `2e92e044bc3a4d2f737aa545cdcac910257e5e330ac400a01460c9c61079c878`
- Team: NE (numeric id 17)
- No trim. The three charts (`Base 3-4 D`, `Special Teams`, `3WR 1TE`)
  inline each position slot's rank; the individual athlete objects are
  `$ref` links (not fetched — the top-level document already carries what
  the sync job needs: position, slot, rank, and the athlete id embedded in
  each `$ref` URL).

## fantasy-player-info.json

- URL: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/1?view=kona_player_info`
  with header `x-fantasy-filter: {"players":{"filterIds":{"value":[4431452]}}}`
- Captured: 2026-09-15T01:35Z (researcher-reported, UTC)
- HTTP status: 200
- Bytes: 46697
- sha256: `ec3ddc3179f39903b4031ebbfa15fbb84dabceb68cc1acdce32124a034a128d5`
- Athlete id: 4431452
- No trim. One entry in `players[]`; `players[0].player.ownership` carries
  `percentOwned`/`percentStarted`/`percentChange` — the daily Ownership
  sync's source. `players[0].player.draftRanksByRankType` and the
  `rankings` block are ESPN's own projection/ranking data and are never read
  onto the card (ADR 0041).
