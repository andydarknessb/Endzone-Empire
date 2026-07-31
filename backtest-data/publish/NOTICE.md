# Data sources and attribution

This publication is built from public, community-maintained NFL data, plus
this application's own captured schedule, stat and identifier rows. It is
Gate 3 of a rebuilt historical backtest, and it ships two things: the
derived, chunked evaluation datasets under `chunks/`, and byte-exact
archival copies of the ten pinned raw source CSVs under `sources/`, so the
study can be reproduced from a genuinely clean clone with no network
access - see "Raw source files" below and `scripts/backtest/rehydrate.js`.

Every pinned source below was fetched once and never re-fetched; the
SHA-256 values are the ones the Gate-2 extraction recorded, not values
recomputed at publication time.

## nflverse-data (github.com/nflverse/nflverse-data) - CC BY 4.0

The weekly roster, injury-report, player/team weekly-stats, and player
biographical (`players.csv`) release files are published by the nflverse
project under the Creative Commons Attribution 4.0 International license:
https://github.com/nflverse/nflverse-data/blob/main/LICENSE.md

- `roster_weekly_2024.csv` (sha256 `074ecaeb9325de943c11f7bbc941425626985090ef8386f90cd837fa5cb5d4b3`)
- `roster_weekly_2025.csv` (sha256 `c2f7a1ffebe06058400af1989d1cd2900cc5c9659f084623708a06d4e28de35b`)
- `injuries_2024.csv` (sha256 `498bce8e13cb64b2ab9bb0ad6cb81d0a63c2ddb24016c9fc90c2de2126fae449`)
- `injuries_2025.csv` (sha256 `15ee790fef634caea988e7b6562fc393a63739dd7ee38229d1b42161427709df`)
- `stats_player_week_2024.csv` (sha256 `db6379707a8d520f7fb9a90eeacd8a98ec3d5cdca8b98e0943cab5a250d91a97`)
- `stats_player_week_2025.csv` (sha256 `40b67b296fda02c7f628741d4aa471208352dd42fb670d4854e7ba95295af1a6`)
- `stats_team_week_2024.csv` (sha256 `54db70df09cd4bbce832771b74c1d0903dfc1a07406521886ce701a3386a6594`)
- `stats_team_week_2025.csv` (sha256 `e062506174b6b49ee8dac3ed64a32197017da8e831b2942499c40c2c7f3e9081`)
- `players.csv` (sha256 `4c253495a873058b1f9772b5d559087bf2e918d0ca6dc9ea1b87e1e4a1fdb0a1`)

The only transformation ever performed on these files is chunking and gzip
compression for transport; no value in any row is altered, reformatted, or
re-derived. The byte-exact copies under `sources/` are the same bytes
named above, split into fixed-size pieces and reassembled unchanged on
rehydration.

## nflverse/nfldata (games.csv) - licensing status NOT established

- `games.csv` (sha256 `9b512fecf7c73a7680006259118411c75f01b3762100f776d96400e7284a94fe`)

The schedule and score file, pinned at an exact git commit and blob SHA
(recorded in `scripts/backtest/lib/sources.js`), sourced from
github.com/nflverse/nfldata. Unlike nflverse-data above, redistribution
permission for this specific file, from this specific repository, has NOT
been established or confirmed. It is included here as a byte-exact archival
copy for reproducibility, with that licensing status flagged as unresolved,
not asserted to be fine; anyone redistributing this publication further
should treat games.csv's inclusion as pending a licensing check against
github.com/nflverse/nfldata, not as pre-cleared.

This file's own rows span 1999-2026; only the 2024 and 2025 regular-season
rows feed the evaluation store used for scoring, and the 2026 rows are
retained in the raw provenance chunk and the raw `sources/games` chunk
only - an untouched prospective holdout, never an evaluated row.

## Raw source files (sources/) and the two provenance copies

`sources/<name>/chunk-NNNN.bin.gz` holds the ten pinned raw CSVs listed
above, chunked as fixed-size raw BYTE slices of the original file - never
line-aware, never CSV-aware (see `scripts/backtest/lib/rawByteChunker.js`
for why: a direct inspection of these files found that `injuries_2024.csv`
carries a quoted field with an embedded newline, which makes a line-based
chunker unsafe for at least this file, and the fix applied to all ten is the
same either way). Reassembling a source's chunks in order, per the
`sources` array in `manifest.json`, reproduces the exact original bytes.
`manifest.json`'s `sourceChunking` block names this algorithm explicitly
so it is never confused with the line-atomic NDJSON algorithm `chunks/`
uses (`chunking`).

`source-manifest.json` is a byte-for-byte copy of the sealed Gate-2
extraction's own `manifest.json`: schema fingerprints, the SQL surface
digest, oracle settings, integrity-check results, and this snapshot's own
source provenance table - richer metadata than the derived `chunks/`
datasets alone carry. It is scanned as raw text for secrets before being
copied here, the same treatment every other file in this publication gets.

`sources-provenance.json` is a byte-for-byte copy of
`backtest-data/sources/provenance.json`, the record of exactly which
bytes were fetched, from where, and when. `scripts/backtest/rehydrate.js`
uses it, alongside `manifest.json`, to know which pinned SHA-256 each
rehydrated raw source file must verify against, and
`scripts/backtest/snapshot-checks.js`'s `makeSourceReader` can be pointed
directly at a rehydrated `sources/` directory carrying this same file.

## What this publication's captured chunks are actually built from

The `players`, `player_stats`, `player_season_stats`, and `nfl_games_*`
chunks are this application's own captured PostgreSQL rows, read under a
temporary read-only role scoped to exactly the tables and columns a formal
sanitization review approved: public sports statistics and schedule facts.
They are not generated by this repository from nothing - this app's own
data pipeline draws them from several upstream systems over time: Tank01
(the app's subscribed NFL data API) for live roster and stat sync, nflverse
for historical backfill, Sleeper for offense/kicker season-stat sourcing,
FantasyFootballCalculator for ADP (average draft position), and ESPN for
the `external_id` identifier space used to cross-reference players. This
notice does not trace every individual field to its exact origin API; it
names the real upstream systems this app's own pipeline draws from, rather
than describing the data as though this repository generated it itself.

The `oracle_*` chunks are this application's own projection-engine output,
captured for reproducibility testing rather than sourced from anywhere
external.

## Personal and biographical data, and what is NOT included

`players.csv` (and the app's own `players` chunk) carries real, public
NFL players' biographical fields, including `birth_date`, name, college,
and draft information - genuine personal data about public figures,
disclosed in the players' own public sports-data records, not by this
application. The specific categories present: injury-report fields
including `report_status`; the several stable identifier columns present
in `players.csv` (`gsis_id`, `espn_id`, `nfl_id`, `pfr_id`, `pff_id`,
`otc_id`, `esb_id`, `smart_id`); `birth_date`; and any URL-shaped field
such as `headshot`. This notice makes a narrower and more precise claim
than "no personal data of any kind": no Endzone USER, ACCOUNT, LEAGUE, CREDENTIAL, or AUTHENTICATION data of any kind is included. This
publication does not claim the broader thing.

See `manifest.json` for the exact chunk inventory (dataset or source name,
order, row or byte count, and both uncompressed and compressed byte counts
and hashes) and `verification.json` for the packaging-time verification
results: schema, secret scan over every dataset AND every raw source file,
reconstruction proofs for both `chunks/` and `sources/`, and the
roster-vs-gameTeam contradiction counts.
