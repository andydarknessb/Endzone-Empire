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
(`site.api.espn.com/apis/site/v2/sports/football/nfl/injuries`): one call,
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
healthy (null). The Tank01 player-list call (`syncPlayers`, hand-run from
the admin dashboard, not on the scheduler) keeps the player row itself (name,
position, NFL team) and never writes designation. Tank01's remaining production roles are the Live box and clock
fallback after three ESPN failures and the Final box (ADR 0035, for fumble
recoveries ESPN lacks); every other feed is on its way off it, one ticket
each. Injury alerts (#2106) read the same transitions as before; only the
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
- The injuries Sync run (ADR 0036) spends no Tank01 budget; the monthly
  estimate in `render.yaml` drops by the whole injuries line.
- A player ESPN lists as Active with a news note is healthy, the same as one
  not listed; the note is not written anywhere by this ADR.
- The Tank01 label normaliser for designation is retired; the ESPN strings
  are an exact match, and an unknown string is logged and treated as
  healthy rather than guessed.
- The injuries job no longer writes `nfl_team`: team changes and the No NFL
  team clear (#1385, with its size floor and kickoff deferral) leave it, and
  nothing on the scheduler keeps `nfl_team` current until `syncPlayers` is
  scheduled or hand-run. The size floor and deferral are retired with the
  clear, not moved.
