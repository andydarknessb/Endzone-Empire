import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { colorTokens, cssVarsForMode, BORDER_RADIUS } from './tokens';

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
    typography: {
      fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            transition: 'background-color 200ms ease, color 200ms ease',
          },
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
