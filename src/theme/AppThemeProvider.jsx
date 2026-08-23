import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { colorTokens, elevationTokens, cssVarsForMode, BORDER_RADIUS } from './tokens';

const THEME_KEY = 'endzone_theme';

const ThemeModeContext = createContext({ mode: 'light', toggleMode: () => {} });

export const useThemeMode = () => useContext(ThemeModeContext);

export function initialMode() {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch (err) { /* storage unavailable */ }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * The MUI theme is derived entirely from the shared design tokens (see
 * ./tokens.js) so the component library and the plain-CSS layer never diverge.
 */
export function buildTheme(mode) {
  const c = colorTokens[mode];
  const e = elevationTokens[mode];
  return createTheme({
    palette: {
      mode,
      primary: { main: c.accent, contrastText: c['on-accent'] },
      secondary: { main: c.secondary },
      error: { main: c.danger },
      success: { main: c.success },
      warning: { main: c.warning },
      background: { default: c['bg-page'], paper: c.surface },
      text: { primary: c['text-primary'], secondary: c['text-muted'] },
      divider: c['border-subtle'],
    },
    shape: { borderRadius: BORDER_RADIUS },
    // One consistent type hierarchy: sizes, weights, and line-heights.
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h1: { fontWeight: 800, fontSize: '2.5rem', lineHeight: 1.15 },
      h2: { fontWeight: 800, fontSize: '2rem', lineHeight: 1.2 },
      h3: { fontWeight: 700, fontSize: '1.5rem', lineHeight: 1.25 },
      h4: { fontWeight: 700, fontSize: '1.25rem', lineHeight: 1.3 },
      h5: { fontWeight: 700, fontSize: '1.125rem', lineHeight: 1.35 },
      h6: { fontWeight: 600, fontSize: '1rem', lineHeight: 1.4 },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      body1: { lineHeight: 1.6 },
      body2: { lineHeight: 1.55 },
      button: { textTransform: 'none', fontWeight: 600 },
      // Custom variant for score/points figures: fixed-width digits so they
      // don't jitter horizontally as values change, plus a bolder weight.
      stat: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          // MUI's elevationN slots are fixed keys (elevation0..24), but callers use
          // arbitrary elevations (menus/popovers default to 8, dialogs to 24) — so
          // map ranges via the root slot function instead of enumerating every key.
          root: ({ ownerState }) => {
            const elevation = ownerState.elevation ?? 1;
            let boxShadow;
            if (elevation >= 4) boxShadow = e['shadow-3'];
            else if (elevation >= 2) boxShadow = e['shadow-2'];
            else if (elevation >= 1) boxShadow = e['shadow-1'];
            return { backgroundImage: 'none', ...(boxShadow ? { boxShadow } : {}) };
          },
        },
      },
      // Cleaner cards: hairline border + subtle elevation from the shadow tokens.
      MuiCard: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            border: `1px solid ${c['border-subtle']}`,
            borderRadius: 16,
            boxShadow: e['shadow-1'],
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 10,
            transition:
              'background-color 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
          },
        },
      },
      // Visible keyboard-focus ring for every button-like control (buttons,
      // icon buttons, tabs, list items, menu items, chips, ...).
      MuiButtonBase: {
        styleOverrides: {
          root: {
            '&.Mui-focusVisible': {
              outline: `2px solid ${c['focus-ring']}`,
              outlineOffset: 2,
            },
          },
        },
      },
      // Pill-style badges.
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 999, fontWeight: 600 },
        },
      },
      // Refined tables: hairline dividers, plus zebra striping and hover on
      // BODY rows only (header rows keep their colored background).
      MuiTableCell: {
        styleOverrides: {
          root: { borderColor: c['border-subtle'] },
        },
      },
      MuiTableBody: {
        styleOverrides: {
          root: {
            // An explicit opaque base, not just a transition: without it every
            // row's background-color is the initial 'transparent', and a
            // sticky action/round column (bgcolor: 'inherit') goes transparent
            // right along with it, letting scrolled-under cells show through.
            '& .MuiTableRow-root': {
              backgroundColor: c.surface,
              transition: 'background-color 150ms ease',
            },
            '& .MuiTableRow-root:nth-of-type(even)': {
              backgroundColor: c['row-stripe'],
            },
            '& .MuiTableRow-root:hover': { backgroundColor: c['row-hover'] },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            transition: 'background-color 200ms ease, color 200ms ease',
          },
          // Polished, theme-aware scrollbars.
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: c['border-strong'],
            borderRadius: 999,
          },
          '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
        },
      },
    },
  });
}

/** Write every token for `mode` onto <html> as a CSS custom property. */
function applyCssVariables(mode) {
  const root = document.documentElement;
  const vars = cssVarsForMode(mode);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
}

function AppThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, mode);
    } catch (err) { /* storage unavailable */ }
    // Plain-CSS files key off this attribute for their dark variants
    document.documentElement.setAttribute('data-theme', mode);
    // ...and read the actual values through injected CSS custom properties.
    applyCssVariables(mode);
  }, [mode]);

  const value = useMemo(
    () => ({ mode, toggleMode: () => setMode((m) => (m === 'light' ? 'dark' : 'light')) }),
    [mode]
  );
  const theme = useMemo(() => buildTheme(mode), [mode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}

export default AppThemeProvider;
