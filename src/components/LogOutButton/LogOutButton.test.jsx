import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import configureMockStore from 'redux-mock-store';
import LogOutButton from './LogOutButton';

const mockStore = configureMockStore([]);

test('renders a "Log Out" button with the passed className', () => {
  const store = mockStore({});
  render(
    <Provider store={store}>
      <LogOutButton className="navLink" />
    </Provider>
  );

  const button = screen.getByRole('button', { name: 'Log Out' });
  expect(button).toHaveClass('navLink');
});

test('dispatches a LOGOUT action when clicked', async () => {
  const store = mockStore({});
  render(
    <Provider store={store}>
      <LogOutButton />
    </Provider>
  );

  await userEvent.click(screen.getByRole('button', { name: 'Log Out' }));

  expect(store.getActions()).toEqual([{ type: 'LOGOUT' }]);
});
