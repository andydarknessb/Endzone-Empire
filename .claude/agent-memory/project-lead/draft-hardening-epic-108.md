---
name: draft-hardening-epic-108
description: "Issue #108 spec parent for 18-ticket Draft-hardening epic (#109-#125); dependency graph and launch progress"
metadata:
  type: project
---

Issue #108 "Spec: Harden the draft experience across identity, scheduling, and accessibility" is a spec-parent issue (filed 2026-08-21) with 17 child tickets, #109-#125, wired with native GitHub blocking dependencies (`issue_dependencies_summary` via `gh api repos/andydarknessb/Endzone-Empire/issues/<n>`).

**Why it matters:** Like issue #94 before it, #108 itself must never be implemented directly or closed by an IC — it closes only when every child ticket closes. Children are gated: most have `blocked_by > 0` and are not launchable until their blockers close.

**How to apply:** Before launching an IC on any #109-#125 ticket, check its `issue_dependencies_summary.blocked_by` — only launch when it's 0. As of 2026-08-22, only #109 (domain language + ADR, doc-only) and #110 (deterministic DraftBoard browser harness) were at the frontier (`blocked_by: 0`), and both blocked 5 other tickets each. Launched ic-109 and ic-110 that day. Re-check the frontier each pass — closing #109/#110 should unblock the next wave (likely the Team-identity contract tickets #111-#115, which #109/#110 partially blocked). See [[fleet-pilot-live]].
