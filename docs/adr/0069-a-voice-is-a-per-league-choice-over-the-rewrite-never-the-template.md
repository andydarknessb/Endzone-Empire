# A Voice is a per-league choice over the rewrite, never the template

Status: accepted (2026-10-17)

The request was to give the Narratives the Draft assistant's character, asked
for by a borrowed name. ADR 0027 and #784 ruling 3 already settled the name:
the character is "Polk High Legend", an original archetype, with no borrowed
names in copy or code. What was left open is who chooses it for text a whole
league reads, and what it may touch. ADR 0063 #6 says there is no per-league
switch for Claude itself, so a per-league setting that sits beside the
Narratives needs saying out loud.

We decide that a Voice is a league setting, `narrative_voice`, chosen by the
commissioner, neutral by default, and that it reaches only the Recap and the
Matchup narrative (preview and postgame):

1. **The rewrite carries the Voice, the template never does.** The stored
   template stays neutral. When the rewrite fails, is discarded or the budget
   is spent, that Narrative reads neutral, and the Voice is simply absent.
2. **The Voice is a block at the head of the system prompt.** The
   surface's own rules follow it and win: facts only, team tokens, the
   preview's no-digit rule, the postgame's number check.
3. **A deny list discards a rewrite.** A rewrite that names a borrowed
   character, place or catchphrase falls back to the template, the same way a
   mangled team token does. A term that also appears in the facts is exempt,
   since real players share those names (Justin Jefferson), and the bare word
   "married" is not on the list.
4. **A change applies forward.** Switching the Voice never rewrites stored
   text; the next Narrative the league generates uses it.
5. **The public game recap and the Projection explanation are always
   neutral.** One is the site's face to logged-out readers, the other sits
   beside an engine number.

This does not reopen ADR 0063 #6: whether Claude runs at all is still one key
and one budget for every league. The Voice only chooses how a rewrite that
would run anyway sounds.

## Considered options

- **One house Voice for every league.** Rejected: a Recap is shared text, and
  a league that wants the plain version has no way out.
- **A per-manager toggle.** Rejected: one fact set would need two stored
  rewrites, doubling spend for text the league otherwise reads in common.
- **A hand-written persona template set per surface.** Rejected: a large copy
  table to keep the Voice through a failed rewrite, for surfaces where neutral
  is an acceptable fallback.
- **Honor the push `banter` setting on Recap pushes.** Rejected: `banter`
  governs push alert lines; the Recap excerpt is the league's text, and
  keeping a neutral copy for it would add a stored column and a branch per
  push.

## Consequences

- One server module holds the Voice block, its example sentences and the deny
  list, with a unit test over the deny list.
- A manager with `banter` off still gets a Recap push in the league's Voice.
- Adding a second Voice is a new value for `narrative_voice` and a new module,
  under the same rules.
