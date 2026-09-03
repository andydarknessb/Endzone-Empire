import fs from 'fs';
import path from 'path';
import { stealReachThreshold } from '../stealReach';

// stealReachThreshold used to be defined inline in analysis.js; issue #785
// promoted it to src/lib/stealReach.js so the Draft assistant (ADR 0027) and
// the Draft Sim's post-draft report read one definition instead of two that
// could drift apart. analysis.js now only imports and re-exports it.
//
// In the kickerDefenseWindow.parity.test.js idiom, this reads the PROMOTED
// module's own source and scrapes the formula's two literals out of the
// function body via regex, rather than trusting `import` plus a hand-picked
// expectation to notice a drifted constant. Anchored to the `export function
// stealReachThreshold` DECLARATION, not a bare `stealReachThreshold` mention,
// so a docblock reference elsewhere in the file can't be mistaken for the
// formula itself (the kickerDefenseWindow gap, #755-f4).
function readSource(...segments) {
  return fs.readFileSync(path.join(__dirname, ...segments), 'utf8');
}

function extractFormula(source) {
  const match = source.match(
    /export function stealReachThreshold\(round\)\s*\{\s*return\s*([\d.]+)\s*\+\s*([\d.]+)\s*\*\s*round/
  );
  if (!match) throw new Error('stealReachThreshold.parity: could not find the formula declaration');
  return { base: Number(match[1]), multiplier: Number(match[2]) };
}

test('analysis.js imports stealReachThreshold instead of redefining it', () => {
  const source = readSource('analysis.js');
  expect(source).toMatch(/import\s*\{\s*stealReachThreshold\s*\}\s*from\s*['"]\.\.\/stealReach['"]/);
  expect(source).not.toMatch(/export function stealReachThreshold/);
});

test('the promoted formula is pinned to 6 + 1.5 * round', () => {
  // The pin lives here as literal numbers, not values re-derived from the
  // same source scrape: editing the source's 6 to a 7 (or the 1.5 to
  // anything else) moves `base`/`multiplier` and turns THIS assertion red,
  // which is the whole point of a parity test that isn't just re-reading its
  // own subject back at itself.
  const { base, multiplier } = extractFormula(readSource('..', 'stealReach.js'));
  expect(base).toBe(6);
  expect(multiplier).toBe(1.5);
});

test('the live function matches the source-scraped formula for several rounds', () => {
  const { base, multiplier } = extractFormula(readSource('..', 'stealReach.js'));
  for (const round of [1, 4, 10, 16]) {
    expect(stealReachThreshold(round)).toBe(base + multiplier * round);
  }
});
