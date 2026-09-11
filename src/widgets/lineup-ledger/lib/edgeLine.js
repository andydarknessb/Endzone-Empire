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
 * on a card surface (the Ledger row's own background), one per kind, per
 * AC3 (formal review finding ac3-edge-line-colour-collision: factor and
 * result must not share a colour, whatever the merit of the argument that
 * the text already disambiguates them - that is not this IC's criterion to
 * amend): `dash-warning` (the injury designation, matching InjuryTag's
 * warning tier), `dash-accent` (a bench player outprojecting his slot's
 * starter), `dash-home` (the largest projection Factor), `dash-danger` (a
 * game in progress, matching the live Game-state chip), `dash-away` (a
 * final result). No new pairing is introduced.
 */
export const EDGE_LINE_KINDS = ['injury', 'bench-above-starter', 'factor', 'pace', 'result'];

const COLOR_BY_KIND = {
  injury: 'var(--dash-warning)',
  'bench-above-starter': 'var(--dash-accent)',
  factor: 'var(--dash-home)',
  pace: 'var(--dash-danger)',
  result: 'var(--dash-away)',
};

/** The Edge line's colour token for `kind`, or `dash-faint` for an unknown kind. */
export function edgeLineColor(kind) {
  return COLOR_BY_KIND[kind] || 'var(--dash-faint)';
}
