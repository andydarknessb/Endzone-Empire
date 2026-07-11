import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import LandingPage from './LandingPage';

test('renders the Welcome heading and the marketing copy', () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
  expect(screen.getByText(/turns armchair quarterbacks into legendary/i)).toBeInTheDocument();
});

test('"Get Started" links to the registration page', () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute(
    'href',
    '/registration'
  );
});

test('"Log In" links to the login page', () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/login');
});

test('renders the feature grid covering the core product areas', () => {
  renderWithProviders(<LandingPage />);
  [
    'Live Snake Drafts',
    'Weekly Lineups',
    'Waiver Wire',
    'Trades',
    'Live Scoring',
    'Playoffs & Standings',
    'League Chat',
    'Commissioner Tools',
  ].forEach((title) => {
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });
});
