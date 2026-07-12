import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';

import store from './redux/store';

import App from './components/App/App';

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
