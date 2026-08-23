import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppThemeProvider, { useThemeMode, buildTheme, initialMode } from './AppThemeProvider';
import { colorTokens } from './tokens';

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

// #174: the MuiTableBody override is the single source for row stripe/hover
// backgrounds now that the per-component sx duplicates are gone. Pin it to
// row-stripe/row-hover (not surface-sunken/accent-soft) so a future edit
// can't silently repoint every table in the app at the wrong tokens.
test.each(['light', 'dark'])('%s theme paints table rows from row-stripe/row-hover', (mode) => {
  const theme = buildTheme(mode);
  const c = colorTokens[mode];
  const rowOverrides = theme.components.MuiTableBody.styleOverrides.root;

  expect(rowOverrides['& .MuiTableRow-root:nth-of-type(even)'].backgroundColor).toBe(c['row-stripe']);
  expect(rowOverrides['& .MuiTableRow-root:hover'].backgroundColor).toBe(c['row-hover']);
  expect(rowOverrides['& .MuiTableRow-root:nth-of-type(even)'].backgroundColor).not.toBe(c['surface-sunken']);
  expect(rowOverrides['& .MuiTableRow-root:hover'].backgroundColor).not.toBe(c['accent-soft']);
});

// #174 follow-up: every body row needs an explicit opaque base background, not
// just the even/hover overrides. Without one, an odd non-hovered row's
// background-color is the initial 'transparent' - and a sticky action/round
// column that inherits the row's background (bgcolor: 'inherit') goes
// transparent right along with it, letting horizontally-scrolled cells show
// through underneath the pinned column.
test.each(['light', 'dark'])('%s theme gives every table row an opaque base background', (mode) => {
  const theme = buildTheme(mode);
  const c = colorTokens[mode];
  const rowOverrides = theme.components.MuiTableBody.styleOverrides.root;

  expect(rowOverrides['& .MuiTableRow-root'].backgroundColor).toBe(c.surface);
});
