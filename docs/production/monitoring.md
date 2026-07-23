# Monitoring and alert thresholds

| Signal | Warning | Critical |
|---|---|---|
| External uptime | 2 consecutive failures | 3 failures or 3 minutes |
| API 5xx | >1% for 15 minutes | >2% for 5 minutes |
| API p95 | >750 ms for 10 minutes | >1.5 s for 5 minutes |
| Database pool | >70% used | >80% used or waiters >0 for 5 minutes |
| Database p95 query | >250 ms | >1 s |
| Process memory | >75% for 15 minutes | >85% for 10 minutes |
| Event-loop lag | >50 ms for 10 minutes | >100 ms for 5 minutes |
| Worker heartbeat | Older than expected interval | Older than 15 minutes or `last_error` set |
| Provider failures | >1% or quota below 30% | >5%, repeated 429, or quota below 20% |
| Email delivery | Any sustained rejection | >1% failures for 5 minutes |
| Crash/restart | Any unexpected restart | Crash loop |
| Backup age | >24 hours | >26 hours |

- Synthetic checks run from at least two regions against the homepage, `/api/health/readyz`, a public API, and a safe staging authentication flow.
- Every alert includes environment, service, release SHA, request ID when applicable, dashboard link, and runbook.
- Primary and backup responders, notification channels, and quiet-hours escalation must be configured in Render/Sentry and the selected synthetic provider before launch.
- Tune thresholds after two weeks of representative traffic; do not silently disable noisy alerts.
