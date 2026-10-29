// Articles import Note, Pill, Chip and Tag from the public kit; a local copy
// drifts from it silently. The published weeks 3 to 8 already carry theirs and
// are frozen, so the guard starts at week 9.
const KIT_NAMES = ['Note', 'Pill', 'Chip', 'Tag'];
const FIRST_GUARDED_WEEK = 9;

/**
 * Reports top-level declarations of a kit name in one article's source.
 * Returns `[{ name, line }]`; an empty array means the file is clean. A file
 * whose name carries no week number is not a weekly report and is left alone.
 */
export function findLocalKitDeclarations(fileName, source) {
  const week = Number(/^week(\d+)-/.exec(fileName)?.[1]);
  if (!(week >= FIRST_GUARDED_WEEK)) return [];

  const declaration = new RegExp(`^const (${KIT_NAMES.join('|')})\\s*=`);
  const found = [];
  String(source).split('\n').forEach((line, i) => {
    const match = declaration.exec(line);
    if (match) found.push({ name: match[1], line: i + 1 });
  });
  return found;
}
