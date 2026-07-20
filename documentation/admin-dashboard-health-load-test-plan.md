# Admin dashboard health load test

## Objective

Exercise the authenticated lineup read path with 500 concurrent regular users while a platform administrator forces a Tank01 stats refresh. The run must prove that the admin command completes, the sync result contains refresh counters, and the admin overview exposes updated stats coverage without 5xx/504 responses or database-deadlock signatures.

## Workload

- `regular_lineup_traffic`: 500 constant VUs, `GET /api/team/lineup?leagueId=<id>`.
- Each VU uses a token selected from `USER_JWT` or the comma-separated `USER_JWTS` pool and pauses between reads using `USER_THINK_TIME_SECONDS` (default 2 seconds).
- `admin_emergency_sync`: one authenticated VU starts during the regular-user run and posts `{ season, week }` to `POST /api/admin/sync/stats`.
- The admin VU immediately reads `GET /api/admin/overview` and verifies that `sync.statsCoverage` is exposed.

## Pass/fail gates

- Admin sync and dashboard refresh rates are exactly 100%.
- Admin sync and overview have zero 504s, 5xx responses, and database-pool/deadlock signatures.
- Regular lineup traffic has no 5xx responses and at least 95% HTTP 200 success. HTTP 429 responses are counted separately as `regular_queue_limited` so queue pressure is visible rather than mistaken for a database failure.
- Admin sync p95 is below 30 seconds; dashboard refresh p95 is below 5 seconds.

## Execution

Run against staging or an isolated performance environment; the stats sync calls the configured external provider and writes real database state.

```powershell
$env:BASE_URL = 'https://staging.example.com'
$env:LEAGUE_ID = '7001'
$env:SEASON = '2026'
$env:WEEK = '10'
$env:USER_JWTS = 'user-token-1,user-token-2'
$env:ADMIN_JWT = 'platform-admin-token'
k6 run load-tests/admin-dashboard-health.js
```

For a shorter smoke run, set `K6_DURATION=30s` and `ADMIN_START=5s`. A local run may show 429s because the application-wide limiter is keyed by source IP; run distributed K6 workers or provide a properly configured proxy when evaluating 500 distinct users.
