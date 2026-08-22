// Shared accessibility constants (issue #121, parent spec #108).

// WCAG 2.5.5 (Target Size, AAA) / 2.5.8 (Target Size Minimum, AA): every
// interactive control should offer at least a 44x44 CSS-pixel hit area.
// Grown directly (minWidth/minHeight) rather than via an invisible expanded
// hit region, so the actual rendered element - the thing a browser test's
// boundingBox() measures - meets the bound, not just a synthetic overlay.
export const MIN_TOUCH_TARGET = 44;

export const touchTargetSx = { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET };
