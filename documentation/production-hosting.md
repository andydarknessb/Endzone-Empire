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

## Provider references

- [Netlify CRA build settings](https://docs.netlify.com/build/frameworks/framework-setup-guides/react/)
- [Netlify external DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)
- [Netlify managed HTTPS](https://docs.netlify.com/manage/domains/secure-domains-with-https/https-ssl/)
- [Render web services](https://render.com/docs/web-services)
- [Render custom domains and TLS](https://render.com/docs/custom-domains)
- [Render WebSocket support](https://render.com/docs/websocket)
- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Dynadot DNS setup](https://www.dynadot.com/help/question/set-up-DNS)
