# Production data inventory

Owner review date: 2026-07-23. Re-review before each new processor or data category.

| Data | Purpose | System/processors | Default retention | Deletion behavior |
|---|---|---|---|---|
| Username, email, password hash | Authentication and account recovery | Render API, Supabase Postgres, email provider | Account lifetime | Username/email anonymized; credentials invalidated |
| Refresh/reset/verification token hashes | Session and recovery security | Supabase Postgres | Expiry plus 7–30 day security window | Deleted immediately |
| League, team, roster, draft, matchup, trade, waiver data | Provide fantasy-league functions | Render API, Supabase Postgres, sports-data providers | League history lifecycle | Membership remains linked to an anonymized user where needed for shared history |
| Chat messages, read markers, and reports | League communication, unread badges, and abuse handling | Render API, Supabase Postgres | Chat: 730 days; read markers: single overwritten row per league; reports according to incident/legal need | User messages and read markers deleted; necessary report evidence handled under legal hold |
| Notifications and preferences | Requested in-app/email/push notifications | Render API, Supabase, email/push providers | Notifications: 365 days | Deleted immediately |
| Avatar files | Team personalization | Supabase Storage | Until replacement/account deletion | Storage objects removed and database URLs cleared |
| Push endpoints and keys | Opt-in web push | Supabase Postgres, push service | Until unsubscribe or provider rejection | Deleted immediately |
| Request/security/error telemetry | Reliability, abuse prevention, incident response | Render logs/metrics, Sentry | 30–90 days unless an incident requires preservation | Expires under provider retention; do not place raw tokens or email contents in telemetry |
| Database backups | Disaster recovery | Supabase and approved off-provider backup target | Provider plan/PITR plus documented offsite schedule | Deleted data ages out when immutable backups expire |

## Processor approval gate

- Record provider legal name, role, region, DPA/SCC status, security contact, retention controls, and subprocessor link.
- Approved production processors must include Netlify, Render, Supabase, sports-data providers, transactional email, Sentry, push delivery, and any enabled AI provider.
- Do not enable a new provider or send a new data category until this inventory and the Privacy Policy are updated.
- Publish the operator legal identity and privacy contact before public launch; repository code intentionally does not invent them.
