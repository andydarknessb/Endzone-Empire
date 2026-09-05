# Agent docs

Routing table for everything under `docs/agents/`. This file is tracked;
`CLAUDE.md` at the repo root is gitignored and per-checkout, so it must not
be the only thing that maps a doc to when an agent needs it (#323).
`scripts/agentDocsOrphans.test.js`, wired into `npm run guards`, fails the
build if a `.md` file lands in this directory without an entry below.

**If your checkout's local `CLAUDE.md` links straight to a doc here, point
it at this README instead** (`See docs/agents/README.md`). That shrinks
every untracked map to one pointer, so this file stays the single place
that goes stale, not each checkout's own copy.

## Docs

### Issue tracker
Read before creating, reading, listing, commenting on, or closing a GitHub
issue, or working the wayfinder map/child/blocking flow.
See `docs/agents/issue-tracker.md`.

### Triage labels
Read when a skill names one of the five canonical triage roles
(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`,
`wontfix`) and you need this repo's actual label string for it.
See `docs/agents/triage-labels.md`.

### Agent briefs
Read before writing or reviewing an issue's acceptance criteria — it gives
the exists/producible/observable test a criterion must pass before it names
a result instead of a thing.
See `docs/agents/agent-briefs.md`.

### Domain docs
Read before exploring the codebase for domain vocabulary or architectural
decisions — what to read first (`CONTEXT.md` / `CONTEXT-MAP.md` /
`docs/adr/`), how to use the glossary's terms, and when to flag a
contradiction with an existing ADR.
See `docs/agents/domain.md`.

### Design canvases
Read before drafting any mockup, wireframe, screen flow or marketing
artboard with the `/design` skill: where the design tokens and MUI theme
live, which screen to match first, the house-style copy rules that carry
into artboard text, and where a canvas's working files are kept.
See `docs/agents/design.md`.

### Production data state
Read before treating a query against the shared production Supabase
database as confirmation of anything — what tables are populated as of the
last measurement, and why a zero result there is not evidence a feature is
broken.
See `docs/agents/production-data-state.md`.

### Refusal tests
Read before writing or reviewing a test for a refusal that guards a
mutation (an authorization check, a state-machine guard) — the rule that a
refusal test must also assert the forbidden write happened zero times, not
just that the response looked right.
See `docs/agents/refusal-tests.md`.

### Stale worktree directories
Read when a test run's result looks path-dependent, or a command run from
inside a `.claude/worktrees/<name>` directory behaves like it ran against
the main checkout instead.
See `docs/agents/stale-worktrees.md`.
