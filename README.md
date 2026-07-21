# Endzone Empire

A full-stack fantasy football application: create private leagues, invite friends,
run a live snake draft in real time, manage rosters, and score weekly head-to-head
matchups using real-world NFL statistics.

## Stack

- **Frontend:** React 18, react-router v6, Redux + redux-saga, MUI v5, socket.io-client
- **Backend:** Node.js (20+), Express, Socket.io, JWT auth (`jsonwebtoken` + `bcryptjs`)
- **Database:** PostgreSQL via `pg` (parameterized queries + explicit transactions), Knex migrations

## Prerequisites

- Node.js 20+ (24 LTS recommended)
- PostgreSQL 14+

## Setup

1. **Install dependencies**

   ```sh
   npm install
   ```

2. **Configure environment** — copy `.env.example` to `.env` and fill in values:

   ```sh
   # generate a JWT secret:
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   `RAPID_API_KEY` / `RAPID_API_HOST` are only needed for the real-stats sync
   (`POST /api/scoring/sync`); everything else works without them.

3. **Create the database and run migrations**

   ```sh
   createdb endzone_empire
   npm run migrate     # creates all tables (Knex)
   npm run seed        # loads a sample player pool
   ```

4. **Run the app**

   ```sh
   npm run server      # Express + Socket.io on :5000 (nodemon)
   npm run client      # React dev server on :3000 (proxies /api to :5000)
   ```

5. **(Optional) Manager avatars — one-time Supabase Storage setup.** Team
   avatar/GIF uploads (`POST /api/team/:id/avatar`) are stored in Supabase
   Storage via a server-side service-role client (`server/modules/supabaseAdmin.js`),
   since this app's own JWT auth isn't Supabase Auth and so Storage RLS can't
   scope writes per-user — uploads go through the Express API, not the
   browser directly. Every environment needs a `team-avatars` bucket created
   once, before this feature works: set `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` in `.env` (see `.env.example`), then run this
   once against that Supabase project's SQL editor (or via `execute_sql` if
   using the Supabase MCP tools):

   ```sql
   INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
   VALUES ('team-avatars', 'team-avatars', true, 5242880,
           ARRAY['image/png','image/jpeg','image/webp','image/gif']);
   ```

   `public = true` lets Supabase's Storage API serve objects at
   `.../storage/v1/object/public/team-avatars/...` without an RLS policy
   check. Deliberately add **no** RLS policies on `storage.objects` for this
   bucket — the service-role key bypasses RLS entirely for writes, and no
   client-side (anon/authenticated) role should ever be able to write here.
   Without this bucket, avatar uploads fail with `503 avatar storage is not
   configured on this server` (missing env vars) or a Supabase "bucket not
   found" error (env vars set, bucket missing) — every other feature works
   fine without it.

## Tests

```sh
npm run test:server   # node:test unit tests (scoring + draft-order logic)
npm run build         # production build of the frontend
```

## API overview

All routes except `/api/auth/*` require `Authorization: Bearer <jwt>`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account → `{ token, user }` |
| POST | `/api/auth/login` | Login → `{ token, user }` |
| GET | `/api/user` | Current user profile |
| GET | `/api/players?page=N&position=QB&leagueId=N&available=true` | Paginated player pool (25/page, strict integer validation) |
| POST | `/api/players/draft/:playerId` | Draft a player (transactional; body `{ leagueId }`) |
| POST | `/api/league` | Create league (invite code, roster limit, max teams) |
| POST | `/api/league/join` | Join by invite code |
| GET | `/api/league` / `/api/league/:id` | My leagues / league detail + standings |
| PUT | `/api/league/:id` | Owner: rename / set roster limit (pre-draft) |
| POST | `/api/league/:id/start-draft` | Owner: open the live draft |
| GET | `/api/league/:id/matchups?week=N` | Head-to-head matchups |
| GET | `/api/team/roster?leagueId=N` | My roster |
| POST/DELETE | `/api/team/roster/:playerId` | Add / drop a player (transactional) |
| POST | `/api/scoring/sync` | Pull weekly stats from RapidAPI |
| POST | `/api/scoring/league/:id/matchups` | Owner: generate weekly pairings |
| POST | `/api/scoring/league/:id/score` | Owner: score the week from player stats |

### Live draft (Socket.io)

Connect with `io('/', { auth: { token } })`, then:

- `draft:join { leagueId }` → server replies with full `draft:state`
- `draft:pick { leagueId, playerId }` → room broadcast `draft:picked` (snake order
  enforced server-side inside a database transaction)
- `draft:complete` fires when every roster is full

## Notes

- Passwords are bcrypt-hashed; JWTs expire after 7 days.
- A player can be rostered by only one team per league (database unique constraint,
  not just application logic).
- Draft picks lock the league row (`SELECT … FOR UPDATE`) so simultaneous picks
  can't double-draft or skip turns.
