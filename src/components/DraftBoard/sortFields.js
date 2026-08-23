/**
 * Canonical set of fields the available-player pool can be sorted by - the
 * same six the desktop table's TableSortLabel column headers expose. Shared
 * so validation and display never drift apart: usePlayerPool.js validates a
 * `?sort=` URL value against SORT_KEYS before trusting it (a bogus or
 * legacy value falls back to the hook's own default rather than being
 * mirrored back into the URL and sent to the API verbatim), and
 * PlayerPoolTable.jsx's mobile "Sort by" Select renders SORT_FIELDS - so by
 * the time the Select ever sees a `sort` value, it is already guaranteed
 * valid and doesn't need its own separate fallback.
 */
export const SORT_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'nfl_team', label: 'NFL Team' },
  { key: 'bye_week', label: 'Bye' },
  { key: 'adp', label: 'ADP' },
  { key: 'position_rank', label: 'Pos rank' },
  { key: 'proj', label: '17-game pace' },
];

export const SORT_KEYS = SORT_FIELDS.map((field) => field.key);
