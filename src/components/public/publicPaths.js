/**
 * The set of URL path prefixes owned by the public (no-login) layer.
 *
 * The dual-router shell (see RootRouter.jsx) checks window.location.pathname
 * against these BEFORE any router mounts: a match renders the public
 * BrowserRouter tree; anything else renders the existing HashRouter app
 * untouched. There are no collisions with the authed app because the whole
 * authed app lives in the hash fragment, so its real pathname is always '/'.
 *
 * Exported as a constant (and matched via isPublicPath) so it is unit-testable
 * and the same list drives routing, the sitemap, and any future prerender.
 */
export const PUBLIC_PATH_PREFIXES = [
  '/rankings',
  '/players',
  '/waiver-wire',
  '/strategy',
  '/recaps',
  '/privacy',
  '/terms',
  '/acceptable-use',
];

/**
 * True when `pathname` belongs to the public layer. A path matches a prefix
 * when it is exactly the prefix or a sub-path of it (`/players` and
 * `/players/123` match; `/playersfoo` does not).
 */
export function isPublicPath(pathname) {
  const path = String(pathname || '').replace(/\/+$/, '') || '/';
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
