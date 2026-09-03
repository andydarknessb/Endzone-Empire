import fs from 'fs';
import path from 'path';
import { stealReachThreshold, stealReachLabel } from '../stealReach';
import { stealReachLabelFor } from '../../components/DraftBoard/roomAssistantFacts';
import { draftPickValue, pickValues } from './analysis';

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
  // The import may now name a sibling (stealReachLabel, #817) alongside the
  // threshold; what matters is analysis.js reads the threshold from the shared
  // module rather than redefining it.
  expect(source).toMatch(/import\s*\{[^}]*\bstealReachThreshold\b[^}]*\}\s*from\s*['"]\.\.\/stealReach['"]/);
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

// ---------------------------------------------------------------------------
// The label PARITY test ADR 0027 promised (issue #817). The threshold above
// was shared, but the labelling RULE had been written a third time in the
// Draft room (roomAssistantFacts.js) and drifted from the Sim's on degenerate
// ADP. Both now read src/lib/stealReach.js's stealReachLabel. This drives each
// venue's REAL entry point over one pick and asserts they agree: the room via
// stealReachLabelFor (re-exported shared rule), the Sim via pickValues() over
// a constructed state (the same function the post-draft report calls).
// ---------------------------------------------------------------------------
describe('stealReachLabel parity between the Draft room and the Draft Sim (#817)', () => {
  // Pick 30 with 10 teams is round 3 in both venues' arithmetic
  // (roundForPick floor((30-1)/10)+1 = 3; roundOfPick ceil(30/10) = 3), where
  // the steal/reach threshold is 6 + 1.5 * 3 = 10.5.
  const PICK = 30;
  const ROUND = 3;

  function roomLabel(adp) {
    const { label, draftValueScore } = stealReachLabelFor({ adp, pickNumber: PICK, round: ROUND });
    return { label, draftValueScore };
  }

  function simLabel(adp) {
    const state = {
      players: [{ playerId: 'p', adp, name: 'P', position: 'WR' }],
      teams: Array.from({ length: 10 }, (unused, i) => ({ id: i + 1, name: `T${i + 1}`, isUser: i === 0 })),
      picks: [{ playerId: 'p', pickNumber: PICK, teamId: 1 }],
    };
    const [pick] = pickValues(state);
    return { label: pick.label, draftValueScore: pick.draftValueScore };
  }

  // The five inputs from the triage divergence table plus one steal and one
  // reach that clear the round-3 threshold (10.5).
  const CASES = [
    { adp: 0, expected: { label: 'no-market', draftValueScore: 0 } },
    { adp: -5, expected: { label: 'no-market', draftValueScore: 0 } },
    { adp: 'abc', expected: { label: 'no-market', draftValueScore: 0 } },
    { adp: 12.333, expected: { label: 'steal', draftValueScore: -17.67 } },
    { adp: null, expected: { label: 'no-market', draftValueScore: 0 } },
    { adp: 15, expected: { label: 'steal', draftValueScore: -15 } },
    { adp: 45, expected: { label: 'reach', draftValueScore: 15 } },
  ];

  CASES.forEach(({ adp, expected }) => {
    test(`room and Sim agree for adp ${String(adp)}`, () => {
      const room = roomLabel(adp);
      const sim = simLabel(adp);
      expect(room).toEqual(expected);
      expect(sim).toEqual(expected);
      expect(room).toEqual(sim);
    });
  });

  // The round-free call is a STATED case, not an accident: draftPickValue()
  // calls stealReachLabel without a round because the report keeps its own
  // labelling. Without a round there is no threshold, so the pick is scored but
  // not classified (label null) - pinned here so no one "fixes" it into a
  // silent 'value'.
  test('stealReachLabel with no round scores but does not classify', () => {
    expect(stealReachLabel({ adp: 12.333, pickNumber: PICK }))
      .toEqual({ label: null, draftValueScore: -17.67, adpFallback: false });
    // A market-less ADP is still no-market with no round.
    expect(stealReachLabel({ adp: 0, pickNumber: PICK }))
      .toEqual({ label: 'no-market', draftValueScore: 0, adpFallback: true });
  });

  // draftPickValue is that round-free caller; it must still surface marketAdp
  // (the report's field) alongside the shared score and fallback.
  test('draftPickValue reads the round-free shared score and keeps marketAdp', () => {
    expect(draftPickValue({ pickNumber: PICK, marketAdp: 12.333 }))
      .toEqual({ marketAdp: 12.33, draftValueScore: -17.67, adpFallback: false });
    expect(draftPickValue({ pickNumber: PICK, marketAdp: 0 }))
      .toEqual({ marketAdp: PICK, draftValueScore: 0, adpFallback: true });
  });
});
