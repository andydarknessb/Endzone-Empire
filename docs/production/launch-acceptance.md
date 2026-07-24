# Production launch acceptance

Repository controls are necessary but do not verify provider state. Production
promotion remains blocked until every unchecked external item below has an
owner, evidence link, completion date, and independent reviewer.

## Provider and identity controls

- [ ] Publish the operator legal identity, privacy/security contact, and
  effective dates in the Privacy Policy and Terms.
- [ ] Configure and test the verified transactional-email domain, SPF, DKIM,
  DMARC, sender, bounce handling, and production SMTP secrets.
- [ ] Configure server/browser Sentry projects, releases, hidden source maps,
  PII settings, and controlled staging exceptions.
- [ ] Sync the reviewed Render blueprint; verify web/worker separation, Redis,
  database CA, pool limits, readiness path, shutdown delay, and provider quotas.
- [ ] Configure Netlify production/preview variables, CSP/header behavior,
  deploy hooks, previous-deploy rollback, and DNS/TLS.
- [ ] Enable protected GitHub branches/environments, required checks,
  deployment approval, secret scanning/push protection, and restricted secrets.
  - Blocked as written: the `production` environment exists with its two
    variables set, but GitHub rejects environment protection rules on a private
    repo under the current billing plan (HTTP 422), so **deployment approval
    cannot be enabled**. Satisfying this item requires a plan upgrade, making
    the repo public, or a documented, accepted exception.
- [ ] Approve a named, time-bounded exception for the 29 CRA development-only
  audit findings or complete the Vite migration; deployable frontend/API
  dependency audits must remain at zero.

## Recovery and operations

- [ ] Confirm Supabase plan, backup retention, PITR, encryption, region, and
  off-provider encrypted backup.
- [ ] Complete an isolated restore drill proving RPO at most 15 minutes and RTO
  at most 4 hours.
- [ ] Complete frontend, API, worker, configuration, and migration rollback
  drills in staging.
- [ ] Configure multi-region synthetics for homepage, `/api/health/readyz`,
  public API, and a safe staging login.
- [ ] Configure the dashboard, thresholds, two alert channels, primary/backup
  ownership, and incident acknowledgement expectations.
- [ ] Run active-socket and active-job deployment tests and prove no duplicate
  scheduler actions.

## Release evidence

- [ ] Unit, server, security, E2E, migration up/down/up, strict production
  build, bundle budget, production dependency audit, CORS, and Socket.IO checks
  pass for the exact release commit.
- [ ] Password reset and verification emails arrive without address, token, or
  link content appearing in logs.
- [ ] Account export, recent-auth deletion, ownership conflict, avatar cleanup,
  user block/report, retention, and worker-heartbeat paths pass in staging.
- [ ] Privacy disclosures match the deployed processors, retention periods,
  backup expiry, rights workflow, minors policy, and free-to-play behavior.
- [ ] Release record contains commit SHA, migration version, recovery point,
  approver, smoke-test evidence, and rollback authority.

Paid entry, wagering, wallets, or prizes are not authorized by this checklist
and require a separate legal, age, identity, geolocation, sanctions, payment,
and contest-integrity review.
