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
