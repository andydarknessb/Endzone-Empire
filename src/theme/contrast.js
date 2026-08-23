/**
 * WCAG 2.1 relative-luminance and contrast-ratio helpers, used by
 * tokens.contrast.test.js to guarantee the design tokens stay accessible in
 * both themes.
 *
 * Accepts 3- and 6-digit hex, `rgb()` and `rgba()`. A translucent color has no
 * luminance of its own, so callers must also pass a solid `backdrop` color to
 * composite it over; without one these helpers throw rather than guess. That is
 * what lets alpha tokens (`accent-soft`, `overlay`, `scrim`) be asserted at all
 * instead of being structurally unrepresentable (#203).
 *
 * Compositing is standard source-over alpha blending, rounded to 8-bit channels
 * the way a browser rasterises it, so `rgba(0, 0, 0, 0.5)` over `#ffffff`
 * measures exactly as `#808080` does.
 */

const HEX_BODY = /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function invalid(value) {
  return new Error(
    `contrast: expected a hex or rgb()/rgba() color, got "${value}"`
  );
}

function toChannel(part, value) {
  if (!NUMBER.test(part)) throw invalid(value);
  const n = Number(part);
  if (n < 0 || n > 255) throw invalid(value);
  return n;
}

function toAlpha(part, value) {
  if (!NUMBER.test(part)) throw invalid(value);
  const n = Number(part);
  if (n < 0 || n > 1) throw invalid(value);
  return n;
}

/** Parse any supported color into { r, g, b, a }, with a defaulting to 1. */
function parseColor(value) {
  if (typeof value !== 'string') throw invalid(value);
  const raw = value.trim();

  const fn = raw.match(RGB_FUNCTION);
  if (fn) {
    const parts = fn[1].split(',').map((part) => part.trim());
    if (parts.length !== 3 && parts.length !== 4) throw invalid(value);
    return {
      r: toChannel(parts[0], value),
      g: toChannel(parts[1], value),
      b: toChannel(parts[2], value),
      a: parts.length === 4 ? toAlpha(parts[3], value) : 1,
    };
  }

  let h = raw.replace('#', '');
  if (!HEX_BODY.test(h)) throw invalid(value);
  if (h.length === 3) {
    h = h.split('').map((ch) => ch + ch).join('');
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: 1,
  };
}

/** Parse an optional backdrop, which must itself be opaque. */
function parseBackdrop(backdrop) {
  if (backdrop === undefined || backdrop === null) return null;
  const color = parseColor(backdrop);
  if (color.a !== 1) {
    throw new Error(
      `contrast: the backdrop must be a solid color, got "${backdrop}"`
    );
  }
  return color;
}

/**
 * Resolve a color to opaque channels, compositing it over `backdrop` (already
 * parsed and opaque) when it carries alpha.
 */
function resolveSolid(value, backdrop) {
  const color = parseColor(value);
  if (color.a === 1) return color;
  if (!backdrop) {
    throw new Error(
      `contrast: "${value}" is translucent, so it has no contrast on its own; ` +
        'pass a solid backdrop color to composite it over'
    );
  }
  const blend = (channel, base) => Math.round(channel * color.a + base * (1 - color.a));
  return {
    r: blend(color.r, backdrop.r),
    g: blend(color.g, backdrop.g),
    b: blend(color.b, backdrop.b),
    a: 1,
  };
}

function channelLuminance(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanceOf({ r, g, b }) {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/**
 * Relative luminance of a color. Pass `backdrop` (a solid color) when the color
 * carries alpha; it is composited over the backdrop first.
 */
export function relativeLuminance(color, backdrop) {
  return luminanceOf(resolveSolid(color, parseBackdrop(backdrop)));
}

/**
 * Contrast ratio between `fg` and `bg`. `backdrop` is the solid color sitting
 * behind the pairing: the background composites over it, and the foreground
 * then composites over the resolved background. It is required whenever a
 * translucent color cannot otherwise be resolved.
 */
export function contrastRatio(fg, bg, backdrop) {
  const base = parseBackdrop(backdrop);
  const bgSolid = resolveSolid(bg, base);
  const fgSolid = resolveSolid(fg, bgSolid);
  const l1 = luminanceOf(fgSolid);
  const l2 = luminanceOf(bgSolid);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
