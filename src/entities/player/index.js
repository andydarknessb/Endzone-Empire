/**
 * Public surface of the Player entity (ADR 0029: the FSD island's entities
 * layer; #1307, ADR 0040 slice 5). The Decision card reads the availability-
 * context payload from HERE and never from an internal path.
 *
 * BELOW-ISLAND EDGES (ADR 0029's audit surface). `usePlayerCard` imports
 * `shared/lib`'s `useEndpoint`, the same plain-read plumbing every League
 * Dashboard widget uses (#669); the models import nothing. The Decision card's
 * Line, Weather, Usage and Opponent-rank readers live here because the card's
 * one read carries them all (#1667). The UI pieces import `shared/ui` (`statLine`) and `shared/lib`
 * (`formatPoints`) only - never a feature, a widget, a page, or another
 * entity.
 */
export { playerCardFromResponse, playerCardUrl } from './model/playerCardModel';
export { usePlayerCard } from './model/usePlayerCard';
export { lineContextFromResponse } from './model/lineModel';
export { usageFromResponse, opponentsFromResponse } from './model/usageModel';
export { toDecisionCardEntry } from './model/decisionCardEntry';
export { default as DecisionStrip } from './ui/DecisionStrip';
export { default as WeeklyPointsBars } from './ui/WeeklyPointsBars';
export { default as GameLogTable } from './ui/GameLogTable';
export { default as NewsList } from './ui/NewsList';
export { default as Bio } from './ui/Bio';
export { default as PlayerNameLink } from './ui/PlayerNameLink';
