---
name: fleet-pilot-live
description: "Fleet pilot (sentinel, dispatcher, pl-endzone) is running as of 2026-08-22"
metadata:
  type: project
---

The fleet pilot for the endzone tenant is live as of 2026-08-22 14:51 UTC: sentinel, dispatcher, and pl-endzone all launched successfully via bin/pilot.ps1 and are active in state/roster.json.

**Why:** This session (pl-endzone) is itself one of the three pilot sessions — proof the pilot is running, not just scaffolded.

**How to apply:** Any older memory (repo-level or user-level) claiming "pilot NOT launched" is stale — trust the live roster (`state/roster.json`) and `ListAgents` over that. maxIcs for endzone is 3; fleet-wide cap is set in `roster.json`'s static roster. Branch prefix for fleet ICs is `fleet/`.
