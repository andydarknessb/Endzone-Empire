# Heading levels are explicit; subtitle variants carry type scale only

Status: accepted (2026-09-02)

MUI's `Typography` maps a `variant` to an HTML element through its built-in
`variantMapping`, and that default maps both `subtitle1` and `subtitle2` to
`<h6>`. In this codebase `buildTheme` (see `src/theme/AppThemeProvider.jsx`)
set typography sizes and weights but no `variantMapping`, so every subtitle
`Typography` written without an explicit `component` rendered as a level-6
heading. Subtitles are used as small bold labels on cards, panels, and rows,
not as document structure, so each one dropped a stray `<h6>` into the
accessibility tree: heading order that a screen-reader user navigates by was
being set as a side effect of picking a type size. There were 59 such
unqualified subtitle sites at the time of this decision.

We separate two concerns that MUI's default conflates. A heading's level is a
structural decision and must be made explicitly, by passing `component="hN"`
(or a semantic element) at the call site. A variant is a type-scale decision
only. The subtitle variants exist to carry a size and weight, never a heading
level, so their default element must be a non-heading. We therefore remap
`subtitle1` and `subtitle2` to `<p>` at the theme, via
`components.MuiTypography.defaultProps.variantMapping`, leaving the type scale
(`fontWeight`, sizes) unchanged. MUI resolves theme `defaultProps` before the
component's own prop default and falls back to its built-in mapping for any
variant not listed, so only these two keys change: `h1`-`h6` still map to their
matching heading elements, `body1`/`body2` still map to `<p>`, and an explicit
`component` prop still wins over the default at any site.

The theme default is the enforcement mechanism. We deliberately add no lint
rule and no CI guard for subtitle variants: a rule that flagged every subtitle
without a `component` would fight the very default that makes the bare case
safe. Making the safe element the default, and requiring `component` only when
a heading is actually wanted, is the guard.

One test-harness fact shapes how this policy is verified, and it is recorded
here because it is easy to get wrong. The shared `renderWithProviders`
(`src/test-utils/renderWithProviders.jsx`) mounts a redux `Provider` and a
router but **no** `ThemeProvider` or `AppThemeProvider`. A component rendered
through it therefore does not see this theme, so its subtitles still resolve
MUI's built-in `<h6>`. Two consequences follow. First, the assertions that
prove this policy (in `src/theme/AppThemeProvider.test.jsx`) render their
`Typography` through `AppThemeProvider` directly, not through
`renderWithProviders`; a bare render would assert nothing about the default.
Second, a heading-role query in a bare component test is meaningful only for a
subtitle that sets an explicit `component`, which is exactly why the
per-surface tickets (#702-#705) set `component` on every existing site rather
than relying on the theme default showing up in those tests.

## Consequences

- A new subtitle `Typography` needs no `component` to be safe: it renders
  `<p>` and stays out of the heading tree by default. A `component="hN"` is
  added only where a heading of that level is genuinely intended.
- Removing or narrowing the `subtitle1`/`subtitle2` entries in
  `buildTheme`'s `MuiTypography.defaultProps.variantMapping` reintroduces the
  `<h6>` regression across every unqualified subtitle site at once. The theme
  assertions pin both entries; a change that drops one turns them red.
- This ADR records the policy only. It does not itself set `component` on the
  59 existing sites; that sweep is #702-#705, which are blocked on the theme
  default landing first.
- Because the type scale is untouched, this is not a visual change: subtitles
  keep their existing size and weight and only their rendered element (and
  thus their accessibility role) changes.
- The default is not a substitute for judgement about heading order. Turning a
  subtitle into a real heading still requires choosing the correct level for
  its position in the document outline, not just adding `component="h6"`.
