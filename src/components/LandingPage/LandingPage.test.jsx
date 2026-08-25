import React from 'react';
import { screen, within } from '@testing-library/react';
import renderWithProviders from '../../test-utils/renderWithProviders';
import LandingPage from './LandingPage';

test('renders the Welcome heading and the marketing copy', () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByRole('heading', { name: 'Welcome to Endzone Empire' })).toBeInTheDocument();
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

test('the hero surfaces NFL pick\'em leagues as a second, discoverable option', () => {
  renderWithProviders(<LandingPage />);
  const hero = within(screen.getByTestId('landing-hero'));
  expect(hero.getByText(/turns armchair quarterbacks into legendary/i)).toBeInTheDocument();
  expect(hero.getByText(/NFL pick'em league/i)).toBeInTheDocument();
  expect(hero.getByText(/no draft, no rosters/i)).toBeInTheDocument();
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
    "League Pick'em",
    'Mock Draft Simulator',
  ].forEach((title) => {
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
  });
});

test('the hero offers the free mock draft as a no-account entry point', () => {
  renderWithProviders(<LandingPage />);
  expect(
    screen.getByRole('link', { name: /try a free mock draft/i })
  ).toHaveAttribute('href', '/draft-simulator');
});

test('the bottom CTA links to the registration page', () => {
  renderWithProviders(<LandingPage />);
  expect(screen.getByRole('heading', { name: /ready to build your dynasty/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create Your League Now' })).toHaveAttribute(
    'href',
    '/registration'
  );
});
