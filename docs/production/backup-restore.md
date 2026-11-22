# Backup and restore runbook

Target: RPO at most 15 minutes and RTO at most 4 hours after PITR is enabled.

## Pre-launch verification

- [ ] Confirm the Supabase plan, daily-backup retention, PITR interval, database region, and encryption controls.
- [ ] Enable PITR or document a formally accepted alternative RPO.
- [ ] Configure an encrypted, access-restricted logical backup in a separate approved account/provider.
- [ ] Use a dedicated backup role with read-only access; never use the application or schema-owner credential.
- [ ] Alert when the last successful backup is older than 26 hours.
- [ ] Record immutable-backup expiry in the Privacy Policy and deletion procedure.

## Quarterly restore drill

1. Create an isolated non-production Supabase/PostgreSQL target with no outbound email, push, sports-provider, or worker credentials.
2. Restore a selected recovery point or logical dump.
3. Run migrations only when required by the selected application release.
4. Validate row counts and referential integrity for users, leagues, teams, rosters, matchups, transactions, refresh tokens, and worker heartbeats.
5. Start the API with jobs disabled and execute read-only smoke tests.
6. Record backup timestamp, achieved RPO/RTO, validation results, failures, and remediation owner.
7. Destroy the temporary database securely after evidence is approved.

Never test restores over the shared production database.

## Automated restore drill

`.github/workflows/restore-drill.yml` runs `scripts/ci/restore-drill.sh` on the 1st of each month at 09:23 UTC, and on demand. It dumps the `public` and `private` schemas from production with `pg_dump`, restores the dump into a throwaway PostgreSQL 17 database on the runner, and checks the copy against the source: table count, `knex_migrations` rows, and at least one row in each of `users`, `leagues`, `teams`, `players` and `player_stats`. It then runs integration's pending migrations on top of the copy. The run summary shows table and migration counts and a yes or no for the core tables, never row counts. Nothing is uploaded, and the dump is deleted when the job ends.

It proves that a logical dump of production restores into a clean database, and that integration's migrations apply to a copy of production's schema and data. It does not prove that the app role can run those migrations, because they run on the copy as the runner's superuser. It does not prove Supabase's own backups or point-in-time recovery, and it does not cover objects outside `public` and `private`.

Before adding the secret, restrict the `monitoring` environment to deployments from `main`: the repository is public, and an unrestricted environment hands its secrets to any branch's workflow.

The drill reads one secret, `MONITORING_DATABASE_URL`, from the `monitoring` environment. Set it to Supabase's session pooler URL (the pooler host on port 5432): the direct host is IPv6 only, and the transaction pooler on port 6543 cannot run `pg_dump`. The URL must use the app role's own login, or a role with `BYPASSRLS`, `USAGE` on `public` and `private`, and `SELECT` on every table and sequence in both, because `pg_dump` fails on a table whose row-level policies would filter it. Percent-encode the password. Without the secret the job warns and ends green without running the drill.

Do not release or deploy while the drill runs: `pg_dump` takes a lock on every table for the length of the dump, and a migration's `ALTER` would wait behind it.
