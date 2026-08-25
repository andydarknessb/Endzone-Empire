# The anonymous database surface is exactly live_game_states, and default privileges are revoked

Status: accepted (2026-08-25)

The Supabase anon key ships in the public JS bundle, so the browser can reach
PostgREST and Realtime with no Endzone session at all. What that key can read
is bounded by table grants and RLS in the Supabase project, not by anything in
this repository, and the development database is the production database.
What the `anon` and `authenticated` roles may reach is therefore a decision,
recorded here, and not a property of whatever the catalog happens to say.

The decision: the anonymous surface is exactly `SELECT` on
`public.live_game_states` (the live NFL clock, served without a session on
purpose), the `supabase_realtime` publication carries only that table, the
only public storage bucket is `team-avatars` (avatars are served by URL), and
no function in `public` is executable by `anon` or `authenticated`. Anything
else the browser roles can reach is a defect, and #240's catalog-backed guard
test names the intended set so that adding to it is a visible diff.

Two REVOKEs carry the decision, ruled 2026-08-25 and run by the maintainer
(agents do not make database changes here):

- **Default privileges are revoked** for `anon` and `authenticated` on tables,
  sequences and functions created by `postgres` or `supabase_admin` in
  `public`. Supabase's default ACL grants those roles ALL on anything the
  dashboard SQL editor creates, so before this the model held only because
  every relation had been created as `endzone_app` through knex migrations.
  One table made from the dashboard would have been readable and writable by
  the browser the moment it existed. `service_role` keeps its defaults: it is
  the server-side bypass role Supabase tooling expects to hold everything, and
  it never reaches a browser.
- **`fn_normalize_nfl_team(text)` loses PUBLIC execute.** It was harmless
  (a pure text normaliser, not SECURITY DEFINER) and nothing in the client
  calls it; every caller is server-side SQL running as `endzone_app`. An empty
  set is a stronger invariant for the guard to hold than a one-entry allowlist
  that has to explain itself.

## Considered and rejected

- **Rely on the guard test alone.** It runs in CI after the fact, against the
  shared production database; a REVOKE prevents, a test detects a cycle later.
  The guard stays, as proof the REVOKEs hold, not as the control.
- **Require RLS on every table instead.** RLS on a table with no grant is
  unreachable anyway, and a grant on a table with RLS disabled is fully
  readable; the grant is the mechanism that matters, and default privileges
  are where grants appear without anyone writing one.
- **Revoke `service_role` too.** Rejected: it would break Supabase's own
  server-side tooling for no exposure gained.

## Consequences

- A new anonymous read (a public scoreboard, say) is an explicit `GRANT` plus
  a change to the guard's expected set and an amendment to this ADR, never a
  side effect of creating a table.
- Objects created from the dashboard SQL editor are now unreachable by the
  app's browser roles by default. That is the intended direction: migrations
  run as `endzone_app` are the path that carries grants deliberately.
- `docs/qa/240-anon-supabase-surface.md` records the queries and the dated
  catalog state; re-read the live catalog before claiming the surface is
  still confined.

Refs #240, #201 (the route audit this is the database-side companion to),
#242 (the same principle applied to the health payload).
