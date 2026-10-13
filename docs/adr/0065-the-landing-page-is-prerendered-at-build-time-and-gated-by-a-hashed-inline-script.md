# The landing page is prerendered at build time and gated by a hashed inline script

Status: accepted (2026-10-13)

After #2259 the landing page's mobile LCP was 2.8 s, all render delay: the
hero tagline could not paint until main.js (150 KiB transferred) had
downloaded and run under a 4× CPU. Splitting more code out of main would not
close that gap. What remains is code the landing page itself renders with:
react-dom, MUI, emotion, the router and redux. Replacing axios with fetch
saves about 16 KiB and changes every API caller's error shape (#2261).

We decide that `npm run build` prerenders the anonymous landing page
(`/#/home`) into `build/index.html`. `scripts/prerender-landing.js` runs the
built main.js in jsdom once per color mode, with every request left
unanswered. It keeps what React rendered: the markup of `#react-root`, the
emotion rules exactly as emotion wrote them, and the theme tokens
AppThemeProvider set on `<html>`. Both copies go into the page. The prerender
is the bundle's own first render, so the swap is pixel-identical: React's
createRoot clears `#react-root` in the same commit that paints the live tree,
and Chrome records the prerendered tagline as the LCP element.

`index.html` answers every route, so a small inline script in `<head>` decides
before `<body>` parses. It shows the copy only where App renders the landing
page itself:

- pathname `/` with hash `""`, `#/` or `#/home`;
- no `endzone_session_hint` (with the hint, App shows a spinner and then
  `/user`, #2097);
- the copy in the mode `AppThemeProvider.initialMode` would pick.

Everywhere else it removes the copied styles, and the markup stays
`display: none`. AppThemeProvider removes the copied styles and mode class
once its own tokens are on `<html>`.

The CSP keeps `script-src 'self'` and adds the gate's sha256 hash. No other
inline script can run. The build fails when that hash is not in netlify.toml
or the bundle does not reach the hero in either mode. A guard test
(`test:prerender-landing`) also holds the hash equal to the script.

Considered and rejected:

- **A render-blocking `/boot.js`.** It costs one round trip before first
  paint on every route.
- **Hand-written hero HTML.** It drifts from the React page, and any
  difference is layout shift.
- **SSR and hydration.** It needs a Node render path for an app built only
  for the browser, and emotion's output to match on hydrate.
- **Moving to BrowserRouter.** Not needed: the gate reads the hash.

Consequences:

- `index.html` grows from about 2 KiB to about 11 KiB brotli on every route.
- Mobile LCP measured 2.84 s → 0.75 s (local Lighthouse 12.8, simulated,
  JS served 400 ms after the document; median of 3).
- Under applied throttling, TBT counts main.js's evaluation that used to fall
  before first paint. The work is the same, only earlier in the window.
- `jsdom` is a direct devDependency.
- A landing-page change that makes the first render depend on time or
  viewport in JS would make the copy differ from the live page; keep the
  first render CSS-responsive.
