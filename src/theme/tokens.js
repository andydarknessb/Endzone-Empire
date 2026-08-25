/**
 * SINGLE SOURCE OF TRUTH for the design system.
 *
 * Every color, radius, spacing step, elevation, and motion value lives here.
 * Two consumers derive from these tokens so nothing can drift:
 *   1. buildTheme() in AppThemeProvider maps them into the MUI palette/shape.
 *   2. AppThemeProvider injects them as CSS custom properties on <html>, so
 *      plain-CSS files reference them with var(--token) and stay theme-aware.
 *
 * Rule: no component (CSS, sx, or inline) should hard-code a color literal.
 * Add a semantic token here and reference it instead.
 */

// Per-theme colors. Keys are semantic (what the color is for), never literal
// ("accent", not "blue"). Contrast pairings are verified in tokens.contrast.test.js.
export const colorTokens = {
  light: {
    'bg-page': '#f4f6f8',
    surface: '#ffffff',
    'surface-raised': '#ffffff',
    'surface-sunken': '#eceff2',
    'text-primary': '#1a2129',
    'text-muted': '#586472',
    'text-inverse': '#ffffff',
    'border-subtle': '#dde2e7',
    'border-strong': '#c3ccd4',
    accent: '#1e5bb8',
    'accent-hover': '#17498f',
    'accent-soft': 'rgba(30, 91, 184, 0.10)',
    'on-accent': '#ffffff',
    secondary: '#1b7d4f',
    success: '#1b7d4f',
    danger: '#c62828',
    warning: '#8a5a00',
    // Opaque (not alpha) so the ratio against each surface it can sit on is
    // fixed: one measurement covers every surface, where an alpha would need
    // one per backdrop it composites over (tokens.contrast.test.js can measure
    // those since #203, but the ring wants a single answer). This is `accent`
    // with the alpha dropped. See #155.
    'focus-ring': '#1e5bb8',
    overlay: 'rgba(15, 20, 25, 0.5)',
    // Fantasy position palette (data encoding). Light theme: saturated, dark
    // enough to carry white (`text-inverse`) chip/avatar labels at AA.
    'pos-qb': '#c62828', // red
    'pos-rb': '#15663f', // green
    'pos-wr': '#1e5bb8', // blue
    'pos-te': '#9a5100', // orange
    'pos-k': '#6d28d9', // purple
    'pos-def': '#4b5c66', // gray
    'pos-idp': '#008477', // teal — individual defenders (DE/DT/LB/CB/S/DB)
    // Opaque table row shades. Sticky cells inherit these so the pinned column
    // has no seam against the striped/hover row (transparency would let
    // scrolled content bleed through).
    'row-stripe': '#f7f9fb',
    'row-hover': '#eaeff4',
    // Medal accents for podium/standings UI. Gold reuses `warning`; these two
    // fill the silver/bronze slots MUI's palette has no equivalent for.
    'medal-silver': '#9aa5b1',
    'medal-bronze': '#a56a3a',
  },
  dark: {
    'bg-page': '#0f1419',
    surface: '#1a2129',
    'surface-raised': '#222c37',
    'surface-sunken': '#0b0f13',
    'text-primary': '#e6edf3',
    'text-muted': '#9aa7b4',
    'text-inverse': '#0f1419',
    'border-subtle': '#2a3441',
    'border-strong': '#3a4756',
    // Lightened twice from an original #4f8cff, both times for the same
    // surface. First to #5c93ff, which cleared AA on `bg-page`/`surface` but
    // came in at 4.4:1 against `surface-raised` (the app bar). That value held
    // for the *base* app-bar pairing, but #203 taught the contrast guard to
    // composite alpha over a named backdrop and exposed a pairing nobody could
    // measure before: the Nav link hover, `accent` on `accent-soft` (accent at
    // alpha 0.16) over that same `surface-raised`, which measured 3.75:1 — the
    // tint moves the effective background lighter without moving the text, so
    // the underlying base pairing had never captured it. Lightened a second
    // time to #7eaaff so the hover composite clears AA too (#237); see
    // tokens.contrast.test.js for the asserted pairing and every other ratio
    // this move touches.
    accent: '#7eaaff',
    'accent-hover': '#7fb0ff',
    'accent-soft': 'rgba(126, 170, 255, 0.16)',
    'on-accent': '#0b1220',
    secondary: '#7ee2a8',
    success: '#7ee2a8',
    danger: '#ff6b6b',
    warning: '#f0b34e',
    // Opaque (not alpha); see the light-theme note above and #155. Kept equal
    // to `accent` through both lightenings (#237).
    'focus-ring': '#7eaaff',
    overlay: 'rgba(0, 0, 0, 0.6)',
    // Fantasy position palette (data encoding). Dark theme: lighter, brighter
    // fills that carry the dark `text-inverse` label at AA.
    'pos-qb': '#ff8a80', // red
    'pos-rb': '#7ee2a8', // green
    'pos-wr': '#7fb0ff', // blue
    'pos-te': '#f0b34e', // orange
    'pos-k': '#c4a2f5', // purple
    'pos-def': '#b0bec5', // gray
    'pos-idp': '#4db6ac', // teal — individual defenders (DE/DT/LB/CB/S/DB)
    // Opaque table row shades (see the light theme note above).
    'row-stripe': '#1e2732',
    'row-hover': '#28323e',
    // Medal accents for podium/standings UI (see the light theme note above).
    'medal-silver': '#b8c0c9',
    'medal-bronze': '#c98a54',
  },
};

// Per-theme elevation. Shadows read differently on light vs dark surfaces.
export const elevationTokens = {
  light: {
    'shadow-1': '0 1px 2px rgba(16, 24, 32, 0.08)',
    'shadow-2': '0 4px 12px rgba(16, 24, 32, 0.10)',
    'shadow-3': '0 12px 28px rgba(16, 24, 32, 0.16)',
  },
  dark: {
    'shadow-1': '0 1px 2px rgba(0, 0, 0, 0.45)',
    'shadow-2': '0 6px 16px rgba(0, 0, 0, 0.5)',
    'shadow-3': '0 14px 32px rgba(0, 0, 0, 0.6)',
  },
};

// Theme-independent scales (spacing, radii, motion, and a fixed light color for
// text that always sits on a dark photo overlay regardless of theme).
export const scaleTokens = {
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '24px',
  'space-6': '32px',
  'space-7': '48px',
  'space-8': '64px',
  'radius-sm': '6px',
  'radius-md': '10px',
  'radius-lg': '16px',
  'radius-pill': '999px',
  'transition-fast': '150ms',
  'transition-base': '200ms',
  // Brand wordmark gradient (public layer + landing hero). References the
  // per-theme accent/secondary vars so it resolves correctly in both themes
  // while keeping the gradient literal in one place.
  'gradient-brand': 'linear-gradient(90deg, var(--accent), var(--secondary))',
  // Fixed light text + dark scrim for content that always sits on a photo
  // background (UserPage), independent of the active theme. `scrim` is
  // asserted at the AA_TEXT (4.5:1) body-text threshold, not the large-text
  // one `overlay` still holds to; see tokens.contrast.test.js (#238).
  'on-overlay': '#f4f6f8',
  scrim: 'rgba(0, 0, 0, 0.56)',
};

export const BORDER_RADIUS = 10; // matches --radius-md; consumed by MUI shape

/**
 * Flatten the tokens for a given mode into a { '--name': value } map ready to
 * write onto an element's style. Colors + elevation are mode-specific; scales
 * are shared.
 */
export function cssVarsForMode(mode) {
  const source = {
    ...colorTokens[mode],
    ...elevationTokens[mode],
    ...scaleTokens,
  };
  const vars = {};
  for (const [name, value] of Object.entries(source)) {
    vars[`--${name}`] = value;
  }
  return vars;
}
