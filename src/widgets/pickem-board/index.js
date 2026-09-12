/**
 * Public surface of the pickem-board widget (#1265, ADR 0038). The page
 * composes it from here only, never from the component files directly.
 *
 * Below-island edge (ADR 0031's 2026-09-11 #1269 amendment: "every
 * below-island edge is named with its reason in the slice's index
 * docblock"), in `./model/useBoardPresenter.js`:
 *
 *   - `src/hooks/useLeague` - the shared, cached league resource (ADR 0004)
 *     every island widget composing it already reads directly
 *     (matchup-preview's own precedent); this widget reads only its team
 *     count (CONTEXT.md's Team: "Teams rows ARE league membership") for the
 *     "N of M managers have picked" line, never any League domain logic of
 *     its own, so the edge is plumbing (a cached GET) rather than a domain
 *     concept reached below the island.
 */
export { default } from './ui/PickemBoard';
