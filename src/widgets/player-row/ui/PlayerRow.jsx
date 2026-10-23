import PlayerRowPlayselect from './PlayerRowPlayselect';

/**
 * One Players list row (#1310, ADR 0040), in the Play-select look (ADR 0067): every availability
 * state renders through the SAME row, columns Player / Proj Wk / ROS / Ownership / Upgrade / Weeks /
 * Status / Action - `variant="row"` (default) for the desktop table, `variant="card"` for the
 * under-600px stacked layout. `action` is a plain data object the caller builds rather than this
 * widget importing add-player/claim-player/propose-trade itself. See `PlayerRowPlayselect`.
 */
export default PlayerRowPlayselect;
