# Security and availability incident response

## Severity and response

| Severity | Example | Initial acknowledgement |
|---|---|---:|
| SEV-1 | Account takeover, exposed secrets, destructive database event, broad outage | 15 minutes |
| SEV-2 | Sustained 5xx/latency breach, failed scoring worker, provider outage without workaround | 30 minutes |
| SEV-3 | Limited feature degradation or isolated user impact | 1 business day |

## Procedure

1. Assign incident commander, operations owner, communications owner, and recorder.
2. Preserve request IDs, release SHA, provider events, database audit evidence, and a UTC timeline. Do not copy secrets into the incident record.
3. Contain: disable the affected feature, revoke token families, rotate compromised credentials, restrict provider access, or roll back application code.
4. Eradicate and recover using the deployment/rollback and backup/restore runbooks. Validate authorization, data integrity, workers, sockets, and external synthetic checks.
5. Determine affected users/data, processors, jurisdictions, and notification obligations with counsel. Track the GDPR 72-hour decision deadline when applicable.
6. Publish only verified facts. Record notification decisions and delivery.
7. Complete a blameless review within five business days with owners and due dates.

Quarterly tabletop scenarios: compromised JWT secret, reset-token disclosure, duplicate waiver worker, bad migration, Supabase outage, and corrupted backup.
