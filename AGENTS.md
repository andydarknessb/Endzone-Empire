# AGENTS.md

Configuration for the engineering skills (`mattpocock/skills`). Written by
`/setup-matt-pocock-skills`; edit `docs/agents/*.md` directly to change any of it.

**This file IS tracked, and it auto-loads.** That distinguishes it from
`CLAUDE.md`, which `.gitignore` keeps untracked precisely because auto-loading
from inside a clone defeated the review-independence bar (round-2 disclosure,
commit `c4a4003`). Tracking this file was chosen deliberately, with that
tradeoff known. It carries pointers only — no findings, no study state, no
review material — so a reviewer who reads it learns where the tracker config
lives and nothing about the work under review. **Any commission asserting
independence from a fresh clone should disclose this file's presence**, on the
same terms `c4a4003` set for `CLAUDE.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `andydarknessb/Endzone-Empire`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
