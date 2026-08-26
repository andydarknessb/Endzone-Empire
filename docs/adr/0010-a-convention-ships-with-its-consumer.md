# A convention ships with its consumer, or it is unaudited

Status: accepted (2026-08-26)

A convention this repository adopts - a naming rule, an index, a keyword in a
PR body, a condition in a config file - ships together with the thing that
reads it and would complain when it is violated: a guard script, a test, a CI
step, a lint rule, a workflow. Absent that consumer, the convention is
recorded, at adoption, as unaudited. The question to ask before adopting one
is *what will read this?* If the answer is "a person, eventually, if they
look", the convention's observed health is unknown, not good.

## Why

Failure *rate* does not determine whether a convention stays correct; whether
a consumer exists does. Five instances, all in this repository or its
tooling, carry the measurement:

| # | convention | consumer | outcome |
|---|---|---|---|
| 1 | Cross-references between agent notes, by declared name | none | 51 of 88 broken (58%), using the filename where the document declared a different canonical name. That spelling fails 100% of the time and survived fifty repetitions. |
| 2 | The same, in a second notes directory | none | 4 of 17 broken, two by a different mechanism than the first |
| 3 | Three config guard scripts existing and passing | none until #247 | They ran nowhere. Working guards protecting nothing. |
| 4 | `Closes #N` keywords in PR bodies | none until #330 | Inert for every PR targeting `integration`, because GitHub honours keywords only on the default branch. Issues stayed open with their work merged. |
| 5 | Release conditions in the fleet's own skip file | none today | Nothing parses them; the Stop hook reads only the key set (fleet repo: `hooks/stop.ps1`, lines 67 and 115). One condition was satisfied while its hold had to stand, caught by an audit run for an unrelated reason. |

Instance 1 is decisive: a rule that fails every single time survived fifty
repetitions because nothing ever read the output. The finding also predicts
rather than only explains. #323's docs/agents orphan guard found five orphans
on the first run of a new consumer, and #411 shows the same shape again,
across a different corpus: membership is not resolution, so a check that
proves one does not prove the other.

## Consequences

- At triage, a ticket that proposes a convention names its consumer, or names
  the follow-up issue that will build one. A convention with neither is filed
  as unaudited on purpose, not by omission.
- A green check certifies exactly what that check reads, and nothing
  adjacent. #411 is the worked example: a check that resolves membership does
  not thereby prove resolution, and treating the two as interchangeable is
  the failure mode this ADR is about.
- A check phrased over file contents fires on the document that explains the
  convention, since explaining or forbidding a pattern means writing an
  example of it. `docs/agents/agent-briefs.md`'s "Content vs. behaviour"
  section already covers how to phrase such a check so it survives that
  collision; this ADR does not restate it.
