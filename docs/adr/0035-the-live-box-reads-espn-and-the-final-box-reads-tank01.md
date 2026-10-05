# The Live box reads ESPN and the Final box reads Tank01

Status: accepted (2026-09-10)

Live scoring reads one box score per in-progress NFL game from Tank01, a
metered RapidAPI subscription of about 1,000 requests a month, on the
scheduler's five-minute tick every `SYNC_EVERY_TICKS` ticks (default 6, so
every 30 minutes). At that cadence a touchdown reaches a manager's cutscene
up to half an hour late; at a five-minute cadence a Sunday slate of thirteen
games spends the month's budget in one afternoon. Meanwhile the game clock
already reads ESPN's free, unauthenticated scoreboard every 30 seconds and
falls back to Tank01 after three consecutive failures (`liveGameEngine.js`),
and ESPN's summary endpoint for an event carries, at the same price, a full
per-player box score for both teams, a scoring summary and play-by-play. Our
`players.external_id` is ESPN's athlete id already: Tank01's playerID is that
same id, which is why the nflverse crosswalk joins `espn_id` straight onto
it. So the id problem the obvious objection expects does not exist.

We decide that the Live box is read from ESPN's summary endpoint by the
clock engine's 30-second loop, for each in-progress game whose scoreboard
score or clock moved since the last poll, through one Box source seam that
both sources implement by normalising to a source-neutral shape (per-player
stats in the scoring stat-key vocabulary keyed by external id, a team-defense
line keyed by Team code, and the game's Score summary lines). Tank01 is the
fallback for the Live box, entered after three consecutive ESPN failures on
one counter kept separately from the clock's (an HTTP failure, a timeout, or a
200 whose parse yields no player rows for a game in progress all count),
polled at `LIVE_FAST_POLL_MS` (ten minutes) at standard priority, retried
against ESPN every tick and left on the first success. The Final box stays
Tank01: when ESPN reports a game final, one Tank01 box-score call at
essential priority runs after a fifteen-minute grace, stamps
`final_stats_synced_at`, and from then on no Live box write is accepted for
that game. The first pass after any source switch, including the Final box
landing, applies stats but emits no Scoring plays, so a source that is a poll
behind cannot replay a touchdown cutscene. `LIVE_BOX_SOURCE` (espn |
tank01, default espn) pins the source without a deploy, mirroring
`LIVE_CLOCK_SOURCE`.

Parity is the bar for the ESPN path: every stat key today's Tank01 live path
produces must come from the ESPN box, from Score summary lines (touchdown
lengths, field-goal distances, two-point conversions, safeties) or, for
exactly the keys the box lacks (defensive fumble recoveries, blocked kicks,
forced fumbles), from play text, gated by a fixture corpus of real Gamebook
lines rather than one game's regexes. Anything the live parser misreads
corrects itself when the Final box lands, so the failure mode is "a defensive
recovery shows late or two points off until final", never a wrong settled
number: the Settle pass, Hindsight and every league-scoped reader keep
pricing the one `player_stats` row the Final box and nflverse wrote (ADR
0022, ADR 0023, ADR 0024).

## Considered options

- **ESPN for the Live box, Tank01 for the Final box and as fallback
  (chosen).** Live points and cutscenes at a 30-second poll for every game,
  zero Tank01 spend during play, and the season's Tank01 budget falls to
  roughly 270 calls a month before any faster injury or news cadence.
- **Stay on Tank01 and trigger a box pull off the ESPN scoreboard's score
  transitions, with a five-minute sweep.** Rejected: roughly 710 calls on the
  heaviest day, which needs the next Tank01 tier, and a score transition is
  still a poll behind the play. It remains the right shape for the fallback's
  cadence.
- **Stay on Tank01 at `SYNC_EVERY_TICKS=1`.** Rejected as anything but a
  one-night stopgap: about 12 calls an hour per game, so a full Sunday alone
  spends the month.
- **Store nothing about ESPN and rebuild the event id from the scoreboard
  each poll.** Rejected: an `espn_event_id` column on `live_game_states`
  survives a worker restart mid-game and makes a fallback debuggable. The
  column rides the anon-readable surface ADR 0009 bounds; it is a public id
  and adds no relation to that surface.

## Consequences

- ESPN's site API is undocumented, has no terms for third-party use, no SLA
  and no rate-limit statement; its shape can change on a Tuesday and be
  noticed on a Thursday. The fallback is what makes that survivable, and the
  fixture corpus is what makes a shape change a red test rather than a silent
  Sunday. A reader who finds a paid Tank01 subscription beside a free scrape
  reads this first.
- Nothing pages anyone today, and this ADR does not invent a pager: a source
  switch writes a `data_sync_runs` row (job `live-box`) so the scheduler
  status and health payloads show it, and a Sentry message where
  `SENTRY_DSN` is set.
- A full re-score of every league no longer follows every poll: a league is
  re-scored only when a player it rosters changed, and at most once every 60
  seconds, so ADR 0030's "LIVE can lag a kickoff by up to one sync interval"
  now means about a minute rather than thirty.
- The `scores:updated` wire and the Scoring play shape are unchanged; the
  client needs no work for phase one. Richer toasts from Score summary line
  text are a follow-up.
- The Final box call gains essential priority; today it passes none and runs
  as standard, so it was the first thing the quota client shed at budget.
- Injury designations stay single-writer (the daily Tank01 player-list sync).
  ESPN's per-team injuries block is a free in-game source the injuries ticket
  weighs; it does not become a second writer under this ADR.

## Amendment (2026-09-27, live scoring audit)

Two rules above, measured against the week 3 noon slot:

- "Only games whose score or clock moved" left a box stale whenever ESPN
  finished it after its scoreboard moved and the clock then stopped (a DET
  extra point held back behind a stopped clock; tackle and pass-defended
  revisions frozen through halftime). While the Live box is on ESPN, an
  unmoved in-progress game is now also re-read once its box is a minute old.
  In Tank01 fallback only movement fetches, so halftime still spends no
  quota.
- "Three consecutive failures" counted a just-kicked-off game's empty box
  as a failure. Nine at once flapped the Live box to Tank01 and back twice
  (four paid box reads). An empty box for a game still scoreless in the
  first quarter is now `box_not_ready`: skipped, neither a failure nor a
  success. With a score on the board or past the first quarter, an empty box
  is a shape failure again.

## Amendment (2026-10-05, #2002)

One key is no longer corrected by the Final box. Tank01's per-player
`Defense.fumblesRecovered` counts a player falling on his own team's fumble
(2026 week 4: ten rows, Drake Maye 2 own and 0 opponent per nflverse), so the
Final box credited IDP fumble recoveries the Live box had rightly left out. The
Tank01 adapter no longer emits `idpFumbleRecovery`, and the box write keeps the
stored value when a box line lacks it (`BOX_KEEP_IF_ABSENT`). The Live box's
play-text pass is the only same-day source; the Tue/Wed nflverse correction
settles it. A game ESPN never covered (whole-game Tank01 fallback) undercounts
IDP fumble recoveries until that correction, instead of overcounting them. The
team DST `fumbleRecovery` is opponent-only in Tank01 and still comes from the
Final box.
