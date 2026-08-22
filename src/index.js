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

initializeSentry();

// apiClient fires this when a token refresh fails — the session is dead, so
// drop the user back to the login screen (and every cache the session left).
window.addEventListener('auth:session-expired', () => {
  dropSessionCaches();
  store.dispatch({ type: 'UNSET_USER' });
});

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

// Enables offline viewing of cached league data (the allowlisted API reads,
// on this origin or the configured API origin) + web push; no-op outside of
// a production build (see serviceWorkerRegistration.js).
registerServiceWorker();
