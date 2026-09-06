import {
  SORT_FIELDS,
  SORT_KEYS,
  SORT_FIELDS_BY_KEY,
  DESKTOP_SORT_COLUMN_KEYS,
  wireSortName,
} from './sortFields';
import { STAT_DEFINITIONS } from '../common/AbbreviationTooltip';
// The server owns the accepted `?sort=` set (issue #951). This is the house
// parity pattern (chatLimits.parity.test.js, stallAnnouncement.parity.test.js):
// react-scripts' webpack ModuleScopePlugin forbids production code under src/
// from importing server/, but jest has no such plugin, so a TEST can pin the
// two together. playerSort.js is pure (no requires), so importing it here drags
// no pg/express into the jsdom run. This is also what makes criterion 1 real
// rather than circular: the wire names are checked against what the server
// actually accepts, not a literal restated in this file.
import { ACCEPTED_SORT_FIELDS } from '../../../server/services/playerSort';

describe('SORT_FIELDS answers every fact about a sort field (issue #951)', () => {
  // Criterion 1 + 2: every entry's wire name is one the server accepts. Adding
  // a SORT_FIELDS entry whose `wire` the server does not accept (a typo, a
  // legacy name, a new field the server does not yet order by) turns this red -
  // that is the criterion 2 red-tell. Without it, a bad wire name falls through
  // the router to `orderBy = "id"` and the user gets a sort that silently does
  // nothing.
  test('every entry wire name is in the server accepted sort list', () => {
    SORT_FIELDS.forEach((field) => {
      expect(ACCEPTED_SORT_FIELDS).toContain(field.wire);
    });
  });

  // Criterion 1: every numeric entry has a matching accessible term. The numeric
  // desktop headers render their label:definition accessible name from
  // STAT_DEFINITIONS keyed BY LABEL (PlayerPoolTable.SortableHeaderCell); a
  // numeric field whose label has no STAT_DEFINITIONS entry renders a bare
  // abbreviation with no definition for a screen-reader user, silently (the old
  // issue #211 failure). This is the interface home for the coverage the
  // deleted source-scraping test used to approximate.
  test('every numeric entry has a STAT_DEFINITIONS accessible term', () => {
    const numeric = SORT_FIELDS.filter((field) => field.numeric);
    expect(numeric.length).toBeGreaterThan(0);
    numeric.forEach((field) => {
      expect(STAT_DEFINITIONS[field.label]).toBeTruthy();
    });
  });

  // Criterion 1: the exported desktop column order names only real keys (never a
  // typo or a dropped-then-renamed key that would render nothing).
  test('DESKTOP_SORT_COLUMN_KEYS names only real SORT_FIELDS keys', () => {
    expect(DESKTOP_SORT_COLUMN_KEYS.length).toBeGreaterThan(0);
    DESKTOP_SORT_COLUMN_KEYS.forEach((key) => {
      expect(SORT_KEYS).toContain(key);
    });
  });

  // The two column facts must agree: the ordered list and the per-entry flag are
  // two views of one truth, so neither can carry a column the other omits.
  test('DESKTOP_SORT_COLUMN_KEYS and the desktopColumn flag agree', () => {
    const flaggedKeys = SORT_FIELDS.filter((field) => field.desktopColumn).map((field) => field.key);
    expect(new Set(DESKTOP_SORT_COLUMN_KEYS)).toEqual(new Set(flaggedKeys));
    // No duplicates in the ordered list.
    expect(DESKTOP_SORT_COLUMN_KEYS).toHaveLength(new Set(DESKTOP_SORT_COLUMN_KEYS).size);
  });

  test('every entry declares all five facts', () => {
    SORT_FIELDS.forEach((field) => {
      expect(typeof field.key).toBe('string');
      expect(typeof field.label).toBe('string');
      expect(typeof field.numeric).toBe('boolean');
      expect(typeof field.wire).toBe('string');
      expect(typeof field.desktopColumn).toBe('boolean');
    });
  });

  // wireSortName is total: a real key returns its wire name, and an unknown key
  // returns a valid accepted wire name (the default sort's) rather than throwing
  // - so the fetch site's empty-catch try can never swallow a lookup crash into
  // a silently empty pool.
  test('wireSortName is total and always returns an accepted wire name', () => {
    SORT_FIELDS.forEach((field) => {
      expect(wireSortName(field.key)).toBe(field.wire);
    });
    expect(ACCEPTED_SORT_FIELDS).toContain(wireSortName('nonexistent-key'));
    expect(ACCEPTED_SORT_FIELDS).toContain(wireSortName(undefined));
  });

  test('SORT_FIELDS_BY_KEY maps each key to its own entry', () => {
    SORT_FIELDS.forEach((field) => {
      expect(SORT_FIELDS_BY_KEY[field.key]).toBe(field);
    });
  });
});
