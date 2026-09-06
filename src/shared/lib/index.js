/**
 * Public surface of the `shared/lib` kit (ADR 0020, amendment #669): the League
 * Dashboard's shared non-presentational layer. Widgets import from this index,
 * never from the module files directly. This is a bottom layer of the FSD
 * island, a sibling of `shared/ui`, and depends on nothing above it.
 */
export { useEndpoint } from './useEndpoint';
export { subscribeToScoreFeed } from './scoreFeed';
