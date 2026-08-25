# Roster tenure is a recorded fact, maintained by trigger

Status: accepted (2026-08-23)

Nothing in the schema recorded roster membership over time, so every rule that
needed "did team T hold player P at kickoff K" read a proxy: the current
`team_players.created_at`, which cannot tell a re-acquisition from an
acquisition, or `lineup_entries.created_at`, which records when a week happened
to be materialized rather than when anyone joined a roster. The #190 settle
pass closed every enumerated case but one (#229) with a relational rule over
those two proxies, and that rule was correct only because of how the insert and
removal paths happened to behave. We record the fact instead: `roster_tenures`
holds one row per tenure (team, player, `acquired_at`, `released_at`), and a
trigger on `team_players` opens a tenure on every INSERT and closes it on every
DELETE, so no caller, including the draft-reset bulk delete that bypasses the
service chokepoint, can forget to write it. The settle pass and the
lineup-entry spare predicate read this one fact; `team_players.created_at` is
no longer a correctness input anywhere.

## Considered options

- **Call-site writes at the six acquisition seams and the removal chokepoint.**
  Rejected: it is correct only while every caller remembers, and the draft
  reset already bypasses the chokepoint.
- **A lineup snapshot on finality (#106 option 3).** Rejected: larger for the
  same outcome, and it collides with the glossary's reserved **Snapshot**.
- **Reconstructing closed tenures from the `transactions` log.** Rejected:
  trades log no players and the draft logs nothing, so the result would be a
  proxy with a new name.

## Consequences

- History starts at the migration. Open tenures are backfilled from
  `team_players.created_at`; tenures that had already closed are unknown, so
  the first week the fact is complete is the first week that starts after
  deploy.
- The test fakes do not run triggers. A test that reads a tenure must seed
  `roster_tenures` rows explicitly rather than derive them from `team_players`.
- Timestamps are transaction start time (`now()`), so a trade's
  delete-and-insert releases one tenure and opens another at one instant, and an
  acquisition shares its timestamp with the lineup row it materializes.
