/**
 * Public surface of the waiver-summary widget (#1613, ADR 0049). The Waivers
 * page imports from HERE only.
 *
 * Imports nothing but `@mui/material`, its own `lib` and, through the page,
 * plain props: the entity read model and the cards read's roster context are
 * built by the caller (ADR 0020: widgets do not import each other or an
 * entity they need not read).
 */
export { default } from './ui/WaiverSummary';
export { countdownText } from './lib/countdown';
