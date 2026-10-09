/**
 * Public surface of the slot-comparison widget (the Starters table of Matchup
 * Detail, ADR 0031 / ticket #899). The page composes it from here; everything
 * else in this folder is the widget's own internal slice. It takes the paired
 * starter rows the Matchup page model hands down and calls back to open a
 * player and to expand a row.
 *
 * An Unavailable player's label is `entities/roster`'s `unavailableLabel`, read
 * by this widget and the Matchup page's bench card alike (#2140). The injury
 * designation beside a name is the kit's InjuryTag (`shared/ui`), the same piece the bench card and the
 * retro Lineups card compose.
 */
export { default as SlotComparison } from './ui/SlotComparison';
export { default } from './ui/SlotComparison';
