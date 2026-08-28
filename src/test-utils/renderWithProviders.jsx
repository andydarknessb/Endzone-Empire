import React from 'react';
import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const mockStore = configureMockStore([]);

/**
 * Render a component wrapped in a mock redux Provider and a router.
 * - `path`: the Route pattern to mount `ui` under (supports useParams).
 * - `route`: the initial URL (must match `path`).
 * - `state`: redux state override (merged over sane defaults).
 * - `store`: pass a pre-built mock store instead of `state`.
 */
export function renderWithProviders(
  ui,
  {
    route = '/', path = '/', state = {}, store, routes,
  } = {}
) {
  const defaultState = {
    user: {},
    errors: { loginMessage: '', registrationMessage: '' },
    ...state,
  };
  const testStore = store || mockStore(defaultState);

  const utils = render(
    <Provider store={testStore}>
      <MemoryRouter
        initialEntries={[route]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path={path} element={ui} />
          {routes}
        </Routes>
      </MemoryRouter>
    </Provider>
  );

  return { ...utils, store: testStore };
}

export default renderWithProviders;
