import { LINES } from './polkHighLegend';
import { ALL_TRIGGERS } from '../triggers';

// The two mechanical guards the PR body must name and pass (issue #785):
//   git grep -nEi "bundy|\bpeg\b|marcy|big.?uns|psycho dad|spare tire|\bbud\b|kelly" src/lib/draftAssistant
//   git grep -nF "1966" src/lib/draftAssistant
// This test re-checks the same rule against the loaded copy table itself
// (belt-and-braces alongside the git grep run from the shell), so a future
// line added here without re-running the grep by hand still gets caught.
const FORBIDDEN_NAME_PATTERN = /bundy|\bpeg\b|marcy|big.?uns|psycho dad|spare tire|\bbud\b|kelly/i;

describe('polkHighLegend copy table', () => {
  it('covers every ruling-7 trigger with at least six lines', () => {
    for (const trigger of ALL_TRIGGERS) {
      expect(Array.isArray(LINES[trigger])).toBe(true);
      expect(LINES[trigger].length).toBeGreaterThanOrEqual(6);
    }
  });

  it('has no duplicate lines within a single trigger\'s pool', () => {
    for (const trigger of ALL_TRIGGERS) {
      expect(new Set(LINES[trigger]).size).toBe(LINES[trigger].length);
    }
  });

  it('never names a trademarked Married... with Children character (ruling 3)', () => {
    for (const trigger of ALL_TRIGGERS) {
      for (const line of LINES[trigger]) {
        expect(line).not.toMatch(FORBIDDEN_NAME_PATTERN);
      }
    }
  });

  it('carries the 1966 backstory somewhere in the table (positive control)', () => {
    const allText = Object.values(LINES).flat().join(' ');
    expect(allText).toMatch(/1966/);
  });

  it('never uses an em dash (house style, ADR 0016)', () => {
    for (const trigger of ALL_TRIGGERS) {
      for (const line of LINES[trigger]) {
        expect(line).not.toMatch(/—/);
      }
    }
  });
});
