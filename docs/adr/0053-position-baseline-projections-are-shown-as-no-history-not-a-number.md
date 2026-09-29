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
   input before projection never sees it.
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
