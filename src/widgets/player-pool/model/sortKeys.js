import { SORT_FIELDS } from "../../../components/DraftBoard/sortFields";

// The Player Browser's sort options, derived from the Draft room's
// sortFields.js entries rather than from a second hand-maintained list of the
// same fields over the same endpoint (issue #1002). The sort STATE holds
// sortFields KEYS; the server's `?sort=` name is produced once, at the fetch
// site, by wireSortName.
//
// The visible option text is the one fact NOT taken from sortFields.js: the
// Player Browser's copy for three of these fields is its own. The overrides are
// keyed by the Draft room's label rather than by a sort key.
const OPTION_LABEL_OVERRIDES = {
  "Pos rank": "Position rank",
  Bye: "Bye week",
  "17-game pace": "Pool projection",
};

export const SORT_OPTIONS = SORT_FIELDS.map((field) => ({
  key: field.key,
  label: OPTION_LABEL_OVERRIDES[field.label] || field.label,
}));

// The absolute fallback sort - used whenever no league is selected (or the
// league is best ball, where Upgrade is never a real ranking) and whenever an
// unrecognized, non-empty `?sort=` value reaches sortKeyFromParam.
export const DEFAULT_SORT_KEY = "adp";

const PAGE_SORT_KEYS = new Set([...SORT_FIELDS.map((field) => field.key), "upgrade"]);

// The `?sort=` URL param, resolved to a sortFields KEY (or "upgrade", the one
// page-local sort key that isn't a sortFields.js entry). Returns null when the
// param is absent, so the caller can fall back to its CONTEXTUAL default.
//
// The param carried WIRE names before #1002, so a wire name is still accepted
// on READ and mapped back to its key; only keys are ever WRITTEN into the URL.
export function sortKeyFromParam(value) {
  if (!value) return null;
  if (PAGE_SORT_KEYS.has(value)) return value;
  const legacy = SORT_FIELDS.find((field) => field.wire === value);
  return legacy ? legacy.key : DEFAULT_SORT_KEY;
}
