import { MAX_CHAT_CHARS, CHAT_CHARS_WARNING, characterCount } from './chatLimits';

// The counter must count the same units the server clamp and the varchar(500)
// column count: Unicode code points, NOT UTF-16 code units and NOT grapheme
// clusters (#486). These cases pin that choice so a switch to `text.length`
// (code units) or to Intl.Segmenter (graphemes) fails here.
describe('characterCount', () => {
  test('counts plain ASCII one per character', () => {
    expect(characterCount('hello')).toBe(5);
    expect(characterCount('')).toBe(0);
  });

  test('counts an astral emoji as one code point, not its two UTF-16 units', () => {
    // 👍 U+1F44D is a single code point stored as a surrogate PAIR.
    expect('\u{1F44D}'.length).toBe(2); // guards the premise: code units disagree
    expect(characterCount('\u{1F44D}')).toBe(1);
  });

  test('counts a ZWJ family as each of its code points, not one grapheme', () => {
    // 👨‍👩‍👧‍👦 is four people joined by three ZWJs: 7 code points, one grapheme.
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
    expect(characterCount(family)).toBe(7);
  });

  test('tolerates null or undefined as an empty string', () => {
    expect(characterCount(null)).toBe(0);
    expect(characterCount(undefined)).toBe(0);
  });
});

test('the constants have their declared values', () => {
  expect(MAX_CHAT_CHARS).toBe(500);
  expect(CHAT_CHARS_WARNING).toBe(50);
});
