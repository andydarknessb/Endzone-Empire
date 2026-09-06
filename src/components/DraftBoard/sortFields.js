/**
 * The Draft room's available-player pool sort fields - the set the desktop
 * PlayerPoolTable's TableSortLabel headers and its mobile "Sort by" Select both
 * present. This is the Draft room's list, NOT the app's canonical sort set:
 * PlayerManagement.jsx holds its own second, independent list of the same
 * fields over the same endpoint (a follow-up to reconcile, not this module's
 * job).
 *
 * Each entry answers every fact a caller needs about a sort field, so none of
 * them leak into a hand-maintained copy somewhere else (issue #951):
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
 * caller reaches a single field's facts without re-deriving the map itself. */
export const SORT_FIELDS_BY_KEY = Object.fromEntries(SORT_FIELDS.map((field) => [field.key, field]));

/** The desktop sortable columns, in the fixed left-to-right order the table
 * renders them (Position and Actions are the two non-sortable columns and are
 * not sort fields, so they aren't here). This is its OWN ordered list, not
 * SORT_FIELDS' array order filtered by desktopColumn: SORT_FIELDS' order only
 * has to stay meaningful for the mobile "Sort by" Select and must be free to
 * change for that reason without moving desktop columns (issue #163). Every key
 * here is a real SORT_FIELDS key whose entry has desktopColumn: true, and every
 * desktopColumn entry appears here - sortFields.test.js pins both directions. */
export const DESKTOP_SORT_COLUMN_KEYS = ['name', 'bye_week', 'adp', 'position_rank', 'proj'];

/** The server `?sort=` field name for a pool sort key. Total by construction:
 * an unknown key returns the default sort's wire name rather than throwing, so
 * the fetch site (usePlayerPool.js) can never throw inside its own empty-catch
 * try and leave the pool silently empty (issue #951 / the review's error-mode
 * note). In practice `sort` is already validated to a real key upstream; this
 * totality is the guard for the case that validation is ever bypassed. */
export function wireSortName(key) {
  return (SORT_FIELDS_BY_KEY[key] || SORT_FIELDS_BY_KEY.adp).wire;
}
