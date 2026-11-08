# Position-baseline projections are shown as no history, not a number

Status: accepted (2026-09-29)

From week 2 of 2026 every player with no stat lines in the engine's lookback
gets a Position-baseline projection: the position's per-game baseline, the
same number for everyone at that position. In the week 4 runs that is 1,373
of 3,702 rows, among them 22 backup and practice-squad quarterbacks on real
teams at 15.37 half-PPR, above many starters. They rank near the top of the
Players page and Waivers and can be recommended by Start/sit advice. The
Endzone Forecast weeks 1 to 3 audit (2026-09-29) found the number carries no
evidence either way: in week 3 the same 14.4 was Case Keenum's 26.5 as an
emergency starter, Jalon Daniels' -1.1, and about twenty players who never
took the field.

ADR 0044 forbids a Model version change before the 2026 week 18 capture, so
the number cannot move in season. We decide to keep the number and change
the verdict and its presentation, the shape #1589 used for No NFL team:

1. A Weekly projection is a Position-baseline projection exactly when the
   engine's stored data-quality reasons name the position baseline. Sample
   size 0 is not the test, because it also covers prior-season-only players.
2. Everywhere a Weekly projection surfaces as a single number it reads
   "no history" instead, and projection-sorted lists put it after every
   projection with evidence.
3. Like Doubtful, the player is startable if a manager insists but never
   auto-recommended. The verdict is taken by the one verdict function, after
   projection, in the Weekly projection read; the engine's own availability
   input before projection never sees it. It ranks below every Unavailable
   reason and above Doubtful and Questionable: a bye, No NFL team, Practice
   squad, Out or IR wins and shows its Unavailable reason instead of "no
   history", and a Questionable or Doubtful Game status tag still shows
   beside it.
4. Once started, the Expected final counts him at his number.
5. Zero evidence only. No games-count threshold, because none has been
   measured.

## Considered options

- **Do nothing until v3.2** (#1442 rookie prior, #1440 Appearances, #1441
  Appearance probability). Rejected: fifteen weeks of confident-looking
  numbers on the Waivers page for players the engine knows nothing about.
- **Make them Unavailable.** Rejected: Unavailable means the player cannot
  play, and Keenum did.
- **Rank them down by Depth chart rank now.** Rejected: that moves a
  projected number, which ADR 0044 forbids in season.

## Consequences

- The holdout ledger is untouched: captures store what the engine produces,
  and nothing the engine produces changes. So there is no DEVIATIONS.md
  entry; a capture-identity test (#1775) proves the bytes are unchanged.
- Advice gives up Keenum-type starters, which the engine had no evidence
  for either way.
- The rule retires by itself for any player a later Model version gives
  evidence, because the marker is written only for zero-evidence rows.
  Nothing has to be switched off when v3.2 ships.
- Spec #1774, tickets #1775 to #1778.

## Amendment (2026-11-08): one or two old games and none this season also read as no history

Rule 5 refused a games-count threshold because none had been measured. One old
game got a player past it. Ricky Barber, a practice-squad DT whose only stat
line was one 2025 game, carried no Position-baseline marker, and that game
also counted as his whole 2025 pace (`priorSeasonPerGame` has no minimum), so
he projected 9.77 in 2026 week 9. A Saturday elevation made him available and
he was listed as an Upgrade for 5 of 12 teams in one league.

It has now been measured, over 2026 weeks 2 to 8 for available players in one
league's projection runs, with actual points in default scoring:

| Evidence behind the projection | Player-weeks | Had a stat line | Average actual points |
| --- | --- | --- | --- |
| No games (Position-baseline) | 458 | 9.4% | 0.17 |
| 1 old game, none in 2026 | 62 | 25.8% | 0.20 |
| 2 old games, none in 2026 | 30 | 20.0% | 0.36 |
| 3 to 5 old games, none in 2026 | 98 | 11.2% | 0.27 |
| 6 or more old games, none in 2026 | 455 | 31.6% | 0.79 |
| Played earlier in 2026 | 4,732 | 84.6% | 4.81 |

Across the 92 player-weeks with one or two old games, the best game was 7.0.

So rule 5 is replaced:

1. A Weekly projection is a Thin-history projection when the engine's stored
   row counts one or two games in its lookback and none is from this season.
2. The Weekly projection read treats a Thin-history projection as a
   Position-baseline projection, so the original rules 2, 3 and 4 apply to it.
   The original rule 1 still defines the marker; the engine does not write the
   marker for these rows.
3. Two is a judgment. One game would catch this case too, but two old games
   scored as little, and the best game across both rows was 7.0. "None this
   season" alone would catch returning starters (Micah Parsons has 27 games in
   the lookback). The 3 to 5 row scored as little, but its best games were not
   checked, so it keeps its number until they are.

Consequences:

- ADR 0044 holds. The read derives this from the stored row; the engine, the
  stored rows and every capture are unchanged.
- The backtests, the holdout and editorial scoring keep reading the marker
  alone, so their measurements do not move and they do not model this rule.
- Advice gives up a player with one or two games in the lookback who really
  does start, until a game this season shows up. A manager can still start the
  player.
- The "retires by itself" consequence above does not cover this rule, because
  it reads the row's game count and recency weight and not a marker. It has to
  be removed or replaced when v3.2 ships (#1438).
