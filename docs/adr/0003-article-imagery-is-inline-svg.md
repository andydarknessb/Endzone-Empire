# Article imagery is inline SVG, never hotlinked photography

Status: accepted (2026-08-19)

Strategy articles are typed JSX bodies in `src/content/articles/`, loaded on
demand. The first illustrated one, `preseason-week-1-recap`, drew its hero as an
inline `<svg>` in the body file. Writing the second illustrated article raised
the question directly, because the request asked for stock photos: what may an
article body use as imagery? The answer is inline SVG authored in the body
file, and nothing else. No stock photography, no third-party photo hotlinking,
no committed binary image assets for editorial use.

This governs article bodies only. It does not touch `players.photo_url`, which
hotlinks `a.espncdn.com` headshots for 3670 of 3702 players in functional UI and
stays as it is.

## Why

- NFL player photography is almost entirely rights-encumbered (Getty, AP, NFL).
  We hold no license, and a reviewer has no way to confirm one at review time.
  A rule that permits photos "when licensed" is a rule that gets bent.
- Hotlinking is materially different in the two contexts. In a player list a
  broken headshot degrades one row of app chrome. In editorial content under a
  byline it degrades the article's credibility, and it makes a page we control
  depend on a third party's availability and terms.
- Article bodies are lazy chunks, so inline SVG costs nothing against the
  250 KiB gzip initial-JS budget in `scripts/check-bundle-budget.js`, and no
  binary asset enters `public/` to be served on every deploy.
- SVG carries information a stock photo cannot. A tier chart or a usage bar is
  the argument; a photograph of an anonymous helmet is decoration.
- SVG is theme-aware. A photograph is not.

## Consequences

- Hero banners may use hardcoded color literals. `src/content/articles/` is
  already allowlisted in `scripts/check-color-literals.js` for exactly this,
  and a self-contained banner reads correctly in both themes.
- Data graphics must NOT use that exemption. They sit inline in the reading
  column beside body text, so they take their colors from `var(--token)` and
  `currentColor` and therefore cannot drift out of contrast when the theme
  changes. The allowlist's stated reason is hero banners; treating it as
  blanket permission for the whole directory is a misreading.
- A decorative graphic that restates data already present in a table is
  `aria-hidden`, with the table placed before it in DOM order as the accessible
  source of truth. Do not write a paragraph-long `aria-label` describing a
  chart whose data is already on the page.
- If an article genuinely needs photography, that is a reason to revisit this
  decision with a license in hand, not a reason to route around it. Reach for a
  new ADR, not an exception.
