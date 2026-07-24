# Production hosting

## Decision

- Client: Netlify, serving the CRA `build/` directory from its CDN.
- Server: one paid Render Starter web-service instance in Virginia.
- Existing data services: Supabase Postgres, Auth, Realtime, and Storage remain unchanged.
- Public URLs: `https://endzoneempire.gg` (primary), `https://www.endzoneempire.gg` (redirect), and `https://api.endzoneempire.gg` (Express and Socket.IO).

This keeps the browser assets on a static host and leaves the stateful Node process,
WebSockets, scheduler, and live-game engine on one always-on managed service. Render's
free service is not suitable: it spins down after 15 idle minutes, while this server
runs scheduled work and persistent Socket.IO connections. Keep the Render service at
one instance until scheduled jobs are moved into a separate worker or proven safe to
run concurrently.

Configuration is checked in as `netlify.toml`, `render.yaml`, and `.node-version`.
Both providers use Node 24. Render auto-deploys are disabled until CI/CD is added.
Netlify sets `CI=false` for the CRA build because the current repository has existing
hook-lint warnings; remove that override after the warning backlog is cleared.

## Environment variables

Set these in Netlify under Project configuration > Environment variables before the
first client build:

| Variable | Production value |
| --- | --- |
| `REACT_APP_API_ORIGIN` | `https://api.endzoneempire.gg` |
| `REACT_APP_SOCKET_ORIGIN` | `https://api.endzoneempire.gg` |
| `REACT_APP_SUPABASE_URL` | Existing Supabase project URL |
| `REACT_APP_SUPABASE_ANON_KEY` | Existing publishable/anon key |

CRA embeds every `REACT_APP_*` value in the generated JavaScript. Never put the
Supabase service-role key, database URL, JWT secret, or other server secret in Netlify.

Render's Blueprint prompts for the secret values marked `sync: false` in
`render.yaml`. Copy their values from the current secure environment; do not commit
them. Add any configured optional integrations from `.env.example` in the Render
dashboard (SMTP, VAPID, Sentry, Anthropic, and platform-admin IDs).

`CLIENT_ORIGINS` is an exact comma-separated allowlist. During initial testing, append
the assigned Netlify URL, such as `https://<site-name>.netlify.app`, then remove it if
only the custom domains should be permitted. Do not use `*`.

After saving secrets in Render's Environment tab, hard-reload the dashboard and re-read
every field before deploying. Edits there have been observed not to persist on save, and
a paste that includes the leading `KEY=` stores the key name inside the value — a
`SUPABASE_URL` of `SUPABASE_URL=https://...` fails at startup with `Invalid supabaseUrl`
rather than at save time. Verify the reloaded values, not the in-page state.

## Database connection hosts

Supabase exposes two Postgres endpoints, and only one of them works from Render:

| Endpoint | Host | Notes |
| --- | --- | --- |
| Connection pooler | `aws-0-<region>.pooler.supabase.com:6543` | pgbouncer, IPv4 |
| Direct connection | `db.<project-ref>.supabase.co:5432` | IPv6 only |

Point both `DATABASE_URL_RUNTIME` and `DATABASE_URL_MIGRATIONS` at the pooler host.
Render's build and pre-deploy environment has no outbound IPv6, so the direct host fails
there with `connect ENETUNREACH` against an IPv6 address — during `preDeployCommand`
(`npm run migrate`), before the service ever starts. The failure looks like a database
outage, not a networking mismatch, so check the host first. The pooler is also the
correct runtime target; there is no reason to use the direct host in this deployment.

## Database role privileges

The app connects as a scoped Postgres role (`endzone_app` in the current project), not
the Supabase project's superuser. `knexfile.js` picks the connection string in this
order: `DATABASE_URL_MIGRATIONS`, then `DATABASE_URL_RUNTIME`, then `DATABASE_URL`. In
Render these are distinct secrets (see `render.yaml`); locally, only `DATABASE_URL` is
usually set, so the same role runs both migrations and runtime queries.

By default that role can `CREATE`/`ALTER TABLE` inside `public` but cannot
`CREATE SCHEMA` — Postgres schema creation requires `CREATE` on the *database*, which
isn't implied by table-level grants. A migration that creates a new schema (for example
`20260722000001_game_recaps.js`'s `private` schema) fails with
`permission denied for database postgres` until that's granted once:

```sql
GRANT CREATE ON DATABASE postgres TO endzone_app;
```

This is a one-time grant on the role, not part of any migration (a role that lacks
`CREATE` can't grant itself `CREATE` either, so it can't be self-healing via a migration
file). Before the first deploy against a new database — a fresh Supabase project, a
disaster-recovery restore, a staging clone — confirm whichever role
`DATABASE_URL_MIGRATIONS` resolves to in that environment already has this grant, or
`npm run migrate` (and Render's `preDeployCommand`, which runs the same command) will
fail on the next schema-creating migration.

## First manual deployment

1. Push the reviewed production commit to the intended production branch.
2. In Render, create a Blueprint from this repository and its root `render.yaml`.
   Supply every prompted secret. Confirm Starter, Virginia, one instance, and auto
   deploy off. The pre-deploy step runs `npm run migrate`; the service then starts with
   `npm start` and is considered healthy only when `/api/health` can query Supabase.
3. Record the assigned hostname: `<render-service>.onrender.com`. Confirm
   `https://<render-service>.onrender.com/api/health` returns HTTP 200 and `"ok":true`.
4. In Netlify, import the same repository. The checked-in settings use `npm run build`
   and publish `build/`. Set the four client variables above and disable automatic
   deploys. Use Deploys > Trigger deploy > Deploy site for each manual release.
5. Record the assigned hostname: `<site-name>.netlify.app`. Add it temporarily to
   Render's `CLIENT_ORIGINS`, redeploy Render, and smoke-test login plus a live page at
   the Netlify URL.
6. In Netlify Domain management, add `endzoneempire.gg`, make it the primary domain,
   and retain `www.endzoneempire.gg` as the redirect alias.
7. In Render Settings > Custom Domains, confirm `api.endzoneempire.gg` was added by
   the Blueprint. Render will show the exact DNS target and wait for verification.
8. Add the Dynadot records below. After public DNS resolves, use each provider's
   Verify DNS action and wait for both managed certificates to report active.
9. Run the verification checklist. Remove the temporary `*.netlify.app` origin if it
   is not intended to remain usable, redeploy Render, and recheck the custom domain.

Do not seed production during deployment. The migration step is additive schema work;
review every new migration before triggering a production deploy.

## Dynadot DNS

Use Dynadot DNS. In My Domains > Manage Domains > Action > DNS Settings, select
Dynadot DNS. Dynadot's **Domain Record** is the apex; leave its host/name blank rather
than entering `@`.

| Dynadot section | Host | Type | Target/value | TTL |
| --- | --- | --- | --- | --- |
| Domain Record | blank | `ANAME` | `apex-loadbalancer.netlify.com` | 300 during cutover |
| Subdomain Records | `www` | `CNAME` | `<site-name>.netlify.app` | 300 during cutover |
| Subdomain Records | `api` | `CNAME` | `<render-service>.onrender.com` | 300 during cutover |

Use the exact Netlify and Render hostnames shown in their dashboards. Do not include
`https://` or a path in DNS values. Do not configure an apex ANAME and A record at the
same time. If ANAME fails, Netlify's supported fallback is a single apex A record to
`75.2.60.5`. Remove conflicting apex A/AAAA records and conflicting `www` or `api`
records. If CAA records are later added, permit both `letsencrypt.org` and `pki.goog`
because the two hosts use managed certificate authorities from that set.

## HTTPS/TLS verification

Run after both dashboards report that DNS verification and certificate provisioning
are complete:

```powershell
Resolve-DnsName endzoneempire.gg
Resolve-DnsName www.endzoneempire.gg
Resolve-DnsName api.endzoneempire.gg

curl.exe -I http://endzoneempire.gg
curl.exe -I https://endzoneempire.gg
curl.exe -I https://www.endzoneempire.gg
curl.exe https://api.endzoneempire.gg/api/health
curl.exe "https://api.endzoneempire.gg/socket.io/?EIO=4&transport=polling"
```

Pass criteria:

- HTTP redirects to HTTPS on all three names.
- The apex returns the client with no certificate error; `www` redirects to the apex.
- The API health response is HTTP 200 with `"ok":true` and `"db":{"ok":true}`.
- The Socket.IO polling probe returns a handshake beginning with `0{`.
- The browser can log in at the apex, make authenticated API requests without CORS
  errors, and establish a secure `wss://api.endzoneempire.gg` Socket.IO connection.
- Netlify and Render each show an active, automatically managed certificate covering
  their assigned custom domains.

Record the check time and certificate expiry/issuer in the release notes. TLS is not
confirmed until these checks pass against public DNS; configuration alone is not proof.

## Repeat manual deploy and rollback

For a release, merge/push the reviewed commit, manually deploy Render first, confirm
`/api/health`, then manually trigger the Netlify build and run the smoke checks above.
The API-first order keeps an older client talking to a backward-compatible newer API.

If the client fails, publish the prior successful production deploy from Netlify's
Deploys page. If the server fails, use Render's Rollback action for the prior deploy.
Do not run `npm run migrate:rollback` automatically: production database rollback is a
separate, destructive decision and should only be used after reviewing that migration's
down path and current data.

## Deploy automation

`.github/workflows/deploy.yml` runs the release described above. It is
`workflow_dispatch` only — Actions > Promote deployment > Run workflow, with
`promote_production` checked — so nothing deploys on a push to `main`. It triggers
Render, waits for `/api/health/readyz`, then triggers the Netlify build, preserving the
API-first order. Render and Netlify auto-deploy stay off; this workflow is the only
automated path.

Before the first run, configure in GitHub:

| Kind | Name | Value |
| --- | --- | --- |
| Environment | `production` | Required reviewers enabled |
| Secret | `RENDER_PRODUCTION_DEPLOY_HOOK` | Render > `endzone-empire-api` > Settings > Deploy Hook |
| Secret | `NETLIFY_PRODUCTION_BUILD_HOOK` | Netlify > Build & deploy > Build hooks |
| Variable | `PRODUCTION_API_URL` | `https://api.endzoneempire.gg` |
| Variable | `PRODUCTION_WEB_URL` | `https://endzoneempire.gg` |

Scope both secrets to the `production` environment, not the repository, so the required
reviewer gate actually protects them. The worker service is not triggered separately;
it redeploys from the same Blueprint commit.

The workflow is production-only because no staging environment exists. Its readiness
wait can pass against the still-running old instance, so it proves the API is up, not
that the new commit is live — confirm the deployed commit in Render before signing off
a release. When staging is stood up, restore a `staging` job with its own hooks and
variables and gate production behind `needs: staging`.

## Provider references

- [Netlify CRA build settings](https://docs.netlify.com/build/frameworks/framework-setup-guides/react/)
- [Netlify external DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
- [Netlify managed HTTPS](https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/)
- [Render web services](https://render.com/docs/web-services)
- [Render custom domains and TLS](https://render.com/docs/custom-domains)
- [Render WebSocket support](https://render.com/docs/websocket)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Dynadot DNS setup](https://www.dynadot.com/help/question/set-up-DNS)
