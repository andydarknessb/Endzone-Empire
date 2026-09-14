/**
 * Public surface of the `toggle-grade-details` feature (#1104): the
 * Show/Hide steals-and-reaches control for the Draft Grades widget and the
 * hook that owns whether it is open.
 *
 *   - `ToggleGradeDetails` (default): the text MUI Button, wired with
 *     `aria-expanded`/`aria-controls`, dash-token colors and the 44px mobile
 *     touch floor.
 *   - `useGradeDetails()`: `[expanded, toggle]`, page-local state only -
 *     never persisted, always starts collapsed.
 *
 * Import edges: `@mui/material` and `shared/lib` (`MIN_TOUCH_TARGET_SX`,
 * promoted #1272) only. The widget composes both from this index, never
 * from a file inside.
 */
export { default, default as ToggleGradeDetails } from './ui/ToggleGradeDetails';
export { useGradeDetails } from './model/useGradeDetails';
