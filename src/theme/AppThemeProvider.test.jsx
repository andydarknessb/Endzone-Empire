import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Typography from '@mui/material/Typography';
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

// #701: subtitle1/subtitle2 carry type scale only. The theme's MuiTypography
// variantMapping renders them as <p> by default (MUI's default is <h6>), so an
// unqualified subtitle never injects a stray level-6 heading into the a11y
// tree; heading levels are always explicit via `component` (see the ADR).
// These render THROUGH AppThemeProvider on purpose: the shared
// renderWithProviders does not mount the theme, so a bare render would still
// resolve MUI's default <h6> and prove nothing about the policy.
describe('subtitle variants default to <p> under the theme (#701)', () => {
  test('subtitle1 renders <p> and keeps its MuiTypography-subtitle1 type scale', () => {
    render(
      <AppThemeProvider>
        <Typography variant="subtitle1">Subtitle one</Typography>
      </AppThemeProvider>
    );

    const el = screen.getByText('Subtitle one');
    expect(el.tagName).toBe('P');
    expect(el).toHaveClass('MuiTypography-subtitle1');
  });

  test('subtitle2 renders <p> and keeps its MuiTypography-subtitle2 type scale', () => {
    render(
      <AppThemeProvider>
        <Typography variant="subtitle2">Subtitle two</Typography>
      </AppThemeProvider>
    );

    const el = screen.getByText('Subtitle two');
    expect(el.tagName).toBe('P');
    expect(el).toHaveClass('MuiTypography-subtitle2');
  });

  test('an explicit component still wins over the subtitle default', () => {
    render(
      <AppThemeProvider>
        <Typography variant="subtitle2" component="h3">Explicit heading</Typography>
      </AppThemeProvider>
    );

    expect(screen.getByText('Explicit heading').tagName).toBe('H3');
  });

  test('other variants keep their default mapping (h6 stays H6, body1 stays P)', () => {
    render(
      <AppThemeProvider>
        <Typography variant="h6">Real heading</Typography>
        <Typography variant="body1">Body copy</Typography>
      </AppThemeProvider>
    );

    expect(screen.getByText('Real heading').tagName).toBe('H6');
    expect(screen.getByText('Body copy').tagName).toBe('P');
  });
});
