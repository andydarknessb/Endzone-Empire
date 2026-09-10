/**
 * Public surface of the commissioner-strip widget (League Dashboard,
 * ADR 0020 / ticket #1108). The page composes it from here in the
 * page-composition ticket, which also deletes `widgets/commissioner-panel`;
 * everything else in this folder is the widget's own internal slice.
 */
export { default } from './ui/CommissionerStrip';
