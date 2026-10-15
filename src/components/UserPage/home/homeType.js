// Home's two faces (DESIGN.md "Play-select: Home and league pages"): Press Start 2P for
// headings, scores, card names and lock times; Archivo for everything read as a
// sentence. Press Start 2P is self-hosted in src/theme/base.css.
export const PIXEL_FONT = "'Press Start 2P', ui-monospace, monospace";
export const BODY_FONT = "Archivo, 'Helvetica Neue', Arial, sans-serif";

// The pixel face sets at 16, 24 and 32px only, on an 8px grid; anything
// smaller snaps up to 16.
const snap = (size) => Math.min(32, Math.max(16, Math.round(size / 8) * 8));

/** `sx` for pixel type: uppercase, line height 1.5, size snapped to 16/24/32. */
export const pixelSx = (size) => ({
  fontFamily: PIXEL_FONT,
  fontSize: `${snap(size)}px`,
  lineHeight: 1.5,
  fontWeight: 400,
  textTransform: 'uppercase',
});

/** Visually hidden, still read by a screen reader. */
export const SR_ONLY_SX = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
};
