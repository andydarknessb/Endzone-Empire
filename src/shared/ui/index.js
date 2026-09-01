/**
 * Public surface of the `shared/ui` kit (ADR 0020): the League Dashboard's
 * shared presentation layer. Widgets and features compose these and import
 * them ONLY from this index, never from the component files directly. This is
 * the bottom of the FSD island and depends on nothing above it.
 */
export { default as Card } from './Card';
export { default as Badge } from './Badge';
export { default as GradeChip } from './GradeChip';
export { default as Skeleton } from './Skeleton';
