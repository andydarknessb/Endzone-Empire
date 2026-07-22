import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppThemeProvider from '../../theme/AppThemeProvider';
import PublicHeader from './PublicHeader';

beforeEach(() => {
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});

function renderHeader() {
  return render(
    <AppThemeProvider>
      <MemoryRouter>
        <PublicHeader />
      </MemoryRouter>
    </AppThemeProvider>
  );
}

describe('PublicHeader', () => {
  it('renders the primary nav links', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: 'Rankings' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Waiver Wire' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Strategy' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recaps' })).toBeInTheDocument();
  });

  it('points Log In and Register at the hash-app auth routes', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: 'Log In' })).toHaveAttribute('href', '/#/login');
    expect(screen.getByRole('link', { name: 'Register' })).toHaveAttribute('href', '/#/registration');
  });

  it('toggles the color theme', () => {
    renderHeader();
    const before = document.documentElement.getAttribute('data-theme');
    fireEvent.click(screen.getAllByLabelText('Toggle color theme')[0]);
    const after = document.documentElement.getAttribute('data-theme');
    expect(after).not.toBe(before);
    expect(['light', 'dark']).toContain(after);
  });

  it('opens and closes the mobile navigation drawer', async () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recaps' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation menu' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Close navigation menu' })).not.toBeInTheDocument());
  });
});
