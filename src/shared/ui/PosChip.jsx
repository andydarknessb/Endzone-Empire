/**
 * The position palette's key and display label for a slot or position label.
 * The Play-select PosTag (`shared/ui/playselect/Marks`) and the bye cluster
 * read these; the legacy chip that painted them is gone (the Square Rule,
 * spec #2633). The palette keys are `pos-*` in tokens.js; FLEX and any IDP slot
 * map onto it too, so a lineup's slot column reads in one vocabulary.
 */
const PALETTE = {
  QB: 'qb',
  RB: 'rb',
  WR: 'wr',
  TE: 'te',
  K: 'k',
  DEF: 'def',
  'D/ST': 'def',
  DST: 'def',
  FLEX: 'flex',
  SUPERFLEX: 'flex',
  'W/R/T': 'flex',
  'W/R': 'flex',
  'R/W/T': 'flex',
};
const IDP = new Set(['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S', 'IDP', 'IDP FLEX', 'D LINE']);

/** The palette key for a slot or position label (unknown labels read as flex). */
export function positionKey(label) {
  const upper = String(label || '').toUpperCase();
  if (PALETTE[upper]) return PALETTE[upper];
  if (IDP.has(upper)) return 'idp';
  return 'flex';
}

/** DEF is stored/scored as the "DEF" slot but reads as D/ST everywhere it's displayed. */
export function positionLabel(label) {
  return String(label || '').toUpperCase() === 'DEF' ? 'D/ST' : label;
}
