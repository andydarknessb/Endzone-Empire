// Home-only Play-select pieces: the score and pick'em tiles, the league panel and links,
// and the numbers help. The generic primitives live in src/shared/ui/playselect
// (DESIGN.md "Play-select: Home and league pages") and read only `var(--ps-*)` tokens;
// the Home page root carries `className="ps-root"` so playselect.css applies.
export { ScoreTile, PickemTile } from './Tiles';
export { LeaguePanel, LeagueLinks } from './League';
export { NumbersHelp } from './NumbersHelp';
