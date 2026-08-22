/**
 * Small accessibility helpers shared across otherwise-unrelated components
 * (not Draft-specific, unlike pickAvailability.js) so a value like the
 * minimum touch target isn't redefined per surface.
 */

/** WCAG 2.5.5-style minimum touch target, applied via `sx`. */
export const MIN_TOUCH_TARGET_SX = { minWidth: 44, minHeight: 44 };
