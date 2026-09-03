# The Draft assistant is a voice over approved measures, never a ranking

Status: accepted (2026-09-03)

The "Polk High Legend" plan arrived as a persona layered on "standard VBD":
a running back premium, a kicker penalty, a receiver discount, applied to a
player valuation and surfaced as recommendations. This repo has no such
valuation. CONTEXT.md reserves Draft value as a term with no producer, and
forbids any surface from presenting ADP, 17-game pace or other historical
numbers under that name until a season-forward producer exists.

We decide that the Draft assistant is a voice, not a ranking. It reacts to a
manager's own Picks, Queue and Pick clock with lines drawn from a static,
seeded template table over facts the repo already approves: position, ADP,
the per-pick steal or reach label, Starting need, the Autopick flag and the
urgent clock edge. It never re-sorts Best available, never shows a list of
its own, and never uses "value" or "tier" unqualified. The bias table in the
plan becomes a trigger table: a running back Pick earns a certain kind of
line, an early kicker another, and no number is multiplied.

## Considered options

- **Build the season-forward producer first, then the persona over it.**
  Rejected for sequencing, not on merit. The persona's jokes are about the
  draft the manager is actually having, and a market measure carries them;
  Draft value remains its own spec.
- **An "Al's board" that re-sorts Best available with the bias factors.**
  Rejected for the first cut. It would present a biased ADP as advice, which
  is a stand-in for Draft value under another name.
- **LLM-generated lines.** Deferred. The recap services already set the
  house shape (deterministic template is the guaranteed path, an LLM only
  enhances when a key is present, provenance recorded), and a persona can
  adopt it later without changing this decision.

## Consequences

- The per-pick steal or reach label the Draft Sim computes (a round-scaled
  threshold) is promoted to a shared client lib module with a parity test,
  so the assistant and the Sim never disagree about one pick.
- "Early" for a kicker or defense is relative: fewer rounds remain than the
  team's unfilled K and DEF starting slots, read from the league's own
  roster slots, never a fixed round number.
- The assistant is private. It is not Draft activity, not League chat, and
  is absent from the presenter link. Overdue is never narrated.
- The line generator is a pure function over a facts object in src/lib, with
  one thin presenter per venue, because the Draft Sim and the Draft room
  share primitives and not components.

## Amendment (2026-09-03): "early" means rounds remaining, not rounds run out

#796 found that the "Early" bullet above reads as the inverse of the shipped
predicate: taken literally, it would call a kicker or defense pick "early"
only once the team is nearly out of rounds to grab one, which would roast the
pick at precisely the point where taking it is correct. The corrected
predicate: "early" for a kicker or defense means at least as many rounds
remain after the current one as the team's unfilled K plus DEF starting
slots. The original bullet above is superseded by this amendment;
`earlyKickerOrDefense` in `src/lib/draftAssistant` and its tests are
unchanged.
