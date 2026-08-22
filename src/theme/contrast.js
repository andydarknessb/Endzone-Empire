/**
 * WCAG 2.1 relative-luminance and contrast-ratio helpers, used by
 * tokens.contrast.test.js to guarantee the design tokens stay accessible in
 * both themes. Handles 3- and 6-digit hex; callers pass solid colors only.
 */

function hexToRgb(hex) {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((ch) => ch + ch).join('');
  }
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) {
    throw new Error(`contrast: expected a solid hex color, got "${hex}"`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function channelLuminance(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
