# Audit: which routes publish by default? (#201)

Asked because #173 found the public presenter board building its payload from
`SELECT * FROM "leagues"` and then `delete`-ing a handful of named fields.
That shape publishes by DEFAULT: every column added to the table afterwards is
disclosed automatically and nothing fails. Two fields had already gone out that
way, one of them a long-lived credential. The presenter route was not special;
it was simply the route someone read. So the question was whether the shape
recurs anywhere else reachable without a session.

**Answer: it recurred once, on `POST /api/auth/login`, and nothing had leaked
through it.** That route is now an allowlist. Every other anonymous route was
already default-withhold. All of them are now pinned by key-set tests.

## How the list was built

Not by reading route names. `server/test/unauthenticatedRouteInventory.test.js`
walks the mounted Express stacks the way Express itself does and classifies
each route by whether `requireAuth` appears in the chain that would actually
run - router-level middleware registered ahead of it, or a per-route handler.
That is the mechanism that made the presenter board public: `router.get(
'/board/:token', ...)` sits at draft.router.js:96, and `router.use(requireAuth)`
at line 125. Nothing about the route's name says so.

The classifier is proven against four shapes before the inventory trusts it:
a route registered ahead of a router-level guard, a per-route guard with no
router-level one, a path-scoped `router.use(path, guard)` that protects no
sibling, and the guard itself actually refusing a request.

## Every route reachable without a session

`origin` is where the payload's values come from; `filtering` is what stands
between that and the response.

| Route | Anonymous because | Payload origin | Filtering | Pinned by |
| --- | --- | --- | --- | --- |
| `POST /api/auth/register` | no router-level guard on auth.router | named-column `INSERT ... RETURNING "id","username","email"` | **allowlist** (`publicUser`) | authPayloadShape |
| `POST /api/auth/login` | as above | named-column select **including `"password"`** | **allowlist** (`publicUser`) - was a delete-list, converted here | authPayloadShape |
| `POST /api/auth/refresh` | as above | named-column select `id, username, email`; the rotation reads `SELECT * FROM "refresh_tokens"` but returns a named literal | **allowlist** (`publicUser`) | authPayloadShape |
| `POST /api/auth/logout` | as above | route literal `{ ok }` | n/a - no row involved | authPayloadShape |
| `POST /api/auth/forgot-password` | as above | route literal `{ ok, message }` | n/a | authPayloadShape |
| `POST /api/auth/reset-password` | as above | service literal `{ ok }`; the service reads `SELECT * FROM "auth_tokens"` and publishes nothing from it | n/a | authPayloadShape |
| `POST /api/auth/verify-email` | as above | service literal `{ ok }`; same `SELECT *`, same non-publication | n/a | authPayloadShape |
| `GET /api/draft/board/:token` | registered at draft.router.js:96, ahead of `router.use(requireAuth)` at :125 | `SELECT * FROM "leagues"` (the `getDraftState` snapshot) | **allowlist** since #199 | draftPresenterBoard (#199) |
| `GET /api/health/livez` | health.router has no guard at all | route literal | allowlist | healthPayloadShape |
| `GET /api/health/readyz` | as above | route literal over two probe helpers | allowlist | healthPayloadShape |
| `GET /api/health/holdout` | as above | service snapshot: route destructures `{ ok, obligations }`; each obligation is a named literal built by holdout.service over named-column selects | allowlist at the route's top level; the obligations array is published exactly as the service built it | healthPayloadShape |
| `GET /api/health/worker` | as above | named-column select over `worker_heartbeats`, mapped field by field | allowlist | healthPayloadShape |
| `GET /api/health/` | as above | route literal composing the four above plus three module status literals | allowlist | healthPayloadShape |
| `GET /api/public/rankings` | public.router has no guard by design | named-column selects, `serializeRankingRow` | allowlist | publicPayloadShape |
| `GET /api/public/draft-pool` | as above | named-column CTEs, `serializeDraftPoolRow` | allowlist | publicPayloadShape |
| `GET /api/public/players/:id` | as above | named-column selects, `serializePlayerProfile` | allowlist | publicPayloadShape |
| `GET /api/public/recaps` | as above | named-column select, `serializeRecapListRow`; the stored JSON document is read field by field, never spread | allowlist | publicPayloadShape |
| `GET /api/public/recaps/:gameId` | as above | as above plus `serializeRecapDetail`, `serializeLineScore`, `serializeScoringPlay`, `serializeTopPerformer` | allowlist | publicPayloadShape |
| `GET /api/public/sitemap.xml` | as above | named-column selects (`players."id"`; `game_recaps."tank01_game_id"`, `"final_at"`) into `{ path, lastmod }` | allowlist | public.router.test (XML, exempt from key-set pinning per the issue) |
| `GET /^(?!\/api\/).*/` | registered on the app, not a router | `build/index.html` on disk | no database read | unauthenticatedRouteInventory |

**Socket.IO.** `attachDraftSocket` installs `requireSocketAuth` as the only
handshake middleware, ahead of every `socket.on(...)` handler, and it refuses
both a tokenless handshake and one carrying a token it cannot verify. There is
no anonymous socket surface. Asserted, not read off the source.

## Routes that turned out NOT to be anonymous

Worth recording, because two of them read like public surfaces:

- **`GET /api/league/preview`**, the invite preview. `router.use(requireAuth)`
  is at league.router.js:33, ahead of every route in the file including
  `/preview` at :267, and the handler reads `req.user.id`. It is a
  **non-member** surface, not an anonymous one. Its payload is separately
  allowlisted and pinned (#181, #206).
- **`GET /api/league/discover`**, public league discovery: same, guarded.
- **`GET /api/notifications/push-public-key`**, which returns a VAPID public
  key and reads as infrastructure: registered after the router-level guard.
- **The whole of player.router and user.router**, which carry no router-level
  guard at all: every route names `requireAuth` individually. Verified per
  route, not per file.

## What changed

1. **`POST /api/auth/login` converted from a delete-list to an allowlist.**
   The query must `SELECT "password"` to compare it, and the route answered
   `result.rows[0]` with the hash `delete`d off afterwards. Nothing had leaked:
   the delete runs before the response on every path. The shape was the defect,
   and the same allowlist now serves register and refresh.
2. **Twenty-four raw row passthroughs in `publicRead.service.js` now `?? null`**,
   across all four serializers that read a database row directly:

   | Serializer | Fields |
   | --- | --- |
   | `serializeRankingRow` | `playerId`, `name`, `position`, `nflTeam`, `photoUrl`, `injuryStatus` |
   | `serializePlayerProfile` | `playerId`, `name`, `position`, `nflTeam`, `photoUrl`, `jerseyNumber`, `injuryStatus`, `injuryDetail`, `news` |
   | `serializeDraftPoolRow` | `playerId` |
   | `serializeRecapListRow` and `serializeRecapDetail` | `gameId`, `homeTeam`, `awayTeam`, `finalAt` each |

   Each answered `undefined` when the row lacked the column, and
   `JSON.stringify` drops the KEY. That makes the key set a property of the
   query rather than of the serializer, which is the rule #181 and #199 both
   pin (`allowlisted()` in draft.router.js null-fills identically). No field a
   client reads changed value: every one of these columns is named in the
   query that feeds it, so Postgres already returned `null` and the wire bytes
   are unchanged for a real row. Only the absent-column case moves, from a
   missing key to `null`.

## Found and deliberately not changed

- **`GET /api/health` publishes `worker.lastError` verbatim** to anonymous
  callers, straight from `worker_heartbeats."last_error"`. It is a named
  allowlist, so it is not the default-publish shape this audit was looking
  for - but the VALUE is an arbitrary error string a worker wrote, and it is
  the one place on the anonymous surface where a message could carry a
  connection string or a failing query. Changing it changes a field the
  monitor reads, which the issue put out of scope.
- **Three `SELECT *` reads sit in the anonymous-reachable call chain** and none
  of them reaches a response: `account.service` reads `auth_tokens` twice
  (reset and verify) and `token.service.rotateRefreshToken` reads
  `refresh_tokens`. All three consume the row field by field and return a named
  literal. Named here because `rotateRefreshToken` is one edit from returning
  its row on `/api/auth/refresh`, and that row carries `token_hash`. The
  refresh key-set test is what would catch it.
- **`quotaStatus`'s `{ unavailable }` fallback is unreachable** from the pool
  seam: `getQuotaState` swallows its own usage-read failure and still answers a
  full state. Its key set is documented rather than pinned.
- **The configured-Redis branch of `/readyz`** adds exactly `latencyMs`. Not
  pinned: health.router destructures `getRedisClient` at load, so it cannot be
  mocked from a test file, and a real connection attempt keeps a reconnect
  timer alive for the rest of the process.
