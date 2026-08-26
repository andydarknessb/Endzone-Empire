# Public SEO and sharing decision

## Decision

Keep the current CRA public shell client-rendered. Do not add full SSR or a broad prerender step now.

`react-helmet-async`, canonical URLs, `robots.txt`, and the dynamic sitemap provide correct in-browser metadata and discovery signals. They do not put route-specific metadata into the first HTML response: social crawlers commonly do not execute the client bundle, and search indexing remains dependent on a crawler rendering JavaScript.

If reliable social cards become a launch requirement, add a narrow share-crawler path as the next phase:

1. Add an Express endpoint that accepts only allowlisted public player and recap route shapes and renders a minimal HTML document from the existing public read model.
2. Put the same canonical, Open Graph, and Twitter values used by `PublicSeo` in that document. HTML-escape all database values; do not accept an arbitrary target URL or fetch remote URLs.
3. Use a Netlify Edge Function to detect known share crawlers (for example Facebook, X/Twitter, LinkedIn, Slack, and Discord) on `/players/:id` and `/recaps/:gameId`, then rewrite those requests to the Render endpoint. Human requests continue to receive the CRA shell at the original URL.
4. Cache player documents for roughly one hour and final recap documents longer. Purge or shorten the cache only if editable recap content is introduced.

Limit this treatment to social preview crawlers. Do not send Googlebot or Bingbot materially different page content; that adds cloaking risk and still does not solve indexable body content.

## Tradeoffs

| Option | Benefit | Cost / limitation | Recommendation |
| --- | --- | --- | --- |
| Current client metadata | Small change, no authenticated-tree impact, metadata updates during navigation | Social crawlers may see only CRA's base HTML; body content requires JavaScript | Ship now |
| Static prerender | Strong first response for rankings, waiver, strategy, and article pages | Dynamic player/recap URLs require large rebuilds or become stale | Consider only for the static routes if search evidence justifies it |
| Share-crawler rewrite | Reliable player and recap cards without changing the human app | Bot detection and a second metadata renderer must stay synchronized | Preferred next step for sharing |
| Full SSR inside CRA | One response can contain metadata and page content | Requires a server bundle, routing/data-fetch duplication, MUI style hydration, and different deployment behavior | Do not build |
| Move the public shell to an SSR/SSG framework | Durable indexable HTML, static generation plus dynamic rendering, cleaner long-term SEO | Separate migration and hosting work; public/auth navigation boundary must remain explicit | Revisit if organic search becomes a primary acquisition channel |

## The static shell

Every URL outside the public tree, the marketing landing page included, mounts the HashRouter app and reaches a crawler or link unfurler with only what `public/index.html` declares (#351). The shell therefore carries the site-wide description, title, Open Graph and Twitter tags itself. Three rules keep it honest: its description text equals `DEFAULT_DESCRIPTION` and its title text equals `SHELL_TITLE`, both exported from `PublicSeo.jsx` (asserted by `shellMeta.test.jsx`, since a static file cannot import a constant), and every shell tag carries `data-rh="true"` so react-helmet-async treats it as its own and replaces it on a public route instead of leaving a second copy beside the route's.

## Reconsideration trigger

Move the public shell to a framework designed for SSR/SSG instead of extending CRA SSR when either condition is true:

- Search Console shows important public routes are discovered but not reliably indexed because rendered content is unavailable or delayed.
- Product requirements need indexable player/recap body content, structured data, or route-specific preview images generated at request time.

The authenticated HashRouter app should remain separate during any later migration.
