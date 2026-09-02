# Supabase anon access audit (#240)

Measured 2026-09-02 against the production Supabase project with a public-key
black-box probe and read-only PostgreSQL catalog queries. No application rows
or Storage objects were read.

## Result

`live_game_states` is the only public-schema relation with effective `anon`
`SELECT`. It has RLS enabled and the sole public policy, `public read live game
states`, grants `SELECT` to `anon` and `authenticated`.

Every other public table and view has no effective `anon` `SELECT`, `INSERT`,
`UPDATE`, or `DELETE` privilege. This includes relations whose RLS flag is
disabled: without a grant, those relations are not reachable through the Data
API. A zero-row `GET /rest/v1/<relation>?select=*&limit=0` probe matched the
catalog result: `live_game_states` returned 200; the 49 application relations
created by this repository returned 401.

## Storage

`team-avatars` is the only bucket and is intentionally public. Its objects can
therefore be read by a caller who knows an object path; avatar URLs are public
presentation data. An anonymous zero/one-row list probe returned an empty list,
so the public key cannot enumerate that bucket's object metadata.

The storage catalog grants `anon` base privileges on `storage.objects` and
related Storage tables, but all Storage tables have RLS enabled and there are
no Storage policies granting anonymous rows. The apparent broad table grants
are consequently not an object-listing or object-write path.

## RPC and Realtime

All eleven public-schema routines were tested through their `/rest/v1/rpc/*`
routes with the public key; each returned 404. Several trigger helper routines
inherit PostgreSQL `EXECUTE` from the legacy default ACL, but they are not
exposed through PostgREST's anonymous RPC surface. No anonymously executable
`SECURITY DEFINER` routine was found.

`live_game_states` is the only intended anonymous Realtime data relation. Its
RLS policy is the same public-read policy described above.

## Remaining platform check

The Edge Functions endpoint does not provide an anonymous function inventory:
`/functions/v1/` returns 404, which proves neither presence nor absence of a
named deployed function. Before treating this audit as a permanent clean bill
of health, an organization or project owner must export the Supabase Dashboard
or Management API Edge Functions list and record that no function is public
without an application-authentication check. That inventory was not available
to this audit's database and service-role credentials.

## Recheck trigger

Repeat the catalog queries after any database migration that creates a public
relation, changes RLS or grants, adds a Storage bucket, or deploys an Edge
Function. In particular, the project retains Supabase's legacy
`supabase_admin` default ACLs, so a future table can receive broad base grants;
RLS and explicit grant review remain required at creation time.
