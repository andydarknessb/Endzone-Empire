/**
 * Public surface of the propose-trade feature (#1310, ADR 0040):
 * `proposeTradeHref`, the pure TradeCenter deep-link builder. PlayerManagement
 * builds the row's Trade action from it directly (`actionForPlayer`,
 * rendered by `widgets/player-row`'s generic `ActionControl`) - there is no
 * feature-owned button component here (formal review formal-1310-f5: an
 * earlier `ProposeTradeAction` UI component had no consumer anywhere in the
 * app and was Speculative Generality; deleted rather than kept "for later").
 */
export { proposeTradeHref } from './model/proposeTradeLink';
