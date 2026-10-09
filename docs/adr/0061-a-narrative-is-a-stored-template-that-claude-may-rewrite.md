# A Narrative is a stored template that Claude may rewrite

Status: accepted (2026-10-08)

Two services already write prose with Claude: the league Recap
(`server/services/recap.service.js`) and the public NFL game recap
(`server/services/gameRecap.service.js`). Each builds a deterministic
template from facts it has already computed, stores it, and only then asks
Claude to rewrite it, keeping the template if Claude is unconfigured, slow,
over budget or wrong. ADR 0027 deferred Claude lines for the Draft assistant
and named this shape as the house one in passing. With three more Narratives
planned (Matchup narrative, Projection explanation, and the Darkness Report
draft), the shape needs to be a rule, not a habit, because the moment a
surface depends on a live model call it cannot be taken back without
redesigning the surface.

We decide that every Narrative in the app has these properties, and a
feature that cannot have them is not a Narrative and needs its own ADR:

1. **Template first, always stored.** A deterministic template renders the
   facts and is written to the database before any model call. The surface
   renders from the stored text and never waits on Claude.
2. **Claude rewrites, never originates.** The model receives the same facts
   and the template's constraints, and its output replaces the template only
   when it arrives and is non-empty. Prompts say "use only the facts
   provided" and forbid invented players, scores and events.
3. **No numbers, no verdicts.** A Narrative names facts; the engine owns
   every number (ADR 0040, 0041) and every recommendation (Start/sit advice,
   Draft assistant, ADR 0027). An Editorial call stays the author's and is
   never served (ADR 0044 and #1928).
4. **Batch, never request-path.** Narratives are produced by scheduler jobs
   or finality events, once per fact set, and served from storage. No route
   calls the model while a manager waits. The one exception is a
   commissioner's manual recap rebuild, which already stored the template
   and waits at most the client's single 30-second attempt for the rewrite.
5. **Nothing a manager typed goes in.** Team names, chat, trade notes and
   correction reasons never enter a prompt. Where a Narrative must name a
   Team, the facts carry a placeholder token for it and the client swaps the
   name back in after the model answers; an answer with a mangled token is
   discarded for the template.
6. **One client, one budget.** Every call goes through one server module
   that pins the model, records usage per call, and refuses to call once the
   month's `ANTHROPIC_MONTHLY_BUDGET` is spent, in the Tank01 idiom. The
   feature is on exactly when `ANTHROPIC_API_KEY` is set; there is no
   per-league switch.

The cost is a ceiling on what Claude can do here: no conversation, no
answering a manager's question, no feature whose value is the model's
judgment rather than its prose. That is the trade we want while every league
shares one key and one bill.

## Considered options

- **Live calls from the route with a spinner.** Rejected: latency and cost
  scale with page views, and an outage becomes a product outage.
- **Open-ended league assistant in League chat.** Rejected for now: unbounded
  spend per manager and a prompt-injection surface made of Team names and
  chat. Revisit under a per-league budget and an input policy of its own.
- **Per-league Narratives under each league's scoring rules.** Rejected for
  the Projection explanation: players times leagues times weeks for text
  that names factors, not values. Matchup narratives are per league by
  nature and stay so.
- **Optional SDK via try/catch require.** The status quo. Rejected: the
  package was never a dependency, so production most likely never ran a
  model call at all, and nothing reported it.
