#!/usr/bin/env bash
#
# Create or update the Sentry Crons monitor that backs the holdout-uptime
# dead-man's-switch (.github/workflows/holdout-uptime.yml). Idempotent: the
# check-in POST upserts the monitor with this config. Run it whenever the
# schedule changes or the monitor is deleted or has drifted - the hourly GET
# pings from the workflow can never (re)configure it, only this can.
#
# Usage:
#   SENTRY_CRON_PING_URL='https://o<org>.ingest.<region>.sentry.io/api/<project>/cron/holdout-uptime/<key>/' \
#     bash scripts/setup-sentry-cron-monitor.sh
#
# The URL derives from the SENTRY_DSN (https://<key>@<host>/<project>) and is
# stored as the SENTRY_CRON_PING_URL secret in the repo's `monitoring`
# environment. Sentry's ingest answers 202 unconditionally (processing is
# async), so after running this, confirm the monitor and its config once in
# the Sentry UI under Crons -> holdout-uptime.
#
# checkin_margin is deliberately LESS than the hourly interval (Sentry's own
# recommendation): the miss pointer advances from each received check-in, so
# a margin above one interval would silently absorb whole missed runs and
# page hours late. At 25, one dropped GitHub run pages ~25 minutes after its
# slot - a rare false page is the accepted price of hearing about real
# silence quickly. No max_runtime: the workflow sends a single terminal
# check-in (Sentry's heartbeat pattern), which runtime tracking ignores.

set -euo pipefail

if [ -z "${SENTRY_CRON_PING_URL:-}" ]; then
  echo "set SENTRY_CRON_PING_URL (see header)" >&2
  exit 1
fi

curl --fail --silent --show-error \
  --request POST "$SENTRY_CRON_PING_URL" \
  --header 'Content-Type: application/json' \
  --data '{
    "status": "ok",
    "monitor_config": {
      "schedule": { "type": "crontab", "value": "23 * * * *" },
      "checkin_margin": 25,
      "timezone": "UTC",
      "failure_issue_threshold": 1
    }
  }' >/dev/null

echo "monitor upsert accepted (202 is unconditional - verify once in Sentry UI: Crons -> holdout-uptime)"
