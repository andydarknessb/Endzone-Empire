import { createTheme } from '@mui/material/styles';
import { BODY_FONT } from '../../shared/ui/playselect/type';

// Every typography variant MUI stamps a font family onto, plus the app's
// custom `stat` variant (AppThemeProvider).
const VARIANTS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'subtitle2',
  'body1', 'body2', 'button', 'caption', 'overline', 'stat',
];

/**
 * Home's theme (ADR 0051): the app theme with its type set in Home's body face
 * (Archivo, `BODY_FONT`). Each MUI Typography variant carries its own
 * `fontFamily` (the app's system stack, Roboto, Helvetica and Arial; the audit's finding
 * m4), so a page root's `font-family` alone never reaches a Typography, a
 * Button or an input. Re-basing every variant on `BODY_FONT` here is what lets
 * Home render Archivo everywhere, dialogs included (they portal out of the page
 * but stay inside this provider). Pixel headings and scores set their own face
 * through `pixelSx`. Palette, shape and component overrides are the outer
 * theme's, untouched.
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
