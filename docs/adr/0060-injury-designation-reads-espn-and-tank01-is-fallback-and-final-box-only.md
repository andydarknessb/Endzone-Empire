# Injury designation reads ESPN; Tank01 is fallback and Final box only

Status: accepted (2026-10-08). Amends the injury clauses of ADR 0035 and
ADR 0041.

ADR 0035 kept injury designations single-writer on Tank01's daily
player-list call and parked "ESPN's per-team injuries block" for an injuries
ticket that was never filed. That ticket is now #2115: Injury alerts (#2106)
want a designation change within minutes, and the Tank01 player list is one
metered call per refresh, so refreshing it every 15 minutes all week would
cost about 2,900 calls a month against a 950 budget. ESPN publishes a free,
unauthenticated league-wide injuries document
(`site.web.api.espn.com/apis/site/v2/sports/football/nfl/injuries`): one call,
all 32 teams, about 800 listed athletes on a Thursday, each with the athlete
id (our `players.external_id`, ADR 0035), a designation drawn from exactly
five strings (Questionable, Doubtful, Out, Injured Reserve, Active), the
injury type and body part, a return date, a short and long comment, and the
latest news headline.

We decide that `players.injury_status` and `players.injury_detail` are
written only by the ESPN injuries document, read on the same 15-minute
cadence inside and outside game windows, with no quota doubling because
there is no quota. The mapping is fixed: Questionable to Q, Doubtful to D,
Out to O, Injured Reserve to IR; Active and any athlete not listed are
healthy (null). The Tank01 player-list call keeps a daily job (`syncPlayers`,
scheduled by #2115 and still hand-runnable) for the player row itself (name,
position, NFL team) and never writes designation. Tank01's roles that stay
are the Live box and clock fallback after three ESPN failures and the Final
box (ADR 0035, for fumble recoveries ESPN lacks). Its other calls are leaving
one ticket each: the daily player list (#2117), the game schedule (#2116) and
news (#2118). Injury alerts (#2106) read the same transitions as before; only the
writer changed.

## Considered options

- Keep Tank01 and raise its cadence. Rejected on cost: about 2,900 calls a
  month at 15 minutes, or a 6-hour off-window compromise that leaves a
  Wednesday "Out" unalerted until the evening.
- Read ESPN per athlete through the overview endpoint already used by the
  Decision card. Rejected: one call per rostered player per refresh, and the
  card's cache is six hours.
- Two writers, newest wins. Rejected: ADR 0035's single-writer rule exists
  because two feeds disagree on the same afternoon, and the alert would fire
  on every disagreement.

## Consequences

- `INJURY_OFF_WINDOW_MS` (added in #2113) is removed; one `INJURY_SYNC_MS`
  (default 15 minutes) governs the injuries job.
- The injuries Sync run (ADR 0036) spends no Tank01 budget; the game-window
  and off-window Tank01 cost lines leave `render.yaml`.
- A player ESPN lists as Active with a news note is healthy, the same as one
  not listed; the note is not written anywhere by this ADR.
- The Tank01 label normaliser for designation is retired; the ESPN strings
  are an exact match, and an unknown string is logged and treated as
  healthy rather than guessed.

## Amendment (#2117)

The daily player job no longer calls Tank01. `syncPlayers` (still scheduled as
`player-sync`, still hand-runnable) reads the 32 ESPN team rosters through the
sweep the roster-status Sync run shares, and writes the player row itself (name,
position, NFL team, jersey, headshot) on `players.external_id`, the ESPN athlete
id. It makes no Tank01 call and needs no Tank01 credentials, which supersedes
the sentence above that the Tank01 player-list call keeps a daily job. A player
on no roster of a complete 32-team sweep has his NFL team cleared; a sweep with
a gap clears nobody.

## Amendment (#2148)

ESPN's injuries document lists an athlete only while his status is news; a
season-ending IR drops off after his week, so the sync read the player as
healthy and cleared him every 15 minutes. The injuries Sync run therefore also
reads the 32 team rosters through the shared sweep. Each roster athlete's first
`injuries` entry is the fallback designation for an athlete the document omits,
mapped through the same five strings (an unknown string is logged once per run
and treated as healthy; the roster's `Suspension` is healthy here, since it is
not an injury). The document wins where both speak. A player the document
omits is healthy when a roster saw him and listed no injury; a player neither
feed saw (his team did not answer the sweep) keeps what he has: a stored
designation is only cleared by a feed that saw him. A failed or slow sweep (20
seconds, `INJURY_SWEEP_TIMEOUT_MS`) does not fail the run; it falls back to the
document alone. This supersedes "written only by the ESPN injuries document"
above.
