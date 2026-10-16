/* eslint-disable testing-library/no-node-access -- the Play-select look is asserted by its class and markup (.cursor, MUI roots), which have no role */
import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import LeagueBreadcrumb from './LeagueBreadcrumb';

const render = (ui) => renderWithProviders(ui, { path: '/league/:leagueId/waivers', route: '/league/9/waivers' });

test('the default look is the dash back-link button with its arrow icon', () => {
  render(<LeagueBreadcrumb />);
  const link = screen.getByRole('link', { name: 'League dashboard' });
  expect(link).toHaveAttribute('href', '/league/9');
  expect(link.className).toMatch(/MuiButton-root/);
  expect(link.querySelector('svg')).not.toBeNull();
});

test('look="playselect" is a Play-select link: no MUI button, no arrow, same destination and name', () => {
  render(<LeagueBreadcrumb look="playselect" name="Thursday Night Regulars" />);
  const link = screen.getByRole('link', { name: 'Thursday Night Regulars' });
  expect(link).toHaveAttribute('href', '/league/9');
  expect(link.className).not.toMatch(/MuiButton-root/);
  expect(link.querySelector('svg')).toBeNull();
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
});
