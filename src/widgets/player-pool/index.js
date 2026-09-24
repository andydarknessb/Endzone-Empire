/**
 * Public surface of the player-pool widget (#1610, ADR 0049). The Players page
 * imports from HERE only; the Waivers page will lock it to on waivers.
 *
 * Imports: `widgets/player-row` through its own index, and `shared`. It reaches
 * no entity or feature: the row action, the Watch action and the Decision card
 * context are built by the caller and passed in.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment: every below-island edge is named with
 * its reason in the slice's index docblock), all reached by `ui/PlayerPool.jsx`
 * and `model/sortKeys.js`:
 *   - `api/apiClient`: the app's plain HTTP client, for the one `/api/players`
 *     read.
 *   - `lib/httpFailure`: the shared refusal-envelope reader.
 *   - `hooks/useLeague`: the selected league's roster template, which decides
 *     the position chips (#1419).
 *   - `components/DraftBoard/sortFields`: the sort vocabulary the Draft room
 *     shares with this list (#1002), so no sort field's wire name is spelled
 *     twice.
 */
export { default as PlayerPool } from './ui/PlayerPool';
export { default } from './ui/PlayerPool';
