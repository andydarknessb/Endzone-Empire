# Data retention policy

| Record | Default | Enforcement |
|---|---:|---|
| Expired/used reset and verification tokens | 7 days | Daily worker cleanup |
| Expired/revoked refresh tokens | 30 days | Daily worker cleanup |
| In-app notifications | 365 days | Daily worker cleanup; configurable with `RETENTION_NOTIFICATION_DAYS` |
| League chat | 730 days | Daily worker cleanup; configurable with `RETENTION_CHAT_DAYS` |
| Application/request logs | 30 days | Configure in Render |
| Security/error logs | 90 days | Configure in Render/Sentry; extend only for an active incident |
| Open abuse reports | Until resolved | Moderator workflow |
| Resolved abuse reports | 2 years unless counsel approves another period | Scheduled review |
| Backups | Supabase plan/PITR setting | Verify quarterly; deletion ages out with backup expiry |

- A legal hold suspends affected deletion and must identify scope, owner, basis, and release date.
- Retention jobs delete in bounded batches. Monitor their failures through worker heartbeat/error alerts.
- Review this policy annually and whenever a new data type or legal jurisdiction is added.
