import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

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
 * Design tokens live here — spacing, radii, type scale, and both palettes.
 * Components inherit through the MUI theme; no per-component color forks.
 */
export function buildTheme(mode) {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'dark' ? '#4f8cff' : '#1e5bb8' },
      secondary: { main: mode === 'dark' ? '#7ee2a8' : '#1b7d4f' },
      background: mode === 'dark'
        ? { default: '#0f1419', paper: '#1a2129' }
        : { default: '#f4f6f8', paper: '#ffffff' },
    },
    shape: { borderRadius: 10 },
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
    },
  });
}

function AppThemeProvider({ children }) {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_KEY, mode);
    } catch (err) { /* storage unavailable */ }
    // Plain-CSS files key off this attribute for their dark variants
    document.documentElement.setAttribute('data-theme', mode);
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
