# PREREGISTRATION - Reconstructed Historical Backtest and Frozen Paired Sweep (2024/2025)

Study id: `pit-sweep-2024-2025`
Status: SEALED at the end of Phase 0. Immutable.
Authority: the approved plan "Accuracy Roadmap: Reconstructed Historical Backtest +
Frozen Paired Sweep" (rev 11, approved 2026-07-29 after ten review rounds).

This document is written BEFORE any outcome, metric, score, or arm comparison has
been computed. The only empirical input available when it was written is the
Phase-0 scripted inspection of the pinned sources, which is restricted by
construction to schema, categorical value counts, and ID integrity
(`scripts/backtest/lib/inspect.js` contains no arithmetic over a stat column).
No fantasy point has been scored. No candidate cell has been run.

Where the plan marked a value "proposed", the proposed value is SEALED here as
the operative value. Values introduced by this document because the plan
required "preregistered numeric margins" without naming a number are marked
**[sealed here]** and carry the same force.

Purpose is MEASUREMENT ONLY. Nothing in this study changes `MODEL_CONSTANTS`,
bumps `MODEL_VERSION`, or activates a factor. A passing cell yields a proposal
document, nothing more.

---

## 0. Contents

1. Pinned sources and provenance
2. Phase-0 empirical findings (recorded, not chosen)
3. Mechanical mappings
4. Cohort and outcome truth
5. Rosters, initial lineups, and the regret estimands
6. Metric definitions (exact formulas)
7. Arms, benchmarks, controls
8. Salts and seeds
9. Inference: the seven-component claim-wise IUT
10. CI contract
11. Factor-activation assertions
12. Factorial family, attribution composites, parsimony total order
13. Blinded design sensitivity (MDE)
14. v3.2 replay veto
15. Oracle weeks
16. Sensitivities and non-selecting analyses
17. Quarantine, freeze, and reproduction
18. Non-goals

---

## 1. Pinned sources and provenance

### 1.1 Fetcher contract (frozen)

Implemented in `scripts/backtest/lib/sourceFetch.js`, driven by
`scripts/backtest/fetch-sources.js`. Every clause is enforced in code and
covered by test:

- HTTPS only, at every hop; a plain-http redirect target is refused.
- Host allowlist checked at EVERY hop, not only the first.
- Maximum redirects: **5**.
- Socket-inactivity timeout: **120000 ms**. Stated precisely because the
  distinction matters for what the contract does and does not promise: this is
  `req.setTimeout`, which fires when the socket sees no activity for 120
  seconds. It is **not** a total wall-clock deadline, so a response that streams
  slowly but steadily can take longer than 120 seconds in total. **The size cap,
  not the timeout, is what bounds a pathological download.**
- Maximum download size: **134217728 bytes (128 MiB)**, enforced against the
  declared `content-length` before the first chunk and against the running byte
  count during the download.
- Schema validation: the file's header must carry every column a preregistered
  rule depends on; duplicate column names are refused.
- SHA-256 verification of exact bytes on write (write, re-read, compare) and on
  every later read (`readVerified`).
- Provenance records the STABLE source URL plus the byte hash. A URL carrying a
  query string, a fragment, or any known signing parameter is refused outright
  rather than recorded, so an expiring signed asset URL can never become
  provenance.

### 1.2 Observed redirect hosts (frozen from what was ACTUALLY observed)

The discovery run was permitted a deliberately narrow bootstrap set of four
hosts. Exactly three were observed, and the frozen allowlist
(`scripts/backtest/lib/allowed-hosts.json`) is that observed set verbatim:

```
github.com
raw.githubusercontent.com
release-assets.githubusercontent.com
```

`objects.githubusercontent.com` was in the bootstrap set and was NEVER observed;
it is therefore NOT on the frozen allowlist.

Per-source observed chains:

| source | observed chain |
| --- | --- |
| roster_weekly_2024 | github.com -> release-assets.githubusercontent.com |
| roster_weekly_2025 | github.com -> release-assets.githubusercontent.com |
| injuries_2024 | github.com -> release-assets.githubusercontent.com |
| injuries_2025 | github.com -> release-assets.githubusercontent.com |
| games | raw.githubusercontent.com |
| stats_player_week_2024 | github.com -> release-assets.githubusercontent.com |
| stats_player_week_2025 | github.com -> release-assets.githubusercontent.com |
| stats_team_week_2024 | github.com -> release-assets.githubusercontent.com |
| stats_team_week_2025 | github.com -> release-assets.githubusercontent.com |
| players | github.com -> release-assets.githubusercontent.com |

### 1.3 Pinned source bytes

All ten files are pinned by SHA-256 of their exact bytes. Every later read
verifies against these hashes; a mismatch is a hard failure, never a warning.

| source | bytes | SHA-256 |
| --- | ---: | --- |
| roster_weekly_2024.csv | 14926918 | `074ecaeb9325de943c11f7bbc941425626985090ef8386f90cd837fa5cb5d4b3` |
| roster_weekly_2025.csv | 15385661 | `c2f7a1ffebe06058400af1989d1cd2900cc5c9659f084623708a06d4e28de35b` |
| injuries_2024.csv | 816989 | `498bce8e13cb64b2ab9bb0ad6cb81d0a63c2ddb24016c9fc90c2de2126fae449` |
| injuries_2025.csv | 695623 | `15ee790fef634caea988e7b6562fc393a63739dd7ee38229d1b42161427709df` |
| games.csv | 2172886 | `9b512fecf7c73a7680006259118411c75f01b3762100f776d96400e7284a94fe` |
| stats_player_week_2024.csv | 8279410 | `db6379707a8d520f7fb9a90eeacd8a98ec3d5cdca8b98e0943cab5a250d91a97` |
| stats_player_week_2025.csv | 8461830 | `40b67b296fda02c7f628741d4aa471208352dd42fb670d4854e7ba95295af1a6` |
| stats_team_week_2024.csv | 223939 | `54db70df09cd4bbce832771b74c1d0903dfc1a07406521886ce701a3386a6594` |
| stats_team_week_2025.csv | 223890 | `e062506174b6b49ee8dac3ed64a32197017da8e831b2942499c40c2c7f3e9081` |
| players.csv | 7321414 | `4c253495a873058b1f9772b5d559087bf2e918d0ca6dc9ea1b87e1e4a1fdb0a1` |

Stable source URLs: the nine nflverse files come from
`https://github.com/nflverse/nflverse-data/releases/download/<tag>/<file>` with
tags `weekly_rosters`, `injuries`, `stats_player`, `stats_team`, `players`.

`games.csv` is additionally content-addressed, because it has a real revision
identity and the nflverse release assets do not:

- URL: `https://raw.githubusercontent.com/nflverse/nfldata/b19514f50ba4675e128c21c818592b4d92061a8f/data/games.csv`
- commit: `b19514f50ba4675e128c21c818592b4d92061a8f`
- git blob SHA-1: `4f1edd10f607152ad3a8a3286aac567929781c42` - **VERIFIED**: the
  fetched bytes hash to exactly this blob under `sha1("blob " + length + "\0" + bytes)`.
- The `games.csv` already sitting at the repository root from earlier work was
  NOT reused. The pinned copy was fetched fresh and verified independently.

nflverse replaces release assets in place. Refetching is therefore expected to
produce different bytes eventually; the fetch tool refuses to repin without an
explicit `--repin`, and repinning after this document seals invalidates it.

---

## 2. Phase-0 empirical findings (recorded, not chosen)

These are measurements of the sources, made before sealing, and several of them
change what the plan can assume. They are recorded here so a reader can tell
which rules are responses to the data and which are prior commitments.

1. **`date_modified` presence, verified empirically.**
   `injuries_2024.csv` **HAS** `date_modified` (16 columns, last column).
   `injuries_2025.csv` **DOES NOT** (16 columns, carrying an extra `season_type`
   column instead). This confirms the plan's assumption and is what makes the
   2024 as-of sensitivity possible and the 2025 as-of sensitivity impossible.

2. **A `report_status` value the plan did not anticipate: `Note`.**
   2024 carries 6 rows with `report_status = "Note"`; 2025 carries none. Their
   own report text states the player has no game status (for example
   "Fully expected to play. No game status."). Mapped to `null`. See section 3.

3. **Whitespace-only placeholder fields.** Several fields in the injury files
   contain a literal newline followed by four spaces rather than an empty
   string, including `position` (12 rows in 2024) and `practice_status`. Two
   consequences: (a) every source field is trimmed before comparison, so blank
   means blank-after-trim; (b) the tooling carries its OWN RFC4180 CSV reader
   that supports embedded newlines inside quoted fields, because a
   split-on-newline parser mangles `injuries_2024.csv`. The production
   `nflverseSync.service.js` parser splits on newlines first and must never be
   pointed at this file.

4. **Duplicate injury player-weeks, 2024 only.** Exactly 2 duplicate
   `(season, week, game_type, gsis_id)` keys, both in Week 15 REG
   (`00-0034270`, `00-0039359`). In both cases the two rows are successive
   revisions of the same report (an earlier `Questionable`, a later `Out`) with
   distinct `date_modified` values. 2025 has ZERO duplicate injury player-weeks.
   Resolution rule sealed in section 3.4.

5. **Roster player-week uniqueness.** Zero duplicate
   `(season, week, game_type, gsis_id)` keys once rows with a blank `gsis_id`
   are excluded, in both seasons. Blank-`gsis_id` roster rows: 7 (2024), 29
   (2025); these are unmappable and excluded from the cohort, counted.

6. **Stat-file player-week uniqueness.** Zero duplicate
   `(season, week, season_type, player_id)` keys in either season's
   `stats_player_week`. Zero duplicate `(season, week, season_type, team)` keys
   in either season's `stats_team_week` (570 rows each: 544 REG + 26 POST).
   Blank `player_id` rows: 22 per season (nflverse placeholder rows). Note that
   the placeholder in these files is the EMPTY string, not the literal `"0"`
   that `nflverseSync.service.js:174` guards against.

7. **Crosswalk integrity (`players.csv`, 25027 rows).**
   - Zero GSIS ids mapping to more than one ESPN id.
   - Zero ESPN ids mapping to more than one GSIS id.
   - Zero duplicate `(gsis_id, espn_id)` pairs.
   - 6098 rows carry a legacy, pre-GSIS identifier shape (for example
     `ABB498348`, players whose last season is in the 1980s) rather than
     `00-#######`. These are excluded from the crosswalk by shape and never
     used as a key; 190 of them carry an ESPN id.
   - 16570 well-formed GSIS ids carry an ESPN id and are therefore mappable.

8. **Mappability of each source's identifiers** (distinct ids -> mappable to an
   ESPN id):
   - `roster_weekly_2024`: 3215 -> 3010 mappable, **205 unmappable**
   - `roster_weekly_2025`: 3133 -> 2983 mappable, **150 unmappable**
   - `injuries_2024`: 1459 -> 1459, 0 unmappable
   - `injuries_2025`: 1453 -> 1453, 0 unmappable
   - `stats_player_week_2024`: 2001 -> 1999, **2 unmappable**
   - `stats_player_week_2025`: 2024 -> 2024, 0 unmappable

   The unmappable roster identifiers are exactly why the cohort is named the
   **mapped reconstructed roster cohort**. They are excluded and counted per
   week in the published report, never silently dropped.

9. **Schedule.** `games.csv` holds 7548 rows across seasons 1999-2026 with zero
   duplicate `game_id`. For the two backtest seasons, REG rows total 544 (272
   per season), of which **12 are `location = Neutral`**. Seasons 2026 rows are
   present in the raw provenance store and are quarantined everywhere else.

10. **Team-code vocabulary.** Both nflverse families use the same 32 codes, two
    of which differ from the app's spellings: `LA` (app: `LAR`) and `WAS`
    (Tank01/app: `WSH`). Normalization runs through the production
    `fn_normalize_nfl_team` / `normalizeTeamKey` in Phase 1, never a copy.

11. **Roster status vocabulary** (union of both seasons):
    `ACT, CUT, DEV, E01, EXE, INA, RES, RET, TRC, TRD`. `E01` occurs once, in
    2024. Cross-tabulating `status` against the league's own
    `status_description_abbr` corroborates each code's meaning (`ACT`->`A01`,
    `INA`->`A01`/`I01`/`I02`, `RES`->`R01`/`R04`/`R05`/`R48`, `RET`->`R02`,
    `EXE`->`E02`, `E01`->`E01`, `DEV`->`P01`, `CUT`->`W03`).

12. **Roster position vocabulary**: `DB, DL, K, LB, LS, OL, P, QB, RB, TE, WR`.
    Coarse by design; the stat files carry a finer set (`CB`, `SAF`, `FS`, ...)
    which is NOT used for cohort membership.

---

## 3. Mechanical mappings

Implemented in `scripts/backtest/lib/mappings.js`. Every mapping has an
exhaustive domain and throws on an unseen value: a source revision that adds a
code is a plan amendment, never a silent default.

### 3.1 Roster status -> cohort class

| class | codes | role |
| --- | --- | --- |
| `active` | `ACT`, `INA` | **cohort membership** |
| `reserve` | `RES`, `RET`, `EXE`, `E01` | **IR-equivalent signal**, excluded from the primary cohort |
| `off_roster` | `DEV`, `CUT`, `TRD`, `TRC` | excluded and counted |

`INA` (on the active roster, inactive for that game) is IN the cohort
deliberately. Keeping only players who dressed would be exactly the
survivorship cohort this rebuild exists to eliminate: a manager holding an
inactive player faces a real start/sit decision, and under the primary injury
policy the model has to eat the zero.

Where `status` and `status_description_abbr` disagree for a row (for example
`ACT`/`R48`, 22 rows in 2024), **`status` is the authority** and the
disagreement is counted and reported.

### 3.2 Injury `report_status` -> app `injury_status`

The app's vocabulary is exactly `{null, 'Q', 'D', 'O', 'IR'}`
(`server/services/projectionModel.js` `availabilityFor`, :754).

| source `report_status` | app `injury_status` |
| --- | --- |
| blank (after trim) | `null` |
| `Questionable` | `Q` |
| `Doubtful` | `D` |
| `Out` | `O` |
| `Note` | `null` |

`IR` is deliberately UNREACHABLE from injury reports: no injury report in either
season carries it. IR-equivalence comes only from the reserve roster status
(section 3.1), and conflating the two would invent a signal.

### 3.3 Position -> fantasy position

Fantasy positions from roster rows: `QB, RB, WR, TE, K`. `DEF` is synthesized
per team-week and never read from a roster row. The six evaluated positions, in
the fixed order used by every macro-average, are:
**`QB, RB, WR, TE, K, DEF`**.

### 3.4 Duplicate injury report resolution (2024 as-of sensitivity only)

Among rows sharing `(season, week, game_type, gsis_id)`: keep only rows whose
`date_modified` is at or before the week's earliest kickoff, then take the row
with the GREATEST `date_modified`. If two surviving rows tie exactly on
`date_modified`, **fail closed** (the run aborts). If `date_modified` is absent
from the file, **fail closed**. The primary analysis is unaffected because the
primary injury policy discards injury status entirely (section 4.2).

---

## 4. Cohort and outcome truth

### 4.1 Cohort

- **Mapped reconstructed roster cohort**: for each (season, week), the set of
  players with a `roster_weekly` row for that season/week with
  `game_type = REG`, an `active`-class status (section 3.1), a well-formed
  `gsis_id` that maps to an ESPN id in the pinned crosswalk, and a fantasy
  roster position (`QB/RB/WR/TE/K`), plus one synthesized `DEF` pseudo-player
  per team-week.
- The roster file is the authority for a player's week team and week position.
  A contradiction with `stats.gameTeam` is REPORTED and never used to exclude.
- **No today's-position fallback in the primary analysis.** A player whose
  reconstructed week position cannot be established is excluded and counted.
- Players absent from today's `players` table cannot re-enter; they are counted
  per week. This is a named limitation, not a silent filter.
- Evaluated weeks: **2025 REG weeks 2-18 (17 primary weeks)** and **2024 REG
  weeks 2-18 (17 safety weeks)**, 34 season-weeks in total. **Week 1 is excluded
  from the evaluation window in both seasons**, for four independent reasons:

  1. **Repo precedent is unanimous.** The legacy harness this study replaces
     defaults to weeks 2-18 for exactly this reason
     (`scripts/backtest-weekly-projections.js:35`, "week 1 has no in-season
     history for the baseline being compared against"; the week list is built at
     :256 as 17 weeks starting at 2), and the 14,016-row `free_baseline_v3.1`
     replay artifacts are weeks 2-18. Changing the window would make this
     study's numbers incomparable to every prior measurement in the repository.
  2. **A weeks 1-17 window would foreclose the study's headline question before
     any data was seen.** The league-wide scan that feeds the positional
     home/away sample is gated off entirely at `week <= 1`
     (`projectionFeatures.js:542`), so week 1 has 0% homeAway activation by
     construction, and week 2 is structurally starved as well (one completed
     week supplies roughly 16 games per side against the
     `minGamesPerSide = 24` floor, `projectionModel.js:211`). With weeks 1 AND 2
     both pinned at zero, the season activation ceiling would be 15/17 = 0.8824,
     below any credible activation threshold, and every homeAway claim would be
     INCONCLUSIVE as a matter of arithmetic. Under weeks 2-18 only week 2 is
     starved and the ceiling is 16/17 = 0.9412 (section 11).
  3. **Week 1 is structurally degenerate for the metrics.** With no prior
     in-season rows and no scan, 2024 Week 1 has no residual pool at all, so
     every interval is null and coverage and WIS are undefined for the whole
     week - which would burn an entry from the missing-week budget in section
     10.4 for no information.
  4. **The naive benchmark is undefined there.** `naive-recency` requires at
     least one prior game, which no 2024 Week 1 player has (2022 and 2023 are
     captured-as-empty), so component (d) would have no comparator.

  **Week 18 is INCLUDED, and its distortion is a documented limitation rather
  than an exclusion.** Playoff-clinched teams rest starters in Week 18, so
  absolute accuracy in that week is worse for every arm. That is acceptable
  here for the same reason the cohort keeps game-day inactives (section 3.1):
  the distortion hits every arm identically, every formal contrast is a paired
  within-week delta (section 6.7), and a common shock cancels in the pairing.
  Absolute metrics for Week 18 are published separately so a reader can see the
  effect, and a labeled non-selecting sensitivity re-runs the primary contrasts
  on weeks 2-17 only.
- **Bye players are excluded from point-accuracy scoring and included in
  rosters**, so the deployed-policy wrapper's bye handling is exercised.

### 4.2 Injury policy

- **Primary (both seasons): `injury_status = null` for every player-week.**
  2025 has no `date_modified` and so admits no honest as-of injury view; 2024 is
  matched to it for symmetry. **Stated plainly: the primary regret estimand
  exercises only bye availability. Primary results do NOT test O/IR filtering.**
- **Sensitivity S1 (labeled, non-selecting)**: 2024 with `date_modified` at or
  before the week's earliest kickoff, resolved per section 3.4. This is where
  O-filtering is exercised. Fail-closed if the column is absent.
- **Sensitivity S2 (labeled, non-selecting, explicitly leak-prone)**: 2025 with
  final report statuses. Leak-prone because the file's statuses are terminal
  revisions with no timestamp to cut at.
- **Sensitivity S3 (labeled, non-selecting)**: reserve-class roster status
  (section 3.1) treated as `IR`. This is the only IR-equivalent signal either
  season has.

### 4.3 Outcome truth

- **Pinned external outcomes are primary; agreement with the production database
  is a QA check, never the source of truth.**
- Absence from BOTH stat sources for a player-week = "zero recorded fantasy
  points" -> actual `0`.
- Ambiguous cases (present in one source and not the other, or present with
  contradictory team attribution) are **excluded by preregistered rule and
  counted**, with a labeled sensitivity that includes them.
- DEF pseudo-players are synthesized per team-week from the pinned
  `stats_team_week` rows plus `games.csv` scores.
- Scoring profiles: **half-PPR is the formal primary**. Standard and full-PPR
  are no-harm sensitivities. The three profiles differ only in the per-reception
  value (`0.5`, `0.0`, `1.0`); their exact serialized rules and SHA-256 hashes
  are pinned in freeze manifest Commit B.

---

## 5. Rosters, initial lineups, and the regret estimands

### 5.1 Roster construction (frozen per season-week, model-independent, seeded)

- **Candidate pool quotas**: **20 QB, 50 RB, 50 WR, 20 TE, 10 K, 10 DEF = 160**.
- **Ranking** (model-independent): pre-week recency-weighted mean of prior
  league-scored points, re-scored from the pinned raw stats under the pinned
  half-PPR profile, weight `0.5^(weeksAgo/8)`, two-season window, at least one
  prior game. Ties broken by `(position rank, name rank, id)` from the same
  ordering artifacts used by the deployed-policy wrapper (section 5.3).
- **Draft**: snake, 10 teams, 16 rounds, into **10 x 16-man legal rosters**.
  Per-team position caps, which exactly exhaust the pool and make every roster
  legal by construction: **2 QB, 5 RB, 5 WR, 2 TE, 1 K, 1 DEF**. Each pick takes
  the highest-ranked remaining player the caps still allow.
- **Roster shape**: the app's `DEFAULT_ROSTER_SLOTS` (QB 1, RB 2, WR 2, TE 1,
  FLEX 1, K 1, DEF 1), with `benchSlots = 7` and `irSlots = 0`, so 9 starting
  slots + 7 bench = 16.
- **Slot-count guard: the number of starting slots is the SUM of `slot.count`
  (= 9), never `rosterSlots.length` (= 7).** A mutant that uses `.length` must
  fail a test.
- **5 replicates** per season-week; replicate `r`'s draft order is the seeded
  permutation of the 10 team slots derived from the roster seed and
  `(season, week, replicate)`. 10 rosters x 5 replicates = **50 rosters per
  season-week**, 50 x 34 = **1700 roster-weeks**.
- **Initial starter/bench state** (seeded, model-independent, recorded): fill the
  starting slots in the fixed order QB, RB, RB, WR, WR, TE, FLEX, K, DEF, each
  with the highest-ranked eligible unassigned player under the SAME pre-week
  ranking; everyone else starts on the bench.
- Roster seed: **1357931762**.
- Artifacts are generated AFTER this document seals (their construction rules
  are in it) and committed in freeze Commit A. The sweep LOADS them; it never
  regenerates them.

### 5.2 Primary regret estimand: deployed-policy regret

A **deterministic reconstruction of production policy**, explicitly NOT claimed
to be exact production semantics, because production's `ORDER BY position, name`
(`lineup.service.js:217`) is neither total nor portable: duplicate names are
unordered, and name order follows the production PostgreSQL collation rather
than any JS comparator.

The reconstruction is: the `buildSuggestions` availability wrapper
(`decision.service.js:105-139`) plus the production optimizer
(`lineupOptimizer.js`), with candidates ordered by two DB-produced collation
artifacts generated inside the read-only extraction transaction:

1. the position-code ordering of the closed set of week-position codes;
2. the `(name, id)` ordering over all players.

Offline composition sorts by **reconstructed roster-week position first**
(mapped through artifact 1, so today's `players.position` can NEVER affect
historical candidate order), captured name rank second, `id` third.
**Fail closed if an evaluated player lacks a rank.** Equal costs resolve by
candidate column order (`lineupOptimizer.js:74`).

Pinned optimizer behaviors, each with a test fixture: the empty-slot dummy
(cost 0) beats strictly negative projections; zero and null-coerced-to-zero tie
with the dummy, so a real player may start; equal-zero/null and duplicate-name
fixtures are included.

**Regret for one roster-week** = (points of the best legal lineup under ACTUAL
reconstructed points) - (points of the lineup the arm's wrapper starts, scored
under ACTUAL reconstructed points). Non-negative by construction.

**Per season-week regret score** = the arithmetic mean over the 50 rosters.

Required sensitivities: a DB-collation variant and a duplicate-order shuffle.
**If ordering changes any winner or any pass verdict, that result is
INCONCLUSIVE.**

### 5.3 Sensitivity regret estimand: force-fill regret

A "legal nine-slot lineup" estimand: `null` ranks strictly below every finite
projection, and no slot is left empty while an eligible player remains.
Explicitly NOT production regret.

**If the two estimands disagree on a winner, NO SELECTION OCCURS.**

---

## 6. Metric definitions (exact formulas)

**The primary point value is the MEDIAN** of the arm's simulated distribution,
because that is what production serves (`projection.service.js:724`).
Mean-scored diagnostics are secondary and never gate anything.

**The analysis unit is the season-week.** Every metric collapses to ONE number
per arm per season-week before any inference happens; the season-week is also
the bootstrap cluster.

### 6.1 Regret

Section 5.2. One score per season-week: the mean over 50 rosters. Lower is
better.

### 6.2 Pairwise accuracy

Within each `(season, week, position)` cell, over all unordered pairs
`{i, j}` of cohort players in that cell:

- A pair is **eligible** iff both players have a non-null projection AND their
  ACTUAL points differ. Pairs whose actual points are equal are excluded from
  the denominator; a player with a null projection contributes to no pair.
- A pair scores **1** if the projection ordering matches the actual ordering,
  **0** if it is reversed, and **0.5** if the two projections are exactly equal.
- The cell score is the mean over eligible pairs.

**Per season-week pairwise score** = the **macro-average over the six positions
in the fixed order `QB, RB, WR, TE, K, DEF`, equally weighted.** A position with
zero eligible pairs in a week is dropped from that week's macro-average and the
drop is reported. If more than one position drops in a week, the WEEK is dropped
(and the drop counts against the missing-cell budget in section 10.4). Higher is
better.

### 6.3 MAE, RMSE, Spearman rho

Per cohort player-week, error `e = projected_median - actual`.

- **MAE (week)** = mean of `|e|` over the week's cohort. Lower is better.
- **RMSE (week)** = `sqrt(mean(e^2))` over the week's cohort. The week's RMSE is
  computed first and the WEEK values are the analysis units; RMSE is never
  pooled across weeks. Lower is better.
- **Spearman rho (week)** = Spearman rank correlation between projected medians
  and actual points over the week's cohort, computed with midranks for ties.
  Higher is better.

Rows with a null projection are excluded from MAE, RMSE, and rho, and the
exclusion count is reported per week per arm.

### 6.4 Prediction coverage

**Coverage (week)** = the fraction of the week's cohort player-weeks whose
ACTUAL points fall within the inclusive interval `[p10, p90]` of the arm's
simulated distribution. Rows with a null interval are excluded and counted.
Higher is better.

### 6.5 Weighted Interval Score (WIS)

Using the two central intervals the engine produces, `50%` (`p25`, `p75`,
`alpha = 0.5`) and `80%` (`p10`, `p90`, `alpha = 0.2`), with `K = 2`:

```
IS_alpha(y; l, u) = (u - l)
                  + (2/alpha) * (l - y) * 1{y < l}
                  + (2/alpha) * (y - u) * 1{y > u}

WIS(y) = ( 0.5 * |y - m| + sum_k (alpha_k / 2) * IS_{alpha_k}(y) ) / (K + 0.5)
```

where `m` is the median. **Per season-week WIS** = the mean of `WIS(y)` over the
week's cohort. Lower is better.

### 6.6 Null and tie conventions (global)

- A **null projection** is excluded from pairwise, MAE, RMSE, rho, coverage, and
  WIS, and counted. It is NOT excluded from regret: the production optimizer
  coerces null to zero (`lineupOptimizer.js:110`), and the wrapper reproduces
  production exactly.
- An **exact tie** between two projections contributes 0.5 to pairwise accuracy.
- An **exact tie in actual points** removes the pair from the pairwise
  denominator.
- **Numeric ties** are decided on values rounded to 10 decimal places, so a tie
  is a genuine tie and not a floating-point artifact. This same rounding defines
  a zero difference in the sign test of component (f).

### 6.7 Contrast construction

Every formal contrast is a **paired per-season-week delta**: for each season-week
and each of the 24 salts, `delta = candidate_metric - comparator_metric`; the
season-week's contrast value is the **arithmetic mean of the 24 same-salt
deltas**. Unsalted production-seed results are reported separately and gate
nothing.

Sign conventions used throughout section 9:

- **Regret delta**: candidate minus comparator. **Negative is favorable.**
- **Pairwise delta**: candidate minus comparator. **Positive is favorable.**

---

## 7. Arms, benchmarks, controls

### 7.1 Selection family

The **7 non-control cells** of `usage.blendWeight in {0, 0.25, 0.40, 0.60}`
crossed with `homeAway.enabled in {off, on}`.

**Control = usage-25 x off**, which is the shipped `free_baseline_v3.1`
configuration.

Every cell's resolved constants are serialized and SHA-256 hashed, and the
hashes are published.

### 7.2 Benchmarks (never selectable)

- **`naive-recency`**: a pure estimator, the recency-weighted mean of prior
  league-scored points with weight `0.5^(weeksAgo/8)`, a two-season window, at
  least one prior game, and no intervals.
- **`usage-signal`**: the same estimator computed over usage-bearing games only.

Both run under the deployed-policy wrapper so the comparison is on the same
decision.

### 7.3 Controls and assertions

- **`perm-control`**: exactly **10,000** seeded within-week-position
  permutations of the projection-to-player assignment. Each replicate is ONE
  permutation, reused across all 24 salts and both co-primary endpoints.
  Permutation seed: **940227589**.
  Plus-one Monte Carlo p-value:
  `p_hat = (1 + #{b : T_b >= T_obs}) / (1 + 10000)`.
  **Threshold: `p_hat <= 0.001`** for the shipped control arm against the
  permutation null, on BOTH co-primary endpoints. If the real control cannot
  beat a shuffle at that threshold, the harness cannot distinguish signal from
  noise: the run is declared broken and VOID. This is a pipeline assertion, not
  a scientific finding.
- **`usage-25 == control` bit-identity**: the usage-25 x off cell must be
  bit-identical to the control arm.
- **`homeaway-on-stored == homeaway-on` point-identity**: point-identical
  outputs required.
- Both identity assertions failing aborts the run.

---

## 8. Salts and seeds

### 8.1 The 24 fixed candidate salts

Identical across every cell, benchmark, and contrast. Generated deterministically
as `pit-<NN>-<first 12 hex of sha256("endzone-empire/pit-sweep-2024-2025/salt/<NN>")>`
so anyone can regenerate and check them:

```
pit-01-879c6f8eae4b
pit-02-d5b1cf54d30c
pit-03-388e3522c0f7
pit-04-573e0d6504b9
pit-05-fb867967639b
pit-06-b35a0c9b6418
pit-07-2e3ef103a04c
pit-08-2d5314ec308d
pit-09-c1c56868a8a0
pit-10-b4de025c6e5e
pit-11-ae05d62de7d1
pit-12-a3c719ea03a9
pit-13-f97ea63fe811
pit-14-feb2052528e4
pit-15-def75b2f44ea
pit-16-49f1dc9385d9
pit-17-2f9533be661a
pit-18-4ea7c8257a8d
pit-19-39c034f0405e
pit-20-beaf8091175b
pit-21-dc9b241925ce
pit-22-bc589c1a3cd8
pit-23-6402a70ab1ad
pit-24-6e1cc0e9aef6
```

Salts differ ONLY in the seed's `hashValue` input; no other model input may vary
with the salt, and a test asserts it.

### 8.2 The two disjoint 12-salt halves (split-salt SD, descriptive only)

- **Half A (odd)**: `pit-01`, `pit-03`, `pit-05`, `pit-07`, `pit-09`, `pit-11`,
  `pit-13`, `pit-15`, `pit-17`, `pit-19`, `pit-21`, `pit-23`.
- **Half B (even)**: `pit-02`, `pit-04`, `pit-06`, `pit-08`, `pit-10`, `pit-12`,
  `pit-14`, `pit-16`, `pit-18`, `pit-20`, `pit-22`, `pit-24`.

Disjoint, 12 each, union = all 24. The split-salt SD is **descriptive only**.
**No formal gate uses it.**

### 8.3 Seeds

| purpose | seed |
| --- | ---: |
| cluster bootstrap | **1499811874** |
| permutation control | **940227589** |
| roster construction + initial lineups | **1357931762** |
| moving-block bootstrap sensitivity | **588165040** |
| blinded MDE simulation | **184424023** |

Each is the first 8 hex digits of
`sha256("endzone-empire/pit-sweep-2024-2025/<name>")` read as an unsigned 32-bit
integer, with names `bootstrap-seed`, `permutation-seed`, `roster-seed`,
`moving-block-seed`, `mde-seed`.

---

## 9. Inference: the seven-component claim-wise IUT

### 9.1 Structure

One claim per candidate cell. The claim is an **intersection-union test**: it
passes only if EVERY component passes. There are **seven components**, labeled
(a), (b), (c), (d), (e1), (e2), (f) and referred to collectively as (a)-(f).

- **Family one-sided alpha = 0.05.**
- **Every component is tested at one-sided level alpha/7 = 0.05/7 =
  0.0071428571** (10 significant digits; the exact value is 1/140).
- **The divisor is FIXED at 7** whether or not every component is active for a
  given claim. A cell with `homeAway = off` does not get a larger alpha for the
  components it skips. This forecloses divisor-shopping.
- A component that does not apply (for example (b) for an `off` cell) passes
  **vacuously by definition**, never by test, and is reported as "not
  applicable".
- **A missing or unevaluable component FAILS the claim.** There is no
  "assume pass".
- Within a component, the two co-primary inequalities are themselves an
  intersection-union: each is evaluated at alpha/7 from the SAME bootstrap
  resamples, and their conjunction inherits level alpha/7 with no further
  multiplicity correction. This is what "simultaneous bound" means here.

### 9.2 Component (a) - superiority over the shipped control, 2025

Comparator: **control (usage-25 x off)**. Season: **2025**.
Margins: **delta_R = 0.15 points per week**, **delta_P = 0.005**.

In words, both must hold:

1. The **upper** one-sided `1 - alpha/7` simultaneous bound on the per-week mean
   **regret delta** (candidate minus control) lies **strictly below minus 0.15
   points per week**.
2. The **lower** one-sided `1 - alpha/7` simultaneous bound on the per-week mean
   **pairwise-accuracy delta** (candidate minus control) lies **strictly above
   plus 0.005**.

### 9.3 Component (b) - homeAway attribution (only if the cell has homeAway = on)

Comparator: the **matched same-usage OFF cell**. Season: **2025**.
Attribution margin: **0** for both endpoints.

1. The **upper** bound on the regret delta (candidate minus matched off-cell)
   lies **strictly below 0**.
2. The **lower** bound on the pairwise delta lies **strictly above 0**.

### 9.4 Component (c) - usage attribution (only if blendWeight differs from 0.25)

Comparator: **usage-25 at the SAME homeAway setting**. Season: **2025**.
Attribution margin: **0** for both endpoints.

1. The **upper** bound on the regret delta (candidate minus matched usage-25)
   lies **strictly below 0**.
2. The **lower** bound on the pairwise delta lies **strictly above 0**.

### 9.5 Component (d) - superiority over the naive benchmark

Comparator: **`naive-recency`** under the deployed-policy wrapper.
Season: **2025**. Margin: **0** for both endpoints.

1. The **upper** bound on the regret delta (candidate minus naive-recency) lies
   **strictly below 0**.
2. The **lower** bound on the pairwise delta lies **strictly above 0**.

### 9.6 Component (e1) - 2024 co-primary safety (noninferiority)

Comparator: **control**. Season: **2024**.
Margins: **delta_R = 0.15**, **delta_P = 0.005** (same numbers, opposite roles).

1. The **upper** bound on the 2024 regret delta (candidate minus control) lies
   **strictly below plus 0.15 points per week** (the candidate must not be worse
   by the margin).
2. The **lower** bound on the 2024 pairwise delta lies **strictly above minus
   0.005**.

Pooling 2024 with 2025 can never rescue a 2025 failure, and 2024 is never used
to select.

### 9.7 Component (e2) - secondary safety and no-harm **[sealed here]**

All of the following, evaluated on **2025** unless stated, each as a one-sided
`1 - alpha/7` bound from the same resamples:

| quantity | inequality | margin |
| --- | --- | ---: |
| prediction coverage delta vs control | **lower** bound above minus 0.01 | **1 percentage point** |
| MAE delta vs control (2025 and 2024) | **upper** bound below plus 0.10 | **0.10 points/week** |
| RMSE delta vs control (2025 and 2024) | **upper** bound below plus 0.15 | **0.15 points/week** |
| Spearman rho delta vs control (2025 and 2024) | **lower** bound above minus 0.005 | **0.005** |
| WIS delta vs control (2025 and 2024) | **upper** bound below plus 0.10 | **0.10 points/week** |
| standard-scoring regret delta vs control (2025) | **upper** bound below plus 0.15 | **delta_R** |
| standard-scoring pairwise delta vs control (2025) | **lower** bound above minus 0.005 | **delta_P** |
| full-PPR regret delta vs control (2025) | **upper** bound below plus 0.15 | **delta_R** |
| full-PPR pairwise delta vs control (2025) | **lower** bound above minus 0.005 | **delta_P** |

All nine rows must hold. (e2) fails if any single one does.

### 9.8 Component (f) - negative-baseline subgroup no-harm (homeAway = on cells only)

**Subgroup membership** is assigned from the UNTREATED cell: a player-week is in
the subgroup iff its baseline projection is **at or below zero in the matched
same-usage OFF cell, at the point immediately before the homeAway factor would
apply**. Membership is NEVER read from the treated cell. This matters because
multiplicative factors invert sign on negative baselines
(`projectionModel` `applyFactor`).

**Estimand and test are matched.** Both endpoints are the **MEDIAN over 2025
season-weeks of the on-minus-off delta**:

- **Endpoint f1**: per-week subgroup **MAE** (on-cell minus matched off-cell).
- **Endpoint f2**: per-week subgroup **absolute bias**, i.e.
  `|mean(projected_median - actual)|` over the week's subgroup rows (on-cell
  minus matched off-cell).

Both on median-scored points. Lower is better for both.

#### The scale of an on-minus-off difference (derivation of delta_F and the cap)

The margin and the catastrophic cap are derived from the FACTOR'S OWN bound, not
from the scale of the (e2) accuracy margins, because a homeAway on-minus-off
difference lives on a completely different scale from a model-versus-model
accuracy difference.

`applyFactor` (`projectionModel.js:1094-1102`) computes
`next = running * (1 + effect)`, so the on-cell and off-cell projections differ
by EXACTLY `b * e`, where `b` is the pre-homeAway baseline (which is also the
(f) subgroup's membership variable) and `e` is the homeAway effect. Both cells
share the seed and the residual pool, so `simulateDistribution` shifts by the
same amount and `median_on - median_off = b * e` as well. This exactness
depends on weather being disabled: `applyFactor('weather', ...)` runs AFTER
homeAway (`projectionModel.js:1107`), so with weather live the difference would
be `b * e * (1 + e_weather)`; it is exact here only because every sweep run
uses `weatherService: false` (Architecture, plan rev 11).

`homeAwayEffect` (:679-712) returns
`effect = clamp(shrunk - 1, maxEffect)` with
`shrunk - 1 = (G / (G + shrinkPseudoGames)) * (ratio - 1)`, `G` the total
games in the positional sample. With `maxEffect = 0.05` and
`shrinkPseudoGames = 120`:

- **`|e| <= 0.05` always** (the clamp).
- In practice `|e|` is SMALLER than the clamp: mid-season `G` is 100 to 500, so
  the shrinkage factor is 0.45 to 0.80, and a realistic positional home/away
  split of 2 to 6 percent gives **`|e|` around 0.01 to 0.04**. The clamp binds
  only when `|ratio - 1| > 0.05 * (G + 120) / G`, which is above 0.09 early and
  above 0.06 late.

Therefore, per subgroup row, the incremental absolute-error change satisfies

```
inc = |error_on| - |error_off|  <=  |projection_on - projection_off|
                                 =  |b| * |e|  <=  0.05 * |b|
```

and the (f) subgroup is defined by `b <= 0`, so `|b|` clusters near zero by
construction. **Any margin or cap set on the points scale of the (e2) accuracy
margins (tenths of a point, or whole points) would be unreachable, and the
component would pass by construction while the veto sat dead.** That is what
these two numbers are derived to avoid.

**Noninferiority margin: delta_F = 0.025 points per week [sealed here].**

Derivation: the largest attainable per-week subgroup MAE delta is
`0.05 * mean|b|` over the week's subgroup rows. With a reference mean subgroup
baseline magnitude `B_bar_ref = 1.00 point`, full-strength harm is 0.05 points
per week, and the margin is set at HALF of it so it can actually bind:

```
delta_F = 0.5 * maxEffect * B_bar_ref = 0.5 * 0.05 * 1.00 = 0.025
```

**Falsifiability guard (required, and it fires BEFORE the test is read).** The
margin is only meaningful if the data can exceed it. Publish the realized mean
`|b|` over the 2025 subgroup. **If the realized mean `|b|` is at or below
`delta_F / maxEffect = 0.025 / 0.05 = 0.50 points`, the maximum attainable
per-week delta is at or below the margin, noninferiority cannot be falsified,
and component (f) is declared UNEVALUABLE - which makes the homeAway claim
INCONCLUSIVE, never a pass.** This is the same rule as the cluster minimum
below, applied to the margin's scale instead of the sample's size.

**Exact one-sided binomial sign test, per endpoint:**

1. For each 2025 season-week `w` with subgroup rows in both cells, form
   `D_w` = (on-cell week metric) - (off-cell week metric).
2. **Margin shift**: `S_w = D_w - 0.025`.
3. **Tie/zero handling**: weeks with `S_w` exactly zero (on values rounded to 10
   decimal places, section 6.6) are DROPPED. Let `n` be the number of remaining
   weeks and `k = #{w : S_w < 0}`.
4. Under the null hypothesis `median(D) >= 0.025`, at the boundary
   `k ~ Binomial(n, 1/2)`. The one-sided p-value is
   `p = sum_{j=k}^{n} C(n, j) * 2^(-n)`.
5. **Declare noninferiority iff `p <= alpha/7 = 0.0071428571`.**
6. **Inversion into an exact confidence bound**: the one-sided `1 - alpha/7`
   upper confidence bound for `median(D)` is the order statistic `D_(j)` with
   `j = min{ i in 1..n : P(Binomial(n, 1/2) >= i) <= alpha/7 }`; if no such `i`
   exists the bound is `+infinity` and the endpoint is UNEVALUABLE. The test and
   the bound are the same procedure, so they can never disagree: the endpoint
   passes iff the bound lies strictly below 0.025.

**Documented discreteness.** With `n = 8` non-tied weeks at
`alpha/7 = 0.0071428571`, the only passing outcome is `k = 8`:
`p = 1/256 = 0.00390625 <= 0.0071428571` passes, while `k = 7` gives
`p = 9/256 = 0.03515625` and fails. **All 8 of 8 shifted differences must favor
noninferiority.**

**Evaluability minimum**: at least **8 distinct 2025 season-week clusters** with
subgroup rows in both cells, AND at least **30 subgroup rows in total**.
**Below the minimum the component is UNEVALUABLE and the homeAway claim is
INCONCLUSIVE - never a pass. Zero rows is "not estimable", not a formal pass.**
2024 can never rescue sparse 2025 evidence.

**Additional row-level catastrophic veto [sealed here]: 0.20 points**, defined
INCREMENTALLY versus the matched off-cell so that pre-existing bad predictions
cannot falsely veto homeAway. For any subgroup row, let
`inc = |on-cell error| - |off-cell error|`. **If any single subgroup row has
`inc > 0.20 points`, the homeAway claim is VETOED** regardless of every other
component. This is a veto only; it can never turn a failure into a pass.

Derivation, on the same bound as the margin: `inc <= maxEffect * |b|`, so a cap
of `maxEffect * B_ref` fires exactly on rows whose baseline magnitude exceeds
`B_ref` AND which moved near full strength in the harmful direction.
`B_ref = 4.00 points` is the sealed subgroup baseline magnitude at which a
full-strength harmful move is called catastrophic:

```
cap = maxEffect * B_ref = 0.05 * 4.00 = 0.20
```

A cap on the scale of whole points (the earlier 5.00) would have required
`|b| > 100 points` to fire and was therefore dead by construction.

**Transparency reporting (required)**: the published report states, per
endpoint, the effective non-tied week count `n`, the count `k`, the exact
p-value, the inverted bound, the subgroup row count, the **realized mean and
maximum `|b|` over the subgroup** (so both derivations above can be audited
against the data they were scaled for), the **count of individual weeks whose
own realized mean `|b|_w` is at or below 0.50 points** (weeks where the margin
was unattainable per-week and a favorable sign is therefore structurally
uninformative - the season-level guard above bounds the aggregate, this count
discloses how much of `k` rests on such weeks), and an explicit statement of
the **week-sign independence assumption** the exact test rests on. If the realized
maximum `|b|` is at or below `B_ref = 4.00`, the report states plainly that the
catastrophic veto could not have fired on this data; that is a disclosure, not
a failure, because the veto is an additional safety rather than a gate that must
bind.

---

## 10. CI contract

### 10.1 Resampling

- **Cluster bootstrap over season-weeks.** The cluster is the season-week; a
  draw resamples the season's weeks WITH replacement and recomputes every
  per-week metric mean over the drawn multiset.
- **Resampling is over the SURVIVING clusters, and `n` is the surviving count.**
  Week dropping (section 10.4) happens FIRST and symmetrically across the
  candidate and every comparator; the bootstrap then resamples `n` weeks with
  replacement from those `n` survivors, where `n = 17` when no week drops and
  `n = 17 - (number of dropped weeks)` otherwise. A dropped week is never drawn,
  never counted in a denominator, and never imputed. `n` is published per
  component.
- **Exactly 100,000 draws.** Not "at least", not "about".
- **Bootstrap seed 1499811874.**
- **Every bootstrap-based component uses IDENTICAL resamples**: the same 100,000
  week-index draws are reused for every arm, every comparator, every endpoint,
  and every component. Deltas are computed within a draw, never across draws.
- **Percentile CIs.** The one-sided `1 - alpha/7` upper bound is the
  `1 - 0.0071428571 = 0.9928571429` empirical quantile of the 100,000 bootstrap
  deltas; the lower bound is the `0.0071428571` quantile. Quantiles use the
  order statistic at index `ceil(q * 100000)` clamped to `[1, 100000]`, a fixed
  rule with no interpolation.

### 10.2 Exact-inference trigger (frozen)

A component switches from percentile bootstrap to the exact, distribution-free
method of section 9.8 (sign test plus its inverted bound) when EITHER:

- the number of distinct clusters with data for that component is **fewer than
  12**, or
- the bootstrap distribution is degenerate: **fewer than 100 distinct values**
  among the 100,000 resampled statistics.

Component (f) always uses the exact method by construction. When the trigger
fires for any other component, the report says so explicitly and names which
condition fired.

### 10.3 Level for the exact method

The exact method reaches the SAME one-sided `alpha/7 = 0.0071428571` level as
the bootstrap components. No component is ever evaluated at a looser level than
another.

### 10.4 Missing-cell behavior

- A week with no rows for an arm is **dropped from that contrast for BOTH the
  candidate and every comparator**, symmetrically, and the drop is reported. The
  surviving weeks are then the bootstrap's cluster set and its draw size
  (section 10.1).
- **If more than 2 of the 17 evaluated weeks drop for a component, that
  component is UNEVALUABLE and the claim FAILS** (an unevaluable component is a
  failure, per section 9.1). Equivalently: the component requires `n >= 15`
  surviving clusters.
- A missing arm, missing cell, or missing comparator is a failure, never a skip.

### 10.5 Sensitivity resampling

**Moving-block bootstrap** with block lengths **2** and **3**, same draw count
(100,000), seed **588165040**. Reported alongside the primary CIs. It does not
gate anything.

### 10.6 Interpretation rules

- **Wide intervals are inconclusive, not evidence.** If a component's interval
  spans both the favorable and harmful margin, the claim is INCONCLUSIVE.
- **Pooled 2024+2025 results can never rescue a 2025 failure.**
- **Control-vs-naive and `usage-signal` are estimates-only diagnostics**:
  reported as point estimates with CIs and NO superiority or verdict label.

---

## 11. Factor-activation assertions

**Activation** for a projection is defined as
`factors.homeAway.available === true` AND the raw `homeAway.effect !== 0`.

**Denominator**: eligible, non-neutral, known-orientation projections, per
position, including DEF.

### 11.1 How the sample accumulates (the mechanism the threshold is derived from)

The positional home/away sample comes from ONE place: the league-wide scan in
`loadFeatureBundle`, whose `WHERE` clause is
`"ps"."season" = $1 AND "ps"."week" < $2` (`projectionFeatures.js:551-553`).
`buildLeagueContext` (:263) buckets those rows by
`positionGroup(row.position)` and increments `homeGames` / `awayGames` one row
at a time (:304-310).

Three consequences, each verified in the code rather than assumed:

- **The sample is CURRENT-SEASON ONLY.** `buildLeagueContext` never sees a
  prior-season row. `homeAway.useStoredHistory` gates `buildPriorGames` - the
  player's own prior games - not the league context. **2024 and 2025 therefore
  accumulate identically**, and any asymmetric threshold between the two seasons
  would be unjustified. The thresholds below are symmetric for exactly this
  reason.
- **Neutral-site rows are excluded from BOTH sides** (:296-310), so they slow
  accumulation slightly and are also excluded from the activation denominator.
- **`homeAwayEffect` returns neutral unless BOTH sides clear
  `minGamesPerSide = 24`** (`projectionModel.js:211`, gate at :691-699).

Accumulation arithmetic, per position, at target week `W` (weeks `1..W-1`
completed): a position with one starter per team contributes roughly 32 rows per
week, split about 16 home and 16 away.

| target week | completed weeks | approx. games per side | clears 24? |
| ---: | ---: | ---: | --- |
| 2 | 1 | ~16 | **no** |
| 3 | 2 | ~32 | yes |
| 4+ | 3+ | ~48+ | yes |

The thin positions (QB, K, DEF: about 32 rows per week) are the binding case;
RB, WR, and TE carry more rows per week and may already clear at week 2. So
**week 2 is structurally starved and weeks 3-18 are not**, in both seasons.

### 11.2 The sealed thresholds **[sealed here]**

- Evaluated weeks per season: **17** (weeks 2-18, section 4.1).
- Structurally unreachable weeks: **1** (week 2).
- Structural ceiling: **16/17 = 0.9412**.
- Threshold = allow ONE further week-equivalent of loss beyond the structural
  one, to absorb neutral-site row exclusion, bye-week thinning, and any week
  where the shrunk effect rounds to exactly zero:
  **(17 - 2) / 17 = 15/17 = 0.8824**, rounded DOWN to the nearest 0.05.

**Threshold = 0.85, identical for every position and identical in both
seasons:**

| position | 2025 (primary) | 2024 (safety) |
| --- | ---: | ---: |
| QB | 0.85 | 0.85 |
| RB | 0.85 | 0.85 |
| WR | 0.85 | 0.85 |
| TE | 0.85 | 0.85 |
| K | 0.85 | 0.85 |
| DEF | 0.85 | 0.85 |

**If any position falls below 0.85 in a season, the homeAway claim is
INCONCLUSIVE for that season** - an on-cell that is not actually treated cannot
be compared to an off-cell. Activation rates are published per season and
position regardless of outcome, together with the per-week activation profile so
a reader can see whether a shortfall is the structural week-2 zero or something
else.

---

## 12. Factorial family, attribution composites, parsimony total order

### 12.1 Factorial family

The full 4 x 2 design (`blendWeight` x `homeAway`) is reported as a factorial
family: all 8 cells' absolute metrics and all paired deltas versus control,
with CIs, whether or not any cell passes.

### 12.2 Attribution composites

For a candidate at `(usage = u, homeAway = on)` with `u != 0.25`, the total
effect versus control decomposes into three published composites, each with CIs:

- **usage main effect** = `(u, off) - (0.25, off)`
- **homeAway main effect** = `(0.25, on) - (0.25, off)`
- **interaction** = `(u, on) - (u, off) - (0.25, on) + (0.25, off)`

These are descriptive. Components (b) and (c) are what gate attribution.

### 12.3 Parsimony total order (never by point estimate)

Applied in order:

1. fewest changed constants versus the shipped configuration;
2. cells that introduce NO newly gated factor outrank cells that activate one
   (so usage-40 x off outranks usage-25 x on);
3. smallest absolute `blendWeight` change from 0.25;
4. the preregistered fixed cell order, used only when 1-3 all tie:

```
1. usage-40 x off
2. usage-00 x off
3. usage-60 x off
4. usage-25 x on
5. usage-40 x on
6. usage-00 x on
7. usage-60 x on
```

If two or more cells pass, the parsimony order selects among them. **Point
estimates never break a tie.**

---

## 13. Blinded design sensitivity (MDE)

Runs on **control-only artifacts**. The runner is structurally incapable of
loading a candidate cell, and a mutation test proves it. Named
**"primary-component power for the seven claims"**. It reports; it can NEVER
alter a margin, a threshold, or a decision rule.

Algorithm, frozen:

1. Load ONLY the control cell's per-season-week regret and pairwise scores for
   2025 (the 17 evaluated weeks, 2-18, per section 4.1). Estimate the per-week
   SD of each endpoint from those scores.
2. **Paired-correlation grid**: `rho in {0.00, 0.10, 0.20, 0.30, 0.40, 0.50,
   0.60, 0.70, 0.80, 0.90, 0.95, 0.99}`.
3. **Injected synthetic effects**:
   - regret: `{0, -0.05, -0.10, -0.15, -0.20, -0.30, -0.50}` points/week
   - pairwise: `{0, 0.0025, 0.0050, 0.0075, 0.0100, 0.0150, 0.0200}`
4. For each `(rho, effect_regret, effect_pairwise)` grid cell, simulate **2,000**
   experiments. Each simulated experiment draws 17 paired week-deltas (one per
   evaluated week) with the estimated SDs and the grid's correlation, adds the
   injected effects, and runs the SAME cluster-bootstrap machinery.
5. **Draw count for simulation only: 10,000** cluster-bootstrap draws per
   simulated experiment (not 100,000). This deviation exists solely so the grid
   is computable and is declared here because the MDE is descriptive; the
   AUTHORITATIVE analysis always uses exactly 100,000.
6. MDE seed **184424023**.
7. Report **joint two-primary power contours**: the fraction of simulated
   experiments in which BOTH component-(a) inequalities hold at `alpha/7`.
8. **Not simulated**: the naive benchmark gate (d), the safety gates (e1)/(e2),
   the subgroup gate (f), and anything on 2024. The report states this
   limitation in the same sentence as the contours.

---

## 14. v3.2 replay veto (explicit noninferiority, non-tuning)

If a cell passes and a `free_baseline_v3.2` proposal is drafted, the selected
cell AND its required comparators are replayed under the pinned exact eventual
`free_baseline_v3.2` version string, on **2025**, using the same cluster
bootstrap (100,000 draws, seed 1499811874).

**Required comparators**: the control always; the matched same-usage off-cell if
the winner activates a factor; matched usage-25 if the winner changes usage;
both if the winner does both.

For EVERY required comparator, with comparator-specific margins:

| comparator | regret margin (delta_R) | pairwise margin (delta_P) |
| --- | ---: | ---: |
| control (usage-25 x off) | 0.15 | 0.005 |
| matched same-usage off-cell | 0.15 | 0.005 |
| matched usage-25 at same homeAway | 0.15 | 0.005 |

Both inequalities must hold for each comparator, at **one-sided 95%** (alpha =
0.05, NOT alpha/7 - this is a no-harm replay, not a member of the IUT family):

1. the **upper** one-sided 95% bound on the candidate-minus-comparator **regret
   delta** lies **strictly below plus 0.15 points per week**; AND
2. the **lower** one-sided 95% bound on the candidate-minus-comparator
   **pairwise delta** lies **strictly above minus 0.005**.

Otherwise **VETO**. These are **no-harm checks only, never new superiority
tests**. **A veto ends the cycle - no promotion of any runner-up.**

---

## 15. Oracle weeks

Off-mode `generateProjections` outputs for these weeks are captured INSIDE the
read-only extraction transaction and stored with pinned oracle player and cohort
hashes. Offline fidelity is proven bit-identically against them.

The weeks are chosen to cover EVERY conditional SQL branch of
`loadFeatureBundle` (`server/services/projectionFeatures.js:418`). The two
conditionals are the league-wide scan
(`scanPositions.length > 0 && Number(week) > 1`, :542) and the normalized
defense-game count (`currentSeasonScheduleRows.length > 0`, :566), which is
non-empty only once the target season has completed weeks:

| oracle week | league scan | defense count | why |
| --- | --- | --- | --- |
| 2025 W1 | OFF | OFF | the `week <= 1` branch; no completed weeks in the target season |
| 2025 W2 | ON | ON | the boundary: exactly one completed week |
| 2025 W9 | ON | ON | mid-season, byes active, full scan |
| 2025 W18 | ON | ON | maximal in-season history, largest scan, last evaluated week |
| 2024 W1 | OFF | OFF | the safety season's scan-off branch, with NO prior-season history at all (2022/2023 captured-as-empty) |
| 2024 W10 | ON | ON | the safety season's scan-on branch, byes active |

**Week 1 is NOT an evaluated week.** The evaluation window is weeks 2-18
(section 4.1); the two Week 1 oracles exist SOLELY to pin the fidelity of the
scan-off / defense-count-off SQL branch, which no evaluated week exercises.
Their outputs prove that the snapshot client reproduces production on that
branch; no metric, contrast, cluster, or claim is ever computed from them, and
they are excluded from every denominator in sections 6, 9, and 10.

Two remaining code paths issue no SQL for the reconstructed cohort and are
covered by unit tests rather than oracles, which is recorded here so the
coverage claim is honest: the `ids.length === 0` early return (:420, issues no
query at all), and the scan-off-at-week-greater-than-1 path, which requires an
empty `scanPositions` and therefore cannot arise for a cohort in which every
player has a reconstructed position.

The 8 SQL texts of the snapshot client's dispatch surface are: players by id;
prior `player_stats`; prior `player_season_stats`; target-week `nfl_games`;
history-window `nfl_games`; the league-wide scan; the normalized defense-game
count; and `computeByeWeeks`'s query.

---

## 16. Sensitivities and non-selecting analyses

Every item here is LABELED and NON-SELECTING. None may promote a cell, and none
may rescue a failed component.

- Injury sensitivities S1, S2, S3 (section 4.2).
- Force-fill regret (section 5.3).
- DB-collation ordering variant and duplicate-order shuffle (section 5.2).
  **An ordering-dependent winner or verdict is INCONCLUSIVE.**
- Moving-block bootstrap, block lengths 2 and 3 (section 10.5).
- Standard and full-PPR scoring profiles - these appear in (e2) as no-harm
  GATES, and their absolute metrics are additionally reported descriptively.
- Split-salt SD across the two 12-salt halves (section 8.2), descriptive only.
- Ambiguous-outcome inclusion sensitivity (section 4.3).
- **Weeks 2-17 only**, dropping Week 18, whose widespread starter rest is a
  common shock the paired contrasts already cancel (section 4.1). Absolute
  Week 18 metrics are additionally published on their own.
- Unsalted production-seed results, reported separately.
- Mean-scored diagnostics alongside the median-scored primary.

---

## 17. Quarantine, freeze, and reproduction

- **`QUARANTINE_FROM_SEASON = 2026`.** Extraction, evaluation-store build, store
  loader, cohort builder, sweep arguments, and every persisted evaluation row
  throw on a 2026 row. `games.csv` retains 2026 in the RAW provenance store
  only. No `holdout.service` import. Mutation-tested.
- **2026 is an untouched prospective holdout** (first capture approximately
  2026-09-09) and is not part of this study in any form.
- Freeze sequence: Commit A (every non-output change, including this sealed
  document) -> Commit M (blinded control-only MDE artifact, `parent(M) = A`,
  regenerated from A and byte-compared in CI) -> Commit B (freeze manifest only,
  `parent(B) = M`, pinning A's root-tree SHA and commit SHA, the runtime
  identity, and M's commit/blob hash). Each commit's changed paths are validated
  individually against a closed allowlist, not only the A..B endpoint diff.
- Candidate sweeps execute from a clean **detached worktree checked out at B**,
  never the live working tree.
- **Output-only allowlist for B..final-head**: only `REPORT.md`, `report.json`,
  and explicitly named generated evidence files may change after B.
- The AUTHORITATIVE sweep and reproduction runs execute credential-cleared
  inside `docker run --network none` with `--platform` pinned alongside the image
  digest. Preregistered canaries must prove, BEFORE the sweep starts, that raw
  TCP, HTTP(S), global-pool access, and a freshly constructed PostgreSQL client
  all FAIL; the sweep aborts if any canary succeeds.
- Canonical report serialization: sorted rows and keys, fixed numeric/NaN/null
  representation, UTF-8 with LF, no timestamps or absolute paths, pinned Node
  version, `TZ=UTC`, locale-invariant formatting.
- Phase 1 accepts ONLY archived, hash-verified Phase-0 paths and imports no
  fetch code, so it is structurally incapable of refetching an external source.

---

## 18. Non-goals

- No `MODEL_CONSTANTS` change, no `MODEL_VERSION` bump, no factor activation
  results from this study. A pass produces a PROPOSAL document.
- No production application-data write anywhere.
- No claim that the reconstructed cohort equals a true pre-kickoff vintage.
  `roster_weekly` is week-level data, and players absent from today's `players`
  table cannot re-enter.
- No claim that the deployed-policy wrapper reproduces production's candidate
  ordering exactly; it is a deterministic reconstruction, and ordering
  sensitivity is a published gate on the conclusion.
- The primary analysis does not test O/IR filtering (section 4.2).
- No Tank01 or RapidAPI usage at any point in this study.
