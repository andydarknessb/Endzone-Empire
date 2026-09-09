/**
 * Public surface of the `toggle-grade-details` feature (#1104): the
 * Show/Hide steals-and-reaches control for the Draft Grades widget and the
 * hook that owns whether it is open.
 *
 *   - `ToggleGradeDetails` (default): the text MUI Button, wired with
 *     `aria-expanded`/`aria-controls`.
 *   - `useGradeDetails(defaultExpanded?)`: `[expanded, toggle]`, page-local
 *     state only - never persisted.
 *
 * Import edges: `@mui/material` only. The widget composes both from this
 * index, never from a file inside.
 */
export { default, default as ToggleGradeDetails } from './ui/ToggleGradeDetails';
export { useGradeDetails } from './model/useGradeDetails';
