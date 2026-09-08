/**
 * The Draft room's available-player pool sort fields - the set the desktop
 * PlayerPoolTable's TableSortLabel headers and its mobile "Sort by" Select both
 * present. This is the Draft room's list, NOT the app's canonical sort set:
 * PlayerManagement.jsx holds its own second, independent list of the same
 * fields over the same endpoint (a follow-up to reconcile, not this module's
 * job).
 *
 * Each entry answers every fact a caller needs about a sort field, so no Draft
 * room caller has to keep a hand-maintained copy that can silently drift from
 * this list (issue #951) - the desktop headers, the mobile Select, the fetch
 * site, and the Column guide all read these facts. The one known copy that does
 * NOT read from here is PlayerManagement.jsx's own list (see below); reconciling
 * it is a follow-up, not this module's job. Each entry carries:
 *   key          - the internal/URL key (what usePlayerPool validates `?sort=`
 *                  against and what onSort is called with)
 *   label        - the visible header/option text
 *   numeric      - right-aligned, tabular numeric column: drives the header's
 *                  alignment and its label:definition accessible name (was a
 *                  hand-maintained right-aligned-keys set in PlayerPoolTable.jsx)
 *   wire         - the server `?sort=` field name (was a ternary at the fetch
 *                  site in usePlayerPool.js); pinned against the server's own
 *                  ACCEPTED_SORT_FIELDS in sortFields.test.js
 *   desktopColumn- whether the field appears as its own desktop table column.
 *                  nfl_team is false EXPLICITLY (it rides inline in the Name
 *                  cell rather than getting a column) rather than being silently
 *                  absent (ruling Q14).
 *
 * usePlayerPool.js validates a `?sort=` URL value against SORT_KEYS before
 * trusting it (a bogus or legacy value falls back to the hook's own default
 * rather than being mirrored back into the URL and sent to the API verbatim),
 * and PlayerPoolTable.jsx's mobile "Sort by" Select renders SORT_FIELDS - so by
 * the time the Select ever sees a `sort` value, it is already guaranteed valid
 * and doesn't need its own separate fallback.
 */
export const SORT_FIELDS = [
  { key: 'name', label: 'Name', numeric: false, wire: 'name', desktopColumn: true },
  { key: 'nfl_team', label: 'NFL Team', numeric: false, wire: 'nfl_team', desktopColumn: false },
  { key: 'bye_week', label: 'Bye', numeric: true, wire: 'bye_week', desktopColumn: true },
  { key: 'adp', label: 'ADP', numeric: true, wire: 'adp', desktopColumn: true },
  { key: 'position_rank', label: 'Pos rank', numeric: true, wire: 'position_rank', desktopColumn: true },
  { key: 'proj', label: '17-game pace', numeric: true, wire: 'projected_points', desktopColumn: true },
];

export const SORT_KEYS = SORT_FIELDS.map((field) => field.key);

/** Keyed lookup onto SORT_FIELDS. The desktop header row places each column by
 * key rather than by SORT_FIELDS' array position (issue #163), so this is how a
 * caller reaches a single field's facts without re-deriving the map itself.
 *
 * Backed by a null-prototype object rather than Object.fromEntries: a plain
 * object inherits Object.prototype, so a lookup on an inherited key ('toString',
 * 'constructor', ...) would be truthy and defeat any `|| default` guard reading
 * from it (formal review F2). With no prototype, only real keys are truthy. */
export const SORT_FIELDS_BY_KEY = SORT_FIELDS.reduce((acc, field) => {
  acc[field.key] = field;
  return acc;
}, Object.create(null));

/** The FULL desktop column sequence, in the fixed left-to-right order the table
 * renders them: sortable columns and the two non-sortable ones (Position and
 * Actions) alike. This is its OWN ordered list, not SORT_FIELDS' array order
 * filtered by desktopColumn: SORT_FIELDS' order only has to stay meaningful for
 * the mobile "Sort by" Select and must be free to change for that reason
 * without moving desktop columns (issue #163).
 *
 * It is one list rather than a sortable list plus per-column special cases
 * because the header used to render Position as a SIDE EFFECT of hitting the
 * 'name' key (`{key === 'name' && <TableCell>Position</TableCell>}`), so
 * Position's column index was pinned to name's rather than to its own, and the
 * header suite (which only asserted the order of the SORTABLE buttons) stayed
 * green while Position slid away from the body's Position cell (issue #1003).
 * Every entry here is either:
 *   { sortKey }            - a sortable column; sortKey is a real SORT_FIELDS
 *                            key whose entry has desktopColumn: true
 *   { label, align? }      - a non-sortable column, rendered as plain header
 *                            text at that index
 * sortFields.test.js pins that the sortKey entries and the desktopColumn flag
 * agree in both directions. */
export const DESKTOP_COLUMNS = [
  { sortKey: 'name' },
  { label: 'Position' },
  { sortKey: 'bye_week' },
  { sortKey: 'adp' },
  { sortKey: 'position_rank' },
  { sortKey: 'proj' },
  { label: 'Actions', align: 'center' },
];

/** How many desktop columns the table renders - the colSpan any full-width row
 * (the empty state, the loading-more spinner) must use. Derived here rather
 * than written as a literal at each of those rows, which is how two
 * `colSpan={7}` literals came to sit next to a header row nobody had counted
 * (issue #1003). */
export const DESKTOP_COLUMN_COUNT = DESKTOP_COLUMNS.length;

/** The desktop SORTABLE columns' keys, in that same order. Derived from
 * DESKTOP_COLUMNS so the sortable order and the full column sequence cannot
 * disagree: there is one place to reorder a desktop column, and moving one
 * there moves its header. */
export const DESKTOP_SORT_COLUMN_KEYS = DESKTOP_COLUMNS
  .filter((column) => column.sortKey)
  .map((column) => column.sortKey);

/** The server `?sort=` field name for a pool sort key. Total by construction:
 * an unknown key returns the default sort's wire name rather than throwing, so
 * the fetch site (usePlayerPool.js) can never throw inside its own empty-catch
 * try and leave the pool silently empty (issue #951 / the review's error-mode
 * note). In practice `sort` is already validated to a real key upstream; this
 * totality is the guard for the case that validation is ever bypassed.
 *
 * Total, but no longer SILENT (issue #1002). Every caller into this function
 * holds a key; a value that isn't one is a caller bug, and the fallback was
 * indistinguishable from a genuine ADP sort - `wireSortName('projected_points')`
 * (a WIRE name handed in where a key belongs, the exact confusion #1002
 * reconciled the Player Browser out of) returned 'adp' and the page quietly
 * sorted by something the caller never asked for. The warn names the offending
 * value so that shows up as a bug instead of as a preference. It is noisy only
 * where it is a bug: a valid key never reaches it. */
export function wireSortName(key) {
  const field = SORT_FIELDS_BY_KEY[key];
  if (!field) {
    // eslint-disable-next-line no-console
    console.warn(
      `wireSortName: unknown pool sort key ${JSON.stringify(key)}; falling back to the default sort. Callers must pass a SORT_FIELDS key, not a wire name.`,
    );
    return SORT_FIELDS_BY_KEY.adp.wire;
  }
  return field.wire;
}
