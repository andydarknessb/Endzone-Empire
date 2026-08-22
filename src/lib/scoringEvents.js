// Pure logic that turns the typed touchdown `plays` on a scores:updated payload
// into what the live matchup UI should actually show: full-screen cutscenes for
// the viewer's own starters, lightweight toasts for the opponent, and a single
// summary toast when a sync drops more touchdowns at once than anyone wants to
// sit through. Kept free of React/DOM so the trigger rules are unit-testable.

// At most this many cutscenes play back-to-back; the rest collapse into one
// summary toast so a big sync window never becomes an unskippable reel.
export const MAX_CUTSCENES = 3;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Classify a batch of touchdown plays for the matchup currently on screen.
 *
 * @param {Array} plays        typed TD events from scores:updated (may be empty/undefined)
 * @param {object} opts
 * @param {Set<number>} opts.myStarterIds   player ids in the viewer's starting lineup
 * @param {Set<number>} opts.oppStarterIds  player ids in the opponent's starting lineup
 * @param {boolean} opts.celebrationsEnabled  the viewer's "Touchdown celebrations" pref
 * @returns {{ cutscenes: Array, summaryToast: object|null, toasts: Array }}
 *
 * - Own starter TD -> cutscene (only when celebrations are enabled).
 * - Opponent starter TD -> a bottom toast, never a cutscene.
 * - A player in neither starting lineup is ignored (bench, or another matchup).
 * - Beyond MAX_CUTSCENES own TDs, the overflow becomes one summary toast.
 * - Celebrations off: no cutscenes and no summary — "nothing fires" for the
 *   viewer's own scores. Opponent toasts are informational, not celebrations,
 *   so they still show.
 */
export function classifyPlays(plays, opts = {}) {
  const myStarterIds = opts.myStarterIds || new Set();
  const oppStarterIds = opts.oppStarterIds || new Set();
  const celebrationsEnabled = opts.celebrationsEnabled !== false;

  const ownTds = [];
  const toasts = [];

  for (const play of plays || []) {
    if (!play || play.playerId == null) continue;
    if (myStarterIds.has(play.playerId)) {
      ownTds.push(play);
    } else if (oppStarterIds.has(play.playerId)) {
      toasts.push({ ...play, side: 'opponent', tone: 'negative' });
    }
    // else: not in this matchup — ignore.
  }

  if (!celebrationsEnabled) {
    return { cutscenes: [], summaryToast: null, toasts };
  }

  const cutscenes = ownTds.slice(0, MAX_CUTSCENES);
  const overflow = ownTds.slice(MAX_CUTSCENES);
  let summaryToast = null;
  if (overflow.length > 0) {
    const pts = overflow.reduce((sum, p) => sum + (Number(p.pointsDelta) || 0), 0);
    summaryToast = {
      kind: 'summary',
      tone: 'positive',
      side: 'own',
      count: overflow.length,
      pointsDelta: round1(pts),
      message: `${overflow.length} more TD${overflow.length > 1 ? 's' : ''}: +${round1(pts)}`,
    };
  }

  return { cutscenes, summaryToast, toasts };
}

// Labels for non-touchdown "moment" plays (retro-scoreboard flash banner
// only — these never reach playLabel's TD-cutscene callers today, but the
// mapping lives here so it stays next to the touchdown label logic).
const MOMENT_LABELS = {
  fieldGoal: 'FIELD GOAL',
  extraPoint: 'EXTRA POINT',
  sack: 'SACK',
  interception: 'INTERCEPTED',
  fumble: 'FUMBLE RECOVERED',
  puntReturn: 'PUNT RETURN',
};

/**
 * A short label for the cutscene / ticker line, e.g. "rushing TD". Plays
 * explicitly marked non-touchdown (`isTouchdown === false`) get their own
 * plain-English label instead of a "TD" suffix.
 */
export function playLabel(play) {
  const type = play && play.type ? play.type : 'scoring';
  if (play && play.isTouchdown === false) {
    return MOMENT_LABELS[type] || type.toUpperCase();
  }
  return `${type} TD`;
}
