/**
 * Public surface of the Waiver Claim entity (ADR 0029, ADR 0049). The Waivers
 * page slices read a manager's claims from HERE and never from the raw
 * `GET /api/waivers` response; the entity imports no feature, widget, page or
 * other entity.
 *
 * BELOW-ISLAND EDGES: the hook imports `shared/lib`'s `useEndpoint`; the model
 * imports nothing at all.
 */
export { claimsFromResponse } from './model/claimsModel';
export { useWaiverClaims } from './model/useWaiverClaims';
