import React from 'react';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import useReduxStore from './useReduxStore';

const mockStore = configureMockStore([]);

test('returns the entire redux store state, unfiltered', () => {
  const state = { user: { id: 1, username: 'alice' }, errors: { loginMessage: '', registrationMessage: '' } };
  const store = mockStore(state);
  const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

  const { result } = renderHook(() => useReduxStore(), { wrapper });

  expect(result.current).toEqual(state);
});

test('reflects a different store shape when given one', () => {
  const state = { user: {}, errors: { loginMessage: 'oops', registrationMessage: '' } };
  const store = mockStore(state);
  const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;

  const { result } = renderHook(() => useReduxStore(), { wrapper });

  expect(result.current.errors.loginMessage).toBe('oops');
});
