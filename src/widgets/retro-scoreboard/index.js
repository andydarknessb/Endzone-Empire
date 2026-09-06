/**
 * Public surface of the retro-scoreboard widget (ADR 0031, #902): the
 * Scoreboard view of a Matchup, composing an LED board, an SVG field, a
 * Lineups card and a Games tile, with two slots the page fills (`ticker`
 * full width under the field, `aside` in the right column). The Matchup page
 * composes it from here; everything else in this folder is the widget's own
 * internal slice.
 *
 * Import edges, for the boundary audit ADR 0020 names as its follow-up:
 * `shared/ui` (the kit, and since #903 the Tecmo pixel sprite and its fixed
 * palette, which the celebrate-touchdown feature composes too) and
 * `entities/matchup` through their index files, plus the sanctioned reaches
 * below the island: `src/lib/nflTeamColors` (the touchdown sprite kits and
 * the field green the kits are checked against), `src/lib/scoringEvents`
 * (the play label), `src/lib/initials` (the sprite and mobile end-zone
 * initials) and `src/components/PlayerQuickView/PlayerAvatar` (the
 * headshot). It imports no widget, feature or page.
 */
export { default as RetroScoreboard } from './ui/RetroScoreboard';
export { default } from './ui/RetroScoreboard';
