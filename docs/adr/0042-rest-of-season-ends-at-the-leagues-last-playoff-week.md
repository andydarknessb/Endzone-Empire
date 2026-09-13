# Rest of season ends at the league's last playoff week

Status: accepted (2026-09-12)

The glossary names Rest of season as a third projection horizon and keeps it
apart from the weekly ones, but nothing had fixed where it ends. NFL week 18
is the obvious answer and the wrong one: leagues set `regular_season_weeks`
(default 14) and their playoff shape, most finish in week 16 or 17, and a
manager claiming a player in week 10 wants to know whether he is on a bye in
their semifinal, not in a week their league does not play. The Decision card
(ADR 0040) shows Rest of season on every availability context and the
Players list sorts on numbers derived from it, so the horizon is now a stored
and compared number.

We decide that Rest of season sums the Weekly projection for every remaining
week from the current week through the league's last playoff week, under the
league's own scoring, with Unavailable weeks contributing zero. The
eighteen-week bars still draw every NFL week, with the league's season end
marked, so a manager can see what the number excludes. A nightly run fills
`player_week_projections` for every remaining week for every league in the
in-season phase, skipping weeks already cached for that scoring hash, so the
horizon is never computed from a partial set.

## Considered options

- **Through the league's last playoff week (chosen).** The number answers the
  question the manager is asking.
- **Through the regular season.** Rejected: a claim made for the playoffs is
  the most common late-season claim, and the number would exclude the weeks
  that matter most.
- **Through NFL week 18.** Rejected: pads every player with one to three weeks
  no league scores, and inflates late-bye players relative to early-bye ones.

## Consequences

- Rest of season is league-scoped: the same player carries a different number
  in two leagues with different playoff lengths, as he already does for the
  Weekly projection under different scoring.
- Changing a league's playoff settings mid-season changes every Rest of season
  number in it on the next nightly run.
