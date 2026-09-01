# Autopick lost-race error split

The draft service does not distinguish "not your turn" from "player already taken" in its conflict error, and `autoPick` does not take a shortcut when it loses an expiry race. Both firings walk their candidate lists; the loser burns a few locking transactions and returns null.

## Why this is out of scope

Under the hybrid Pick clock expiry (ADR 0018, #601), an in-process timer and the backstop sweep can both read the same elapsed deadline. The module's expiry guard is check-then-act, so both firings pass it; the loser is stopped by the draft service's turn re-check under `FOR UPDATE`, which surfaces as a 409. `autoPick` treats every 409 as a snipe (another manager took the candidate first) and walks its remaining candidates, each in its own locking transaction, before concluding null.

In the lost-race case that walk is pure waste: no candidate can succeed because the turn itself has moved on, not the player pool. But eliminating it means the draft service tagging "not your turn" apart from "sniped" in a shared error contract that other callers rely on, purely to save a handful of doomed transactions in a rare race that already produces the correct outcome (exactly one Pick commits, dedupe holds).

The `continue`-on-409 behavior is load-bearing for genuine snipes - a manager picking a candidate out from under the autopick mid-walk is exactly when walking on is correct. Splitting the error contract for the race's sake risks that path for no user-visible gain.

Rejected during the review of PR #613 (#601) and confirmed at triage of #614: correct outcome, rare trigger, contract change disproportionate to the saving.

## Prior requests

- #614 - "Five of six Pick clock arming events arm no in-process timer" (the "wasted work in a lost race" section; the issue itself remains open for its other content)
