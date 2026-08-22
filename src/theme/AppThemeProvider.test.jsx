import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppThemeProvider, { useThemeMode, buildTheme, initialMode } from './AppThemeProvider';

function Probe() {
  const { mode, toggleMode } = useThemeMode();
  return (
    <button type="button" onClick={toggleMode}>
      mode:{mode}
    </button>
  );
}

afterEach(() => {
  window.localStorage.clear();
});

test('defaults to light and toggles to dark, persisting the choice', async () => {
  render(
    <AppThemeProvider>
      <Probe />
    </AppThemeProvider>
  );

  expect(screen.getByText('mode:light')).toBeInTheDocument();
  expect(document.documentElement.getAttribute('data-theme')).toBe('light');

  await userEvent.click(screen.getByRole('button'));

  expect(screen.getByText('mode:dark')).toBeInTheDocument();
  expect(window.localStorage.getItem('endzone_theme')).toBe('dark');
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
});

test('a stored preference wins over the system default', () => {
  window.localStorage.setItem('endzone_theme', 'dark');
  expect(initialMode()).toBe('dark');
});

test('buildTheme produces distinct palettes per mode with shared tokens', () => {
  const light = buildTheme('light');
  const dark = buildTheme('dark');
  expect(light.palette.mode).toBe('light');
  expect(dark.palette.mode).toBe('dark');
  expect(light.palette.background.default).not.toBe(dark.palette.background.default);
  expect(light.shape.borderRadius).toBe(10);
  expect(dark.shape.borderRadius).toBe(10);
});
