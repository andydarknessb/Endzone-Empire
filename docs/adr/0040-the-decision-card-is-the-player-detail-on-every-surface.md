# The Decision card is the player detail on every surface but the Draft room

Status: accepted (2026-09-12)

ADR 0037 gave Lineup a Decision card (`src/widgets/player-decision-card`, a
drawer at 560 px on desktop and a sheet on a phone) and left the older
PlayerQuickView dialog everywhere else: WaiverWire, PlayerManagement,
TradeCenter, TransactionLog, MatchupDetail and DraftBoard. The 2026-09-12
redesign (design canvas under `docs/design/player-decision-card/`, artifact
3717da69) set out to give waiver and free-agent decisions a richer player
detail and found it would be a second drawer with the same header, injury
tile and Usage tile as the first, one tap apart from it, drifting from the
day it shipped.

We decide that there is one card. The Decision card takes a context from the
player's Availability (free agent, on waivers, rostered by another team, your
team) and becomes the player detail on every league surface. The your-team
context is the card ADR 0037 describes, bench options included and no news
panel. The other three contexts swap bench options for the availability
action bar (Add with an inline drop pick when the roster is at capacity,
Claim with a FAAB bid, Propose trade prefilled into Trade Center) and show
the news list, since a manager who has not yet decided to hold a player is
the one news changes. Every context adds the decision strip (Weekly
projection for the week, Rest of season, Ownership, depth chart, Upgrade,
Usage) and the eighteen-week bars. PlayerQuickView is deleted from every
surface except the Draft room, where a draft is a fifth context with Draft
and Queue actions and is a follow-up of its own.

Rulings that shape the slices:

- **One projection producer on these surfaces.** The card, the Players list
  and Upgrade read the Weekly projection under the league's own scoring;
  Pool projection leaves waivers and the player list. Rest of season sums
  Weekly projections through the league's last playoff week (ADR 0042).
- **Tiles hide on missing data.** A player without ESPN facts (ADR 0041), or
  a best-ball league where Upgrade is undefined, loses the tile and the grid
  reflows. No tile ever reads "unavailable".
- **The card fetches on open**, as ADR 0037 ruled, through one route,
  `GET /api/players/:id/card?leagueId=`, that supersedes `/summary` and is
  deleted with PlayerQuickView.
- **Unavailable players show the reason**, never a number, in the list and
  on the bars: "on bye", "out", "on IR".

## Considered options

- **One card with an availability context (chosen).** One header, one
  injury tile, one Usage tile, one set of tests; a manager sees the same
  player the same way from Lineup and from waivers.
- **A second card for waivers and free agents.** Rejected: two drawers on
  the same player one tap apart, and the shared tiles drift the first time
  one is edited without the other.
- **Extend PlayerQuickView in place.** Rejected: it is a centered Dialog
  outside the island with no entity hooks, and the Lineup redesign already
  chose the drawer.

## Consequences

- The glossary's Decision card entry no longer says "on the Lineup surface
  only"; quick view survives in the Draft room only.
- Availability, Ownership, Upgrade and News are new glossary terms. Ownership
  is the ESPN share; Rostered stays an availability state and is never a
  percentage.
- WaiverWire, PlayerManagement, TradeCenter, TransactionLog and MatchupDetail
  adopt the card in that order; PlayerQuickView becomes a re-export until the
  last of them moves.
