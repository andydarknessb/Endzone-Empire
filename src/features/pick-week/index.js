/**
 * Public surface of the `pick-week` feature (ADR 0031, #896): the segmented
 * week stepper on Game Center. The page composes it from this index only,
 * never from the component file directly. The page keeps owning the week
 * state and its default; this slice only reports what the manager picked.
 */
export { default } from './ui/PickWeek';
export { default as PickWeek } from './ui/PickWeek';
