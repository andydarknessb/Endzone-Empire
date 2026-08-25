import { contrastRatio, relativeLuminance } from './contrast';

// Control values re-derived by hand in #203 and matched against the pairings
// the guard already asserts, so the compositing tests below sit on a formula
// that is known to agree with the rest of the suite.
const TEXT_MUTED_LIGHT = '#586472';
const SURFACE_LIGHT = '#ffffff';
const CONTROL_RATIO = 6.03; // text-muted / surface, light theme

describe('solid colors (unchanged behaviour)', () => {
  test('the text-muted / surface control still measures 6.03:1', () => {
    expect(contrastRatio(TEXT_MUTED_LIGHT, SURFACE_LIGHT)).toBeCloseTo(CONTROL_RATIO, 2);
  });

  test('a solid color needs no backdrop', () => {
    expect(() => contrastRatio('#000000', '#ffffff')).not.toThrow();
  });

  test('a non-color string still throws, naming the accepted forms', () => {
    expect(() => contrastRatio('nope', '#ffffff')).toThrow(
      /expected a hex or rgb\(\)\/rgba\(\) color/
    );
  });

  test('three-digit hex still expands', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
  });
});

describe('rgb() and rgba() parsing', () => {
  test('an opaque rgb() reproduces the control ratio', () => {
    expect(contrastRatio('rgb(88, 100, 114)', SURFACE_LIGHT)).toBeCloseTo(CONTROL_RATIO, 2);
  });

  test('an rgba() with alpha 1 reproduces the control ratio without a backdrop', () => {
    expect(contrastRatio('rgba(88, 100, 114, 1)', SURFACE_LIGHT)).toBeCloseTo(CONTROL_RATIO, 2);
  });
});

describe('alpha compositing over a backdrop', () => {
  // 50% black over white composites to exactly #808080, so the composited
  // ratio must equal the solid-hex ratio the guard would already compute.
  test('50% black over white equals the solid #808080 ratio', () => {
    const composited = contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)', '#ffffff');
    expect(composited).toBe(contrastRatio('#ffffff', '#808080'));
  });

  test('a fully transparent background leaves the backdrop untouched', () => {
    const composited = contrastRatio(TEXT_MUTED_LIGHT, 'rgba(0, 0, 0, 0)', SURFACE_LIGHT);
    expect(composited).toBeCloseTo(CONTROL_RATIO, 2);
  });

  test('a fully opaque alpha background ignores the backdrop', () => {
    const composited = contrastRatio(TEXT_MUTED_LIGHT, 'rgba(255, 255, 255, 1)', '#000000');
    expect(composited).toBeCloseTo(CONTROL_RATIO, 2);
  });

  test('an alpha foreground composites over the resolved background', () => {
    // 50% black text over a white card is the same #808080 as above.
    const composited = contrastRatio('rgba(0, 0, 0, 0.5)', SURFACE_LIGHT);
    expect(composited).toBe(contrastRatio('#808080', '#ffffff'));
  });

  test('an alpha foreground composites over an alpha background', () => {
    // fg 50% black over (50% black over white = #808080) => #404040.
    const composited = contrastRatio('rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.5)', '#ffffff');
    expect(composited).toBe(contrastRatio('#404040', '#808080'));
  });

  test('relativeLuminance composites an alpha over a backdrop', () => {
    expect(relativeLuminance('rgba(0, 0, 0, 0.5)', '#ffffff')).toBeCloseTo(
      relativeLuminance('#808080'),
      12
    );
  });
});

describe('a backdrop is required for alpha', () => {
  test('an alpha background without a backdrop throws and says why', () => {
    expect(() => contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)')).toThrow(/backdrop/i);
  });

  test('relativeLuminance on an alpha without a backdrop throws and says why', () => {
    expect(() => relativeLuminance('rgba(0, 0, 0, 0.5)')).toThrow(/backdrop/i);
  });

  test('the message names the color that needed compositing', () => {
    expect(() => contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)')).toThrow(/rgba\(0, 0, 0, 0\.5\)/);
  });

  test('a backdrop that is itself translucent throws', () => {
    expect(() =>
      contrastRatio('#ffffff', 'rgba(0, 0, 0, 0.5)', 'rgba(0, 0, 0, 0.2)')
    ).toThrow(/backdrop/i);
  });
});
