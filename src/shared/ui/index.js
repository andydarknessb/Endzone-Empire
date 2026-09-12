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
// The Floor-to-Ceiling band with a mean tick (#1238, ADR 0037 AC1): composed
// by the Start/sit advice panel, one bar per sit/start player.
export { default as RangeBar } from './RangeBar';
export { default as PosChip } from './PosChip';
export { default as SegmentedControl } from './SegmentedControl';
// The injury designation tag (ADR 0031, #903): composed by the slot-comparison
// starter cell, the retro-scoreboard Lineups card and the Matchup page's Bench
// card, so it sits here where all three can reach it.
export { default as InjuryTag, injuryView } from './InjuryTag';
// The Tecmo pixel sprites (ADR 0031, #903): composed by the retro-scoreboard
// widget's field and the celebrate-touchdown feature's cutscene, so they sit
// here where both can reach them. `SPRITE_FIXED` is the kit-free palette the
// field's resting kit reads its gold and white from.
export { Sprite, RefereeSprite, GoalPostSprite, FIXED as SPRITE_FIXED } from './TecmoSprite';
// A team's avatar/initials fallback (#1146, ADR 0031's component amendment):
// reached seven island widget consumers, past the second-island-consumer
// threshold, and moved here as the one canonical implementation island and
// legacy `src/components` consumers both import.
export { default as TeamAvatar } from './TeamAvatar';
// The dashboard button treatment (#1166, ADR 0031's #1146 amendment): the one
// canonical `.btn` / `.btn.primary` / `.btn.ghost` implementation the five
// island sites that used to each define their own copy now compose.
export { default as DashButton } from './DashButton';
// An abbreviation/stat term with its definition on hover/focus (#1246, ADR
// 0031's #1146 amendment): reached its second island consumer (League
// History, alongside the Draft Grades widget) and moved here as the one
// canonical implementation. `STAT_DEFINITIONS` and `ABBREVIATION_STYLE` stay
// exported only from the concrete module - no island consumer needs them
// through the barrel yet.
export { default as AbbreviationTooltip } from './AbbreviationTooltip';
// A player's Game cell state (#1237, ADR 0037): pre-kickoff, live, final or
// bye, on the kit's Badge. Composed by the Lineup page's lineup-ledger widget.
export { default as GameStateChip } from './GameStateChip';
// PositionChip, PlayerAvatar, InjuryBadge and statLine (#1304, ADR 0031/0040
// slice 1): the full-profile / quick-view player kit, moved here from
// `src/components/PlayerQuickView` and `src/components/InjuryBadge` alongside
// TeamAvatar's own #1146 move. Only the two island widget consumers
// (retro-scoreboard's LineupsCard, slot-comparison's SlotComparison) import
// PlayerAvatar from this index; legacy `src/components` importers take the
// concrete module paths instead, for the same bundle/harness-guard reason
// TeamAvatar's legacy consumers do.
export { default as PositionChip, positionColorSx } from './PositionChip';
export { default as PlayerAvatar } from './PlayerAvatar';
export { default as InjuryBadge } from './InjuryBadge';
export { statLine } from './statLine';
