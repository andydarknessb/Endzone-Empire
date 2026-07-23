# Deployment, migration, and rollback runbook

## Promotion

1. Pull request: required CI, dependency review, CodeQL, secret scan, unit/server/security/E2E tests, migration smoke test, build, and bundle budget.
2. Merge to `main`: deploy the immutable commit to staging.
3. Apply backward-compatible migrations, then smoke-test `/api/health/readyz`, CORS, refresh-cookie rotation, Socket.IO reconnect, public pages, account export, and worker heartbeat.
4. Require production-environment approval. Record commit SHA, migration list, approver, and backup recovery point.
5. Deploy API and worker, then Netlify. Observe errors, p95 latency, pool pressure, worker freshness, sockets, and provider failures for at least 15 minutes.

## Migration rule

- Expand: add nullable/defaulted structures and dual-compatible code.
- Migrate: backfill idempotently with observable batches.
- Contract: remove old structures only after all running releases stop using them.
- Never combine destructive schema removal with the first code release that stops using it.

## Rollback

- Frontend: publish the prior Netlify deploy.
- API/worker: use Render rollback to the prior successful commit.
- Configuration: restore the prior reviewed environment version and rotate any exposed value.
- Database: prefer forward-fix migrations. Use PITR only after incident-command approval because it can discard newer valid writes.
- Feature: disable the affected capability when a feature flag exists.

Abort promotion on readiness failure, migration error, 5xx above 2%, p95 above 1.5 seconds, stale worker heartbeat, or failed auth/socket smoke test.
