import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import store from './redux/store';

import './theme/base.css';
import RootRouter from './components/App/RootRouter';
import AppErrorBoundary from './components/App/AppErrorBoundary';
import { initializeSentry } from './monitoring/sentry';
import { register as registerServiceWorker } from './serviceWorkerRegistration';
import { dropSessionCaches } from './sessionCaches';
import pixelFaceUrl from './assets/fonts/PressStart2P-Regular.woff2';
import { hasSessionHint } from './lib/sessionHint';
import { isPublicPath } from './components/public/publicPaths';

// A signed-in visit starts the pixel face with the entry bundle, ahead of the lazy Lineup chunk that paints the team name
// (#3021). Public and anonymous visits request no face (font-warm.spec.ts), the same rule App.jsx uses for warmFonts. A font
// is fetched in CORS mode, so the preload needs crossOrigin or the @font-face does not reuse it.
if (hasSessionHint() && !isPublicPath(window.location.pathname)) {
  const pixelFacePreload = document.createElement('link');
  pixelFacePreload.rel = 'preload';
  pixelFacePreload.as = 'font';
  pixelFacePreload.type = 'font/woff2';
  pixelFacePreload.crossOrigin = 'anonymous';
  pixelFacePreload.href = pixelFaceUrl;
  document.head.appendChild(pixelFacePreload);
}

initializeSentry();

// apiClient fires this when a token refresh fails — the session is dead, so
// drop the user back to the login screen (and every cache the session left).
window.addEventListener('auth:session-expired', () => {
  dropSessionCaches();
  store.dispatch({ type: 'UNSET_USER' });
});

// A cold visit to `/` would otherwise paint one frame of <Navigate> (empty page,
// Footer at the viewport bottom) before LandingPage mounts and the Footer jumps.
if (window.location.pathname === '/' && ['', '#/'].includes(window.location.hash)) {
  window.history.replaceState(null, '', `/${window.location.search}#/home`);
}

const root = ReactDOM.createRoot(document.getElementById('react-root'));
root.render(
  <React.StrictMode>
    <Provider store={store}>
      <AppErrorBoundary>
        <RootRouter />
      </AppErrorBoundary>
    </Provider>
  </React.StrictMode>
);

// Web push only (the worker has no fetch listener, ADR 0059); no-op outside
// of a production build (see serviceWorkerRegistration.js).
registerServiceWorker();
