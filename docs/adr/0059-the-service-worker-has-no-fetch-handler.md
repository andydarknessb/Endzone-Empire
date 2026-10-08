# The service worker has no fetch handler

Status: accepted (2026-10-08)

Amends ADR 0004: the "service worker's API allowlist" that ADR 0004 names as
the admission rule for the in-memory resource cache is now the fixed list of
read-only, viewer-safe GETs given under Decision below. The list lives in this
ADR, not in code, and `dropSessionCaches` no longer clears a service worker
store, because the worker no longer writes one.

Until now the production service worker answered every page load, script and
API read through a `fetch` listener (an app-shell cache, a cache-first static
store and a network-first allowlisted API store), so Chrome had to start or
wake the worker before any of them could go out. #2072 measured what that
costs. With the renderer hidden or throttled, a page load behind the worker
took 1.1 s warm and 301 s cold, against 2 ms with no worker; a clean profile
was unaffected. Navigation preload (#2074) took the page request off the
worker's critical path but not the script and API reads, and did not help.

We decide that the worker has no `fetch` listener. Chrome does not start a
worker for a load when none is registered, so page loads, scripts and API
reads never wait on it. The worker exists for push notifications only
(`push` and `notificationclick`). `activate` deletes every cache name in
`caches.keys()`, so browsers still holding `endzone-shell-v1`,
`endzone-shell-v2` or `api-cache-v1` drop them on the next activate, and it
disables navigation preload, a property of the registration that #2072
enabled and that stays on until it is switched off. The page registers the
bare `/service-worker.js`; the `?api=<origin>` query existed only so the fetch
handler knew the API origin.

The cached reads ADR 0004 admits are, as before, these read-only,
viewer-safe GETs (a GET qualifies only if it is on this list and more than one
mount reads it per typical navigation):

- `/api/league`
- `/api/league/:id`
- `/api/league/:id/matchups` and `/api/league/:id/matchups/:week`
- `/api/team/roster`
- `/api/team/lineup`
- `/api/scoring/league/:id/standings`
- `/api/scoring/league/:id/power-rankings`
- `/api/scoring/league/:id/recap`
- `/api/pickem/league/:id/settings`
- `/api/pickem/league/:id/standings`
- `/api/pickem/league/:id/week/:n`

## Considered options

- **Keep the handler and rely on navigation preload (#2074).** Rejected: it
  moved only the page request, and the scripts and API reads still waited on
  the worker's start.
- **Keep the handler for the API reads only.** Rejected: any listener makes
  Chrome start the worker for every load.

## Consequences

- No offline app shell and no offline API fallback. This is a documented
  feature loss. The offline lineup queue and banner are unaffected: they use
  localStorage and `navigator.onLine`, not the worker.
- The #2019 cache-poisoning class (an SPA 200 for a missing hashed asset
  stored under the script's URL) cannot recur from the worker. The Netlify
  404 rule for `/static/*` and `lazyWithReload` stay.
- Push is unchanged.
- Browsers that still hold the old caches drop them on the next activate.
- Rolling back means restoring all four at once: the `fetch` handler and
  its caches, `navigationPreload.enable()` in `activate` (restoring the
  handler alone leaves preload off), the `?api=<origin>` registration URL
  (without it production API GETs are same-origin only and never cached),
  and the `api-cache-v1` delete in `dropSessionCaches` (without it a login
  or logout leaves the previous account's viewer-scoped rows in the offline
  store).
