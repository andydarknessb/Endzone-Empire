// Articles import Note, Pill, Chip and Tag from the public kit; a local copy
// drifts from it silently. The published weeks 3 to 8 already carry theirs and
// are frozen, so the kit names are guarded from week 9.
const KIT_NAMES = ['Note', 'Pill', 'Chip', 'Tag'];
// The layout components the weekly reports share from darkness-report-parts.jsx.
// They moved out of week 9, the last published week, so they are guarded from week 10.
export const SHARED_PART_NAMES = [
  'Flag', 'SplitBar', 'CallList', 'GameCard', 'SlateBoard', 'JumpGrid',
  'InjuryGroup', 'TierBoard', 'RulingCard', 'RailList', 'WindowChecklist',
  'BidTrack', 'PriorityCard', 'FaabLadder', 'OpponentChart',
];
const GUARDS = [
  { names: KIT_NAMES, fromWeek: 9 },
  { names: SHARED_PART_NAMES, fromWeek: 10 },
];

/**
 * Reports top-level declarations of a guarded name in one article's source.
 * Returns `[{ name, line }]`; an empty array means the file is clean. A file
 * whose name carries no week number is not a weekly report and is left alone.
 */
export function findLocalDeclarations(fileName, source) {
  const week = Number(/^week(\d+)-/.exec(fileName)?.[1]);
  const names = GUARDS.filter((guard) => week >= guard.fromWeek).flatMap((guard) => guard.names);
  if (!names.length) return [];

  const declaration = new RegExp(`^(?:export )?(?:const|function) (${names.join('|')})\\b`);
  const found = [];
  String(source).split('\n').forEach((line, i) => {
    const match = declaration.exec(line);
    if (match) found.push({ name: match[1], line: i + 1 });
  });
  return found;
}
