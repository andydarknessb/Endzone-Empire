import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import store from './redux/store';

import './theme/base.css';
import App from './components/App/App';
import { register as registerServiceWorker } from './serviceWorkerRegistration';

// apiClient fires this when a token refresh fails — the session is dead, so
// drop the user back to the login screen.
window.addEventListener('auth:session-expired', () => {
  store.dispatch({ type: 'UNSET_USER' });
});

const root = ReactDOM.createRoot(document.getElementById('react-root'));
root.render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);

// Enables offline viewing of cached league data + web push; no-op outside
// of a production build (see serviceWorkerRegistration.js).
registerServiceWorker();
