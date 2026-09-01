# Use a local FSD island for Draft order controls

Status: accepted (2026-08-30); scope superseded by ADR 0020 (2026-09-01)

The Draft order enhancement will introduce `src/widgets/draft-order` and
`src/features/autodraft-toggle` as a local Feature-Sliced Design island
consumed by the existing `DraftRail`, rather than moving the entire frontend
into FSD directories. The widget owns ordered Team-row presentation and the
feature owns the accessible Autodraft control; the existing Draft contracts,
Team identity, permission rules, and side effects remain at the current seam.
This keeps the visual change local and testable without creating a large,
low-value migration or widening the DraftRail interface.

## Consequences

- The row layout can be changed and verified through one widget interface,
  while `DraftRail` continues to own Draft-status composition.
- The shared row structure serves desktop and mobile, preventing responsive
  drift between two implementations.
- Existing `teamsInDraftOrder`, `teamId`/`teamName`, accessible labels, and
  Autodraft callback behavior remain compatibility constraints.
- A future repo-wide FSD migration remains possible, but is not a prerequisite
  for this enhancement.
