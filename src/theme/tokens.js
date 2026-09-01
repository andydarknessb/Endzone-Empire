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
    // ---- League Dashboard token group (light), derived from the dark group
    // below. See the dark block for the full rationale; only the derivation
    // notes specific to light live here. Registered pairings: tokens.contrast.
    'dash-bg': '#eef2f6',
    'dash-surface': '#ffffff',
    'dash-surface2': '#f4f7fa',
    'dash-surface3': '#e6ecf2',
    'dash-line': 'rgba(31, 45, 58, 0.12)',
    'dash-line-strong': 'rgba(31, 45, 58, 0.22)',
    'dash-ink': '#141b23',
    'dash-dim': '#55636f',
    'dash-faint': '#6e7b85',
    // Accent flips DARK in light mode (the app's own `accent` does the same,
    // #1e5bb8 light vs #7eaaff dark): the mockup's bright #2fd97b is far too
    // light to carry the "You" pill / live-chip text on a near-white card, so
    // light mode uses a dark green and `dash-on-accent` flips to white.
    'dash-accent': '#12784a',
    'dash-accent-soft': 'rgba(18, 120, 74, 0.12)',
    'dash-accent-line': 'rgba(18, 120, 74, 0.32)',
    // Grade colors are a data encoding (letter -> hue) and are kept identical
    // in both themes so an A chip reads the same everywhere; the fixed dark
    // `dash-on-grade` ink clears AA on all five (verified in tokens.contrast).
    'dash-grade-a': '#2fd97b',
    'dash-grade-b': '#a8cc4a',
    'dash-grade-c': '#e5b04a',
    'dash-grade-d': '#e07a45',
    'dash-grade-f': '#e25c5c',
    'dash-on-grade': '#0b1015',
    'dash-on-accent': '#ffffff',
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
    // this move touches. That second lightening left `accent-hover` almost
    // indistinguishable from `accent` (1.05:1, down from ~1.35:1): nothing
    // asserted the resting/hover delta, so the regression shipped unnoticed.
    // Lightened `accent-hover` to #a9c6ff to restore a ~1.34:1 delta while
    // keeping `on-accent` on it near 10.88:1 and its own ratio against
    // `surface-raised` near 8.23:1 (#267); see tokens.contrast.test.js.
    accent: '#7eaaff',
    'accent-hover': '#a9c6ff',
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
    // ---- League Dashboard token group (dark). This is the SOURCE the light
    // group above is derived from: every value here is lifted verbatim from
    // the approved mockup's :root block (docs/design/dashboard-concept.html,
    // embedded in #617) EXCEPT `dash-faint`, noted below. The dashboard
    // (ADR 0020) themes `shared/ui` and its widgets from these names via the
    // usual --var flattening; every ink-on-surface pairing is contrast-guarded
    // in tokens.contrast.test.js for BOTH modes.
    'dash-bg': '#0b1015',
    'dash-surface': '#141b23',
    'dash-surface2': '#1b242f',
    'dash-surface3': '#222e3b',
    'dash-line': 'rgba(154, 183, 211, 0.12)',
    'dash-line-strong': 'rgba(154, 183, 211, 0.22)',
    'dash-ink': '#e8eef4',
    'dash-dim': '#93a4b5',
    // Nudged from the mockup's #5c6e80. `dash-faint` is the de-emphasized
    // label tier and is registered at AA_LARGE (3.0), but the verbatim value
    // clears 3.0 only on `dash-bg`/`dash-surface` and FAILS it on the lighter
    // `dash-surface2` (2.98) and `dash-surface3` (2.63), so the guard would go
    // red. Lifted to #6e8093, the smallest lightening that clears 3.0 on the
    // lightest surface (3.40 on surface3) with headroom, mirroring how this
    // file already lightened `accent` to satisfy the same guard (see #237).
    // Widgets must use `dash-dim` (AA_TEXT) for any small essential label;
    // `dash-faint` is reserved for large or non-essential secondary text.
    'dash-faint': '#6e8093',
    'dash-accent': '#2fd97b',
    'dash-accent-soft': 'rgba(47, 217, 123, 0.12)',
    'dash-accent-line': 'rgba(47, 217, 123, 0.35)',
    // Data-encoding grade colors, kept identical across themes (see light).
    'dash-grade-a': '#2fd97b',
    'dash-grade-b': '#a8cc4a',
    'dash-grade-c': '#e5b04a',
    'dash-grade-d': '#e07a45',
    'dash-grade-f': '#e25c5c',
    // The dark ink the mockup paints on grade chips and on the primary button.
    'dash-on-grade': '#0b1015',
    'dash-on-accent': '#0b1015',
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
  // League Dashboard radii and type faces (theme-independent), from the
  // mockup's :root (--r, --r-sm, --display, --body). The two families are
  // self-hosted woff2 (see src/theme/base.css @font-face), never fetched from
  // Google Fonts at runtime; these carry the mockup's fallback stacks.
  'dash-radius': '14px',
  'dash-radius-sm': '10px',
  'dash-font-display': '"Barlow Condensed", Impact, sans-serif',
  'dash-font-body': '"Archivo", "Helvetica Neue", Arial, sans-serif',
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
