/**
 * Public surface of the commissioner-panel widget (League Dashboard,
 * ADR 0020 / ticket #644). The page composes it from here - and decides which
 * slot it goes in, since the panel sits in the rail at md and up and above the
 * standings below md; everything else in this folder is the widget's own
 * internal slice.
 */
export { default } from './ui/CommissionerPanel';
