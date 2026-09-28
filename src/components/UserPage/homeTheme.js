import { createTheme } from '@mui/material/styles';

// Every typography variant MUI stamps a font family onto, plus the app's
// custom `stat` variant (AppThemeProvider).
const VARIANTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'subtitle2',
  'body1', 'body2', 'button', 'caption', 'overline', 'stat',
];

const BODY_FONT = 'var(--dash-font-body)';

/**
 * Home's theme (ADR 0051): the app theme with its type set in the island's
 * body face. Each MUI Typography variant carries its own `fontFamily` (the
 * app's Inter stack, which nothing loads: the audit's finding m4), so a page
 * root's `font-family` alone never reaches a Typography, a Button or an
 * input. Re-basing every variant on `--dash-font-body` here is what lets Home
 * render Archivo everywhere, dialogs included (they portal out of the page
 * but stay inside this provider). Display-face headings and scores still set
 * `--dash-font-display` in their own `sx`. Palette, shape and component
 * overrides are the outer theme's, untouched.
 *
 * UserPage builds it from `useTheme()` in a `useMemo`, so it is rebuilt only
 * when the outer theme (the light/dark mode) changes, and a render with no
 * outer provider (the tests) starts from MUI's default theme.
 */
export default function homeTheme(outerTheme) {
  const typography = { fontFamily: BODY_FONT };
  VARIANTS.forEach((variant) => {
    typography[variant] = { fontFamily: BODY_FONT };
  });
  return createTheme(outerTheme, { typography });
}
