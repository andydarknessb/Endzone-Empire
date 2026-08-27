# No em dashes in user-facing copy

Status: accepted (2026-08-27)

This repository's house style bans the em dash (U+2014, `—`) from copy a
user can see. The rule dates to the sweep on release `4c7dcec` (2026-07-26),
which set its scope as *what a user can see*, not every character in the
tree. Until now the rule had no consumer (ADR 0010: a convention with no
reader is unaudited): it lived in a few per-string tests, in code comments
that said "house style", and in the gitignored per-checkout `CLAUDE.md`. Its
observed health was produced by hand, a reviewer byte-checking a diff, and
that method missed live defects: the evidence a guard was needed
(issue #501): four em dashes in the preseason Week 2 recap article
(`src/content/articles/preseason-week-2-recap.jsx`), shipped in the last
client release, and one in a thrown `Error` message in
`server/services/correction.service.js`.

## Scope

The rule applies to rendered, user-facing text only:

- prose in article/page content (JSX text, string and template literal
  content that reaches a component)
- strings a user reads indirectly, such as a thrown error message shown in
  a toast or logged to a user-visible surface
- HTML-entity escapes of the character (`&mdash;`, `&#8212;`) are exactly as
  in scope as the literal character, since they render identically once the
  browser decodes them: one of the original sweep's misses hid as an
  escaped entity in an SEO title

The rule does **not** apply to, and this ADR's guard does not scan:

- comments (`//`, `/* */`, JSX `{/* */}`), JSDoc, test titles and assertion
  messages: none of these render to a user, and the original sweep
  deliberately left them alone
- SQL text, including the `--` SQL-comment em dashes embedded in knex
  migration template strings under `server/db/migrations/`: SQL is never
  rendered
- CSS `content:` values, Markdown under `docs/`, email templates and the
  recap LLM prompts (the prompts already instruct "no em dashes" directly).
  If one of these turns out to need coverage, that is a follow-up, not a
  silent widening of this guard's scan
- en dashes (`–`), which mark a range (`Week 15-17`, `A-F`) and are a
  different convention entirely, untouched by this rule

## Replacement table

The sweep that set the rule's scope also established what an em dash
becomes. New copy follows the same table; it is not a menu of equally-good
options:

| Situation | Replacement | Example |
|---|---|---|
| A parenthetical or an aside in prose | Real punctuation (comma, colon, full stop); rewrite the sentence rather than substitute a hyphen | `a legitimate late-round watch, not proof of a regular-season target share.` |
| A label separator the app already renders | The middot (`·`) | `alice · commissioner` |
| A score | A hyphen | `DEN 10 - 17 KC` |
| An empty table cell | A plain `-` | `-` |

## Consumer

Per ADR 0010, this convention ships with its consumer: `scripts/emDashGuard.js`
(and `scripts/emDashGuard.test.js`, which runs it against the real tree) is
that consumer. It joins the `guards` npm script directly, following the
shape of `scripts/eslintRuleScoping.test.js` and `scripts/agentDocsOrphans.test.js`:
a `node:test` file whose assertions read the tree, with no `check:`
wrapper and no workflow edit, since `npm run guards` is already a
CI-required job. It scans `.js`/`.jsx`/`.ts`/`.tsx` under `src/` and
`server/`, excluding test/spec files and `server/db/migrations/`, stripping
comments before matching so a comment is never a hit. A per-path allowlist
with a reason per entry exists for a legitimate future exception; it is
empty as of this ADR.

## Rejected shapes

- **A rule over every file, including comments.** The original sweep
  deliberately did not adopt this: a comment or test title styles nothing a
  user sees, and sweeping them in would fail the build on the sentence
  explaining this very rule (this document included) without protecting
  any actual copy. Comments, JSDoc, test titles, assertion messages and SQL
  stay exempt by ruling.
- **A changed-lines-only diff guard.** Scoping the check to a PR's own diff
  would have left the four em dashes already live in the preseason Week 2
  recap article unreported forever, since no future PR touches those exact
  lines. A tree-wide guard is the only shape that catches a defect that
  shipped before the guard existed, which is exactly the failure #501 found.
