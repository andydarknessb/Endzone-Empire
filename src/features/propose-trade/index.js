/**
 * Public surface of the propose-trade feature (#1310, ADR 0040). The Players
 * list (`src/widgets/player-row`) imports from HERE only.
 *
 * BELOW-ISLAND EDGES (ADR 0031's amendment): `lib/a11y` (`MIN_TOUCH_TARGET_SX`,
 * `ui/ProposeTradeAction.jsx`), the same touch-target constant edge
 * `add-player` and `claim-player` already name for the identical reason.
 */
export { proposeTradeHref } from './model/proposeTradeLink';
export { default as ProposeTradeAction } from './ui/ProposeTradeAction';
