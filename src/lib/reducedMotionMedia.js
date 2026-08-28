/**
 * The SINGLE place the still-versus-animated choice is made for a viewer who
 * prefers reduced motion.
 *
 * Two surfaces choose a still frame instead of an animated original under
 * `prefers-reduced-motion`: team avatars (TeamAvatar) and GIF chat messages
 * (GifMessage, #446). Before this helper the rule lived only in TeamAvatar, whose
 * docblock claimed to be "the only place that choice is made"; adding a second
 * chooser would have quietly falsified that. So the decision - prefer the still
 * when the viewer asked for reduced motion AND a still actually exists, otherwise
 * the animation - lives here, and both callers map the returned boolean to their
 * own pair of sources. GifMessage additionally lets the viewer press Play to
 * override to the animation; that override is a GifMessage concern and is applied
 * on top of this shared default, not inside it.
 *
 * @param {boolean} prefersReducedMotion  the viewer's motion preference
 * @param {boolean} hasStill              whether a still rendition is available
 * @returns {boolean} true to show the still frame, false to show the animation
 */
export function shouldShowStillFrame(prefersReducedMotion, hasStill) {
  return Boolean(prefersReducedMotion && hasStill);
}

/**
 * Whether the viewer prefers reduced motion, read imperatively at call time.
 *
 * The global CSS policy (src/theme/base.css) covers declarative animations and
 * transitions, and React views use MUI's `useMediaQuery` for reactive reads.
 * But a smooth scroll requested through `element.scrollIntoView({ behavior:
 * 'smooth' })` is a JavaScript instruction whose explicit `behavior` wins over
 * any CSS `scroll-behavior`, so those call sites must consult the preference
 * themselves. This is that check, safe to call outside a React render and in a
 * non-browser (SSR/test) environment.
 *
 * @returns {boolean} true when '(prefers-reduced-motion: reduce)' matches.
 */
export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
