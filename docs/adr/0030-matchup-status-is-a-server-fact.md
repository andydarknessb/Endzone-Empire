# Matchup status is a server fact

Status: accepted (2026-09-04)

Whether a Matchup is live was answered four ways on two pages, none of them a
definition. Game Center set one LIVE flag for every card for ten seconds after
any score event for the league, so a scheduled Week 14 card lit up when a Week
3 correction pass ran and went dark again long before the next sync; its hero
card used a second rule (final, or that flag, or a non-zero score). Matchup
Detail used a third, five conjuncts ending in "a score has been seen this
week", which never goes dark once true. The status chip took the answer as a
prop and could not arbitrate. Each rule was fixed at least once in isolation.

We decide that Matchup status is a fact the server states, carried beside
Expected final and Players remaining on the three shapes that already carry
those (the Matchup list row, the Matchup detail body, the live score event
entry), with four values: scheduled until the first starter's game kicks off,
live while any starter's game is in progress, played once every starter's game
is over but the score of record is not yet written, and final once it is. The
Expected final producer already classifies every starter's game to price him,
so the status is read from the same classification in the same pass; one
decorator in that module produces the status and the four Expected final and
Players remaining fields for every caller, and the list route, the detail route
and the score emit only map its result onto their wire shape. The client never
infers status from when a score arrived or from a timer. In best ball the
status reads the optimizer's chosen lineup, the same set the Expected final
sums. A Matchup with no lineup rows on either side is scheduled until it is
final.

## Considered options

- **Server fact from the Expected final classification (chosen).** The only
  answer with a definition, and it rides fields that already exist.
- **Client heuristic keyed to the Matchup's own week and a recent signal for
  that Matchup.** Rejected: "recent" is a timer, and the sync cadence is
  minutes, so the chip is wrong most of the time by construction. It also
  leaves a client with no socket unable to say anything after its fetch.
- **Hybrid: server fact, client decays it.** Rejected for the same reason; a
  fact does not decay.

## Consequences

- A status changes when a scoring pass runs, so LIVE can lag a kickoff by up to
  one sync interval. Accepted: it is then right until the next pass, where a
  timer was wrong between passes.
- The status chip shows Scheduled, LIVE, Awaiting final and Final; the hero
  card and the win-probability bar read the same status.
- A future reader who wants to "just compute it on the client" reads this
  first.
- The middle of the slate - a game already over while a later one has not
  started, none in progress - is `live`. "Scheduled until the first kicks off"
  is the governing clause: a game has kicked off, so the Matchup is past
  scheduled, and not every game is over, so it is not played. (#862, amending
  the definition above, which named the four states without this one.)
- A status the server could not compute is stated as unknown - the field is
  `null` - never guessed as `scheduled`. Two cases reach it: a read for the
  Matchup's week failed, or in best ball there is no projection run, so no
  chosen lineup exists to read a status from. Withholding the figures on such a
  miss was always right; asserting `scheduled` for the fact was the bug (#862).
  This adds a fifth thing the wire can carry (null, alongside the four values).
  Ratified 2026-09-05 (#862).
