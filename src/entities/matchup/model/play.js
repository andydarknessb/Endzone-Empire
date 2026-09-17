/**
 * The Scoring play read model (ADR 0029; ADR 0031's below-island clause,
 * amended 2026-09-10, #1137): one scoring event for one player in one NFL
 * game as the live sync detected it (CONTEXT.md's Scoring play entry), read
 * off a `scores:updated` event's `plays` array into the one shape every
 * island consumer reads. Sibling to matchupModel.js: that module models the
 * Matchup itself; this one models the plays that ride its live score events.
 * `playLabel` moved here from `src/lib/scoringEvents` unchanged (its output
 * is pinned by this module's own tests, moved from that module's); the play
 * classifier that used to live beside it, `classifyPlays`, had exactly one
 * caller and folded into that feature's own private model instead
 * (`features/celebrate-touchdown/model/classifyPlays`) rather than becoming
 * public entity surface.
 *
 * The wire fields (`server/services/scoring.service.js`'s `plays` array):
 * `playerId`, `name`, `position`, `nflTeam`, `opponent`, `type`,
 * `isTouchdown`, `pointsDelta` (and `tdDelta`, which no reader here needs and
 * this model does not carry across). `isTouchdown` and `pointsDelta` are
 * normalised - a real boolean and a real number - so a caller's strict
 * `=== false` check or arithmetic never trips on a value the wire sent as
 * something else (a string `"false"`, say): only an explicit false-like
 * value reads as a non-touchdown moment play, matching `playLabel`'s
 * existing default of "absent or truthy is a touchdown".
 */
function normalizeIsTouchdown(value) {
  return !(value === false || value === 'false');
}

/**
 * The plays off one `scores:updated` event, as modelled Play objects. A
 * missing event or an event with no `plays` field reads as no plays; a null
 * entry in the wire array (defensive - the server has never sent one) is
 * dropped rather than modelled.
 *
 * @param {object} event  a `scores:updated` event (or any object carrying a
 *   `plays` array in the wire shape above)
 * @returns {object[]} modelled Play objects
 */
export function playsFromScoreEvent(event) {
  const raw = (event && event.plays) || [];
  return raw.filter(Boolean).map((p) => ({
    playerId: p.playerId ?? null,
    name: p.name ?? null,
    position: p.position ?? null,
    nflTeam: p.nflTeam ?? null,
    opponent: p.opponent ?? null,
    type: p.type ?? null,
    isTouchdown: normalizeIsTouchdown(p.isTouchdown),
    pointsDelta: Number(p.pointsDelta) || 0,
  }));
}

/**
 * Which side of a Matchup a Scoring play belongs to, from the two starter id
 * sets a caller already holds: `'own'` for the viewer's own starter,
 * `'opponent'` for the opponent's, and `'none'` for anyone else (a bench
 * player, or a player in a different Matchup entirely). The one attribution
 * rule a caller used to re-derive inline with its own `.has()` checks reads
 * from here now (#1137).
 *
 * @param {object} play
 * @param {{ myStarterIds?: Set, oppStarterIds?: Set }} [starters]
 * @returns {'own'|'opponent'|'none'}
 */
export function matchupPlaySide(play, { myStarterIds, oppStarterIds } = {}) {
  if (!play || play.playerId == null) return 'none';
  const mine = myStarterIds || new Set();
  const theirs = oppStarterIds || new Set();
  if (mine.has(play.playerId)) return 'own';
  if (theirs.has(play.playerId)) return 'opponent';
  return 'none';
}

// Labels for non-touchdown "moment" plays (retro-scoreboard flash banner
// only - these never reach playLabel's TD-cutscene callers today, but the
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

/**
 * A signed points delta, "+10.4", "-2.0", "+0.0" by default (one decimal,
 * padded) - the ONE spelling of "sign + magnitude" every points-delta display
 * (the ticker, the toasts, the cutscene, the scoring feed) reads off, so a
 * play with a negative delta (the server's attributePlayPoints can land a
 * negative residual on a non-touchdown event, #1241 follow-up) never renders
 * as "+-8.0". The sign is a hyphen for a negative value (house style: hyphens
 * in scores, never a minus glyph the font may lack), a plus for zero and
 * above. A non-numeric delta reads as "+0.0" (or the zero-decimals
 * equivalent) rather than "NaN".
 *
 * `trim: true` drops a whole number's trailing ".0" (the cutscene's own
 * style, "+4" not "+4.0"); every other caller keeps the padded decimal.
 *
 * @param {number} pointsDelta
 * @param {{decimals?: number, trim?: boolean}} [opts]
 * @returns {string}
 */
export function formatSignedPoints(pointsDelta, { decimals = 1, trim = false } = {}) {
  const n = Number(pointsDelta);
  const value = Number.isFinite(n) ? n : 0;
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(value) * factor) / factor;
  const sign = value < 0 && rounded > 0 ? '-' : '+';
  const magnitude = trim ? String(rounded) : rounded.toFixed(decimals);
  return `${sign}${magnitude}`;
}
