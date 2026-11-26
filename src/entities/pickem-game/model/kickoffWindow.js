/**
 * Kickoff window grouping (ADR 0038's "What to build"; CONTEXT.md's Kickoff
 * window): a pure function grouping a week's games into the windows the
 * board shows, in order. Windows are computed from the league's own
 * scheduling clock (US Eastern, the zone every NFL broadcast slot is set in)
 * rather than the viewer's runtime zone, so two managers in different zones
 * group the same slate the same way - ADR 0038: "kickoff-window labels are
 * zone-independent".
 */

const SCHEDULE_ZONE = 'America/New_York';

// shortcut: fixed week order puts a game postponed to the Wednesday after Monday night first, sort groups by earliest kickoff if the NFL moves one.
export const KICKOFF_WINDOWS = [
  'wednesday',
  'thursday-night',
  'friday',
  'saturday',
  'sunday-early',
  'sunday-late',
  'sunday-night',
  'monday-night',
  'tuesday',
];

const DAY_WINDOWS = { Tue: 'tuesday', Wed: 'wednesday', Fri: 'friday', Sat: 'saturday' };

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_ZONE, weekday: 'short' });
const HOUR_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: SCHEDULE_ZONE, hour: 'numeric', hour12: false });

/**
 * One of `KICKOFF_WINDOWS`, or null only when the kickoff is missing or
 * unparseable. The five broadcast windows are named by slot; any other day
 * groups under its own day (`DAY_WINDOWS`). The classification reads the
 * kickoff instant through the `America/New_York` zone explicitly, so it is
 * the same regardless of the caller's own runtime zone.
 */
export function kickoffWindowFor(kickoffAt) {
  if (kickoffAt == null || kickoffAt === '') return null;
  const date = kickoffAt instanceof Date ? kickoffAt : new Date(kickoffAt);
  if (Number.isNaN(date.getTime())) return null;

  const weekday = WEEKDAY_FORMAT.format(date);
  if (weekday === 'Thu') return 'thursday-night';
  if (weekday === 'Mon') return 'monday-night';
  if (weekday !== 'Sun') return DAY_WINDOWS[weekday] ?? null;

  const hour = Number(HOUR_FORMAT.format(date));
  if (hour < 16) return 'sunday-early';
  if (hour < 19) return 'sunday-late';
  return 'sunday-night';
}

/**
 * Groups `games` (any object carrying a `kickoff` or `kickoffAt` field) into
 * the windows, in week order, omitting a window with no games this week. A
 * game with no parseable kickoff is dropped rather than crashing the board.
 */
export function groupByKickoffWindow(games) {
  const buckets = new Map();
  for (const game of games || []) {
    const kickoff = game.kickoff ?? game.kickoffAt;
    const windowKey = kickoffWindowFor(kickoff);
    if (windowKey == null) continue;
    if (!buckets.has(windowKey)) buckets.set(windowKey, []);
    buckets.get(windowKey).push(game);
  }
  return KICKOFF_WINDOWS
    .filter((windowKey) => buckets.has(windowKey))
    .map((windowKey) => ({ window: windowKey, games: buckets.get(windowKey) }));
}
