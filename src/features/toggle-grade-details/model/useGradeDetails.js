import { useCallback, useState } from 'react';

/**
 * toggle-grade-details feature's model (#1104): whether Draft Grades' second
 * (steal/reach) line is showing on every row right now. Page-local state,
 * deliberately not persisted (contrast toggle-matchup-view, which remembers
 * its choice per viewer in localStorage) - every mount starts collapsed,
 * showing the line on the viewer's own row only, and a manager re-opens it
 * each visit. No caller needs a different starting state, so this takes no
 * parameter rather than carry one nothing passes.
 *
 * @returns {[boolean, () => void]} `[expanded, toggle]`.
 */
export function useGradeDetails() {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return [expanded, toggle];
}

export default useGradeDetails;
