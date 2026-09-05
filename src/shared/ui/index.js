/**
 * Public surface of the `shared/ui` kit (ADR 0020): the League Dashboard's
 * shared presentation layer. Widgets and features compose these and import
 * them ONLY from this index, never from the component files directly. This is
 * the bottom of the FSD island and depends on nothing above it.
 */
export { default as Card } from './Card';
export { default as Badge } from './Badge';
export { default as GradeChip } from './GradeChip';
export { default as Skeleton } from './Skeleton';
// Game Center / Matchup Detail pieces (ADR 0031, #891).
export { default as StatTile } from './StatTile';
export { default as SplitBar } from './SplitBar';
export { default as PosChip } from './PosChip';
export { default as SegmentedControl } from './SegmentedControl';
// The Tecmo pixel sprites (ADR 0031, #903): composed by the retro-scoreboard
// widget's field and the celebrate-touchdown feature's cutscene, so they sit
// here where both can reach them. `SPRITE_FIXED` is the kit-free palette the
// field's resting kit reads its gold and white from.
export { Sprite, RefereeSprite, GoalPostSprite, FIXED as SPRITE_FIXED } from './TecmoSprite';
