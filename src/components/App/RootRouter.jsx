import React from 'react';

import App from './App';
import { isPublicPath } from '../public/publicPaths';
import PublicApp from '../public/PublicApp';

/**
 * Dual-router shell. Decides ONCE, from the real pathname at load time, which
 * app to mount:
 *   - a public path (/rankings, /players/:id, /waiver-wire, /strategy, /recaps)
 *     -> the public BrowserRouter tree (PublicApp)
 *   - anything else -> the existing HashRouter app (App), byte-for-byte untouched.
 *
 * The whole authed app lives in the hash fragment, so on a hard refresh of a
 * deep public URL the browser's pathname is the public path (not '/'), and this
 * mounts the public tree directly — no flash of the authed shell, no redirect.
 * Cross-boundary navigation is done with plain <a href> links, which reload the
 * document and re-run this decision.
 */
function RootRouter() {
  if (isPublicPath(window.location.pathname)) {
    return <PublicApp />;
  }
  return <App />;
}

export default RootRouter;
