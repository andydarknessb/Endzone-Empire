# Database access and least-privilege rollout

Do not apply role changes from an application process. Execute them as the
Supabase database owner during an approved maintenance window after validating
every required query in staging.

## Required roles

- `endzone_runtime`: login used only by API and worker; `CONNECT`, schema
  `USAGE`, sequence usage, and DML on the application tables it needs. It must
  not own schemas, tables, functions, migrations, extensions, or roles.
- `endzone_migrator`: deployment-only login that owns or can alter application
  objects. It is unavailable to the running API and worker.
- `endzone_backup`: read-only login used only by the encrypted backup job.
- `endzone_support_readonly`: optional time-bound role for production
  diagnosis; no routine human login receives runtime or migration credentials.

## Staging procedure

1. Inventory runtime SQL from routes, services, workers, health checks, and
   Socket.IO handlers. Grant only the required table/function operations.
2. Revoke `CREATE` on schema `public` from `PUBLIC` and the runtime role.
3. Set default privileges under the migrator so new objects do not become
   public and receive only reviewed grants.
4. Configure distinct `DATABASE_URL_RUNTIME` and
   `DATABASE_URL_MIGRATIONS`; configure the backup job separately.
5. Run API, worker, migration, export/deletion, avatar, draft, waiver, scoring,
   Socket.IO, and health smoke tests using the exact staging roles.
6. Query `information_schema.role_table_grants`, `role_routine_grants`, and
   `pg_roles` as evidence that runtime cannot create/alter/drop objects or
   grant roles.
7. Rotate all previous shared credentials after production cutover.

Keep the Supabase service-role key server-only. It bypasses RLS and must be
limited to the storage/server operations that require it, separately from the
PostgreSQL runtime credential.
