# A hand-rolled resource cache instead of a data-fetching library

Status: accepted (2026-08-20)

Two module-level caches (`useLeague`, `usePickemStandings`) had grown the same
concurrency machinery twice, and the next cached read (pick'em settings) would
have made a third copy. The obvious fix is TanStack Query or SWR. We instead
fold them into one small in-house module (`src/lib/resourceCache.js` +
`src/hooks/useResource.js`) that every cached GET adapts over. Spec: #107.

## Why

- The surface needed is small and fixed: a shared store under structured keys,
  a TTL, in-flight promise sharing, a generation guard so a response in flight
  at invalidation never repopulates, a per-mount sequence so an older response
  never lands over a newer one, listeners for stale-while-revalidate, prefix
  invalidation, and write-through. About 150 lines, already written twice and
  tested twice.
- Session semantics are coupled to the service worker: `dropSessionCaches`
  forgets the in-memory store and the SW `api-cache-v1` store together on every
  login, logout, registration and expiry, without reloading what is mounted. A
  library needs that wiring plus a provider, and its defaults (focus refetch,
  retries, gc) are things we would be switching off.
- The client has no data-fetching library; it is CRA + redux-saga for session
  state only, and the precedent in these hooks is plain module state with no
  new dependencies.

## Consequences

- Admission rule: a GET is cached through this module only when it is on the
  service worker's API allowlist (read-only, viewer-safe) and is read by more
  than one mount per typical navigation. Everything else stays a plain fetch in
  its component. The transaction log is deliberately not cached.
- `useLeague`, `usePickemStandings` and `usePickemSettings` are one-line
  adapters, and their exported clear functions remain the invalidation API at
  call sites. `primeLeagueCache` is gone: `useLeague` exposes `teams`, so the
  dashboard reads through the hook like every other page.
- Pagination, infinite queries, optimistic rollback or devtools are the signal
  to adopt TanStack Query; the adapters are the seam that keeps that a
  contained change.
