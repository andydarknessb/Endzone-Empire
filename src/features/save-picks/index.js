/**
 * Public surface of the `save-picks` feature (#1265, ADR 0038): local draft
 * state over the server's own picks, dirty tracking, the PUT itself, and the
 * flagged gameKeys a rejected save names. The widget composes it from here
 * only, never from the model file directly.
 */
export { default, useSavePicks } from './model/useSavePicks';
