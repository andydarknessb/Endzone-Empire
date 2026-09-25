/**
 * Public surface of the waiver-claims widget (#1614, ADR 0048, ADR 0049): a
 * manager's pending claims in Claim order (with the #1579 reorder) and their
 * Results by week. The Waivers page imports from HERE only.
 *
 * Presentational over the `waiver-claim` entity's read model, which the page
 * owns (one read serves the strip, the row buttons and this widget); imports
 * nothing but `@mui/material`, `shared/lib` and its own ui.
 */
export { default } from './ui/WaiverClaims';
