import { useCallback, useState } from 'react';

/**
 * toggle-grade-details feature's model (#1104): whether Draft Grades' second
 * (steal/reach) line is showing on every row right now. Page-local state,
 * deliberately not persisted (contrast toggle-matchup-view, which remembers
 * its choice per viewer in localStorage) - the widget starts every mount
 * collapsed, showing the line on the viewer's own row only, and a manager
 * re-opens it each visit.
 *
 * @param {boolean} [defaultExpanded] starting state, collapsed unless given.
 * @returns {[boolean, () => void]} `[expanded, toggle]`.
 */
export function useGradeDetails(defaultExpanded = false) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  return [expanded, toggle];
}

export default useGradeDetails;
