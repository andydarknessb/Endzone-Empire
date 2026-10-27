/**
 * Pure: did this player-week's stat line record an Appearance (CONTEXT.md
 * "Appearance"; #1860)? A stat row alone is not one: rows exist for rostered
 * players who never took the field, and the box writes its zeros. An Appearance
 * is a snap (nflverse snap_counts, offense or defense) or any non-zero figure in
 * the line. ponytail: the box and snap feed are the only participation data
 * there is (no active/inactive flag), so a blocking tight end whose snaps have
 * not been published yet reads as no Appearance; upgrade to a game-level active
 * list if the feed ever carries one.
 *
 * A leaf with no `require`s on purpose: `projectionFeatures.js` and
 * `decision.service.js` both need it, and `decision.service.js` already
 * requires `projection.service.js`, so importing it from there would be a cycle.
 */
function madeAppearance(stats) {
  return Object.values(stats || {}).some((v) => typeof v === 'number' && Number.isFinite(v) && v !== 0);
}

module.exports = { madeAppearance };
