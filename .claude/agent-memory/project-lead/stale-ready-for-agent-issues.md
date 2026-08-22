---
name: stale-ready-for-agent-issues
description: "Some ready-for-agent issues are already resolved by Cory's own manual (non-fleet) work; verify before launching an IC; watch PR #104/#105 vs the Team-identity epic"
metadata:
  type: project
---

As of 2026-08-22, issues #80, #94, #95, #97, #98, #99, #100 all still carry `ready-for-agent` and are unassigned, but the underlying work already exists outside the fleet, done by Cory directly (not a fleet IC): #96→PR #101 (merged), #97→PR #102 (open), #100→PR #103 (open), a dashboard fix→PR #104 (open), client visibility→PR #105 (open), #95/#98/#99 merged to Cory's **local** main only (deliberately unpushed — Netlify auto-publishes main on push), and #80's fix is PR #83 (open). None of those PRs use the `fleet/` branch prefix, which is the tell.

Dispatcher confirmed this call 2026-08-22 and logged it under "Needs Cory" in state/STATUS.md (not escalated — nothing blocked on it). Treat these seven issues as off-limits for IC launches until Cory rules on the label; dispatcher will relay if he clears them.

**Collision to watch:** PR #105 (open, not fleet's) touches `server/routes/team.router.js` and `src/components/TeamManagement/TeamManagement.jsx`. The Draft-hardening epic's Team-identity tickets — #111 "Require explicit Team names...", #112 "Expand league-shared contracts with Team identity", #113/#114 (migrate surfaces to Team identity) — are very likely to touch those exact same files. Before launching an IC on #111-#115, check whether PR #105 has merged; if not, either wait or have the IC coordinate/rebase to avoid duplicate/conflicting Team-identity work. #109/#110 (launched 2026-08-22) don't touch these files, so no conflict yet.

**Why:** Launching a fleet IC against one of these issues (or a Draft-epic ticket that collides with an in-flight manual PR) would duplicate or conflict with work already done/in-flight. The `ready-for-agent` label alone is not proof an issue is actually unclaimed — only Cory applies/removes it, and it can go stale when he does the work himself before triage catches up. See the repo-level memory `ir-enforcement-design` (in the main Endzone-Empire project memory, not this agent-memory dir) for full detail on the #94-#100 IR-enforcement chain.

**How to apply:** Before launching an IC on an old-looking ready-for-agent issue, check `git log`/`git branch -a` for a branch or PR already referencing that issue number, and check whether any local-main commits already implement it. Before launching #111-#115 specifically, run `gh pr diff 105 --name-only` (or check if it's merged) and compare against the ticket's likely surface. If work already exists outside `fleet/*`, or a live PR touches the same files, skip/delay launching and flag it in the status report / dispatcher message instead — don't silently launch, and don't unilaterally close the issue or strip the label (triage is Cory's call, not the project lead's). See [[draft-hardening-epic-108]].
