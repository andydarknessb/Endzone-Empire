/**
 * Public surface of the Waiver Claim entity (ADR 0029, ADR 0049). The Waivers
 * page slices read a manager's claims from HERE and never from the raw
 * `GET /api/waivers` response; the entity imports no feature, widget, page or
 * other entity.
 *
 * BELOW-ISLAND EDGES (ADR 0029, #874): the hook imports `shared/lib`'s
 * `useEndpoint` and, for the Claim-order reorder write and its refusal text,
 * `api/apiClient` and `lib/httpFailure`; the model imports nothing at all.
 */
export { claimsFromResponse } from './model/claimsModel';
export { useWaiverClaims } from './model/useWaiverClaims';
export { submitClaim, editClaim, cancelClaim, moveClaim } from './model/claimWrites';
