# Recap storage and scaling

## Current boundary

`private.game_recaps` is the durable read model. The application connection currently owns migrations and serves runtime traffic through the same `DATABASE_URL`. The migration grants that safely quoted `current_user` only `SELECT`, `INSERT`, and `UPDATE` access and creates matching RLS policies; there is no delete policy. Because a table owner can bypass RLS, separate migration-owner and runtime credentials remain the long-term least-privilege target.

Do not add a persistent job table while one server process owns recap generation. The in-process queue remains simpler and preserves the existing `enqueueRecap(gameId, opts)` interface.

## Trigger for a persistent queue

Create `private.recap_jobs` before deploying a second server instance or a separate worker. At that point an in-memory dedupe set cannot coordinate processes and can lose queued work during restarts.

The durable queue should include:

- A unique game ID so concurrent enqueue attempts converge on one job.
- Status, attempt count, `next_attempt_at`, lease owner, lease expiration, created/updated timestamps, and a bounded last-error field.
- Atomic claims using `SELECT ... FOR UPDATE SKIP LOCKED`, followed by a short lease update in the same transaction.
- Expired-lease recovery, exponential retry scheduling with jitter, a maximum-attempt policy, and an operator-visible dead-letter state.
- Idempotent recap upserts as the final correctness boundary.

Keep `enqueueRecap(gameId, opts)` unchanged at call sites. Its implementation can switch from the local queue to an idempotent job upsert. Run dedicated locked workers; web processes should enqueue but should not each run an independent reconciliation scheduler. Use one elected scheduler or an advisory lock for reconciliation.

## Operations

Track queue depth and oldest-job age, claim latency, active leases, attempts, retry reasons, permanent failures, generation duration, provider latency/rate limits, stale generator-version count, and successful recap age. Alert on growing oldest-job age and exhausted attempts.

Keep public cache headers and add stable ETag support. Let the CDN serve list/detail responses with `s-maxage` and revalidation; purge or revalidate affected recap URLs after regeneration. The database remains the source of truth, not the CDN.

When infrastructure permits, split roles:

- A migration-owner role creates schemas, tables, policies, and grants but is never used by the running service.
- A non-owner runtime role receives only schema usage, table `SELECT/INSERT/UPDATE`, and sequence usage, with matching RLS policies.
- `anon` and `authenticated` retain no `private` schema, table, or sequence privileges.

Any stored JSON format change must bump both the data version as appropriate and `GENERATOR_VERSION`, because reconciliation selects stale rows by generator version.

## Manual post-migration verification

Run these checks only after applying the migration, using approved database connections. Do not place credentials in scripts or repository files.

1. With the application connection, start a transaction; insert a disposable recap with a unique game ID, select it, update it, then roll back. Confirm all three operations succeed and no row remains.
2. Confirm RLS and policies:

   ```sql
   SELECT relrowsecurity
   FROM pg_class
   WHERE oid = 'private.game_recaps'::regclass;

   SELECT policyname, cmd, roles
   FROM pg_policies
   WHERE schemaname = 'private' AND tablename = 'game_recaps'
   ORDER BY policyname;
   ```

3. As an administrative verifier, confirm client roles have no access:

   ```sql
   SELECT
     has_schema_privilege('anon', 'private', 'USAGE') AS anon_schema,
     has_schema_privilege('authenticated', 'private', 'USAGE') AS authenticated_schema,
     has_table_privilege('anon', 'private.game_recaps', 'SELECT') AS anon_select,
     has_table_privilege('authenticated', 'private.game_recaps', 'SELECT') AS authenticated_select,
     has_table_privilege('anon', 'private.game_recaps', 'INSERT,UPDATE,DELETE') AS anon_write,
     has_table_privilege('authenticated', 'private.game_recaps', 'INSERT,UPDATE,DELETE') AS authenticated_write;
   ```

   Every value must be `false`.

4. If role switching is authorized, `SET LOCAL ROLE anon` and `SET LOCAL ROLE authenticated` in separate transactions and confirm a direct `SELECT` from `private.game_recaps` fails. Also verify the Supabase Data API cannot address the private relation.
