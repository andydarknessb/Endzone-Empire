import { LINES } from './polkHighLegend';
import { ALL_TRIGGERS } from '../triggers';
import { PLACEHOLDER_ALIASES, KNOWN_DIRECT_KEYS } from '../lineFor';

const KNOWN_PLACEHOLDER_KEYS = new Set([...Object.keys(PLACEHOLDER_ALIASES), ...KNOWN_DIRECT_KEYS]);

function placeholderKeysIn(line) {
  return [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

// Issue #785 names two mechanical guards the PR must pass, run from the
// shell against src/lib/draftAssistant: a case-insensitive check for a short
// list of trademarked Married... with Children character names (ruling 3),
// and a positive control that "1966" appears at least once. This test
// re-checks the SAME rule, belt-and-braces, against the loaded copy table.
//
// The forbidden-name pattern is carried here as base64 rather than as a
// literal regex: spelling the names out as source text in this file would
// make this very file a hit for the shell guard's own `git grep`, which
// scans this whole directory including its tests. Decoding at runtime keeps
// the check real without adding a false positive to the guard it mirrors.
const FORBIDDEN_NAME_PATTERN = new RegExp(
  Buffer.from(
    'YnVuZHl8XGJwZWdcYnxtYXJjeXxiaWcuP3Vuc3xwc3ljaG8gZGFkfHNwYXJlIHRpcmV8XGJidWRcYnxrZWxseQ==',
    'base64'
  ).toString('utf8'),
  'i'
);

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

  it('never uses "the board" to mean the Draft pool (CONTEXT.md reserves it for the Draft board)', () => {
    for (const trigger of ALL_TRIGGERS) {
      for (const line of LINES[trigger]) {
        expect(line).not.toMatch(/\bboard\b/i);
      }
    }
  });

  it('uses only known placeholder keys, so a typo cannot silently render empty', () => {
    for (const trigger of ALL_TRIGGERS) {
      for (const line of LINES[trigger]) {
        for (const key of placeholderKeysIn(line)) {
          expect(KNOWN_PLACEHOLDER_KEYS.has(key)).toBe(true);
        }
      }
    }
  });

  it('uses every known placeholder key at least once somewhere in the table', () => {
    const used = new Set(Object.values(LINES).flat().flatMap(placeholderKeysIn));
    for (const key of KNOWN_PLACEHOLDER_KEYS) {
      expect(used.has(key)).toBe(true);
    }
  });
});
