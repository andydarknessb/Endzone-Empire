/**
 * Public surface of the Player entity (ADR 0029: the FSD island's entities
 * layer; #1307, ADR 0040 slice 5). The Decision card reads the availability-
 * context payload from HERE and never from an internal path.
 *
 * BELOW-ISLAND EDGES (ADR 0029's audit surface). `usePlayerCard` imports
 * `shared/lib`'s `useEndpoint`, the same plain-read plumbing `entities/line`
 * and `entities/player-usage` already use (#669); the model imports nothing
 * else. The UI pieces import `shared/ui` (`statLine`) and `shared/lib`
 * (`formatPoints`) only - never a feature, a widget, a page, or another
 * entity.
 */
export { playerCardFromResponse } from './model/playerCardModel';
export { usePlayerCard } from './model/usePlayerCard';
export { default as DecisionStrip } from './ui/DecisionStrip';
export { default as WeeklyPointsBars } from './ui/WeeklyPointsBars';
export { default as GameLogTable } from './ui/GameLogTable';
export { default as NewsList } from './ui/NewsList';
export { default as Bio } from './ui/Bio';
