/**
 * The Edge line's per-kind colour (CONTEXT.md's Edge line; ADR 0037; #1237
 * AC3: "renders each kind from ticket 3 with its own colour and icon"). The
 * six kinds `server/services/lineup.service.js`'s `computeEdgeLine` emits, in
 * its own priority order: `injury`, `bench-above-starter`, `factor`, `pace`,
 * `result`, `none`. `none` (and a null edge) carries no text and is never
 * rendered - the row shows nothing for it rather than an empty coloured
 * line. See `./EdgeLineIcon.jsx` for the matching per-kind icon.
 *
 * Colours are `dash-*` tokens already registered in tokens.contrast.test.js
 * on a card surface (the Ledger row's own background): `dash-warning` (the
 * injury designation, matching InjuryTag's warning tier), `dash-accent` (a
 * bench player outprojecting his slot's starter), `dash-ink` (the largest
 * projection Factor, and a final result - the text itself says beat or fell
 * short, so this does not re-encode that in colour), `dash-danger` (a game
 * in progress, matching the live Game-state chip). No new pairing is
 * introduced.
 */
export const EDGE_LINE_KINDS = ['injury', 'bench-above-starter', 'factor', 'pace', 'result'];

const COLOR_BY_KIND = {
  injury: 'var(--dash-warning)',
  'bench-above-starter': 'var(--dash-accent)',
  factor: 'var(--dash-ink)',
  pace: 'var(--dash-danger)',
  result: 'var(--dash-ink)',
};

/** The Edge line's colour token for `kind`, or `dash-faint` for an unknown kind. */
export function edgeLineColor(kind) {
  return COLOR_BY_KIND[kind] || 'var(--dash-faint)';
}
