/**
 * First letters of up to the first two words of a name, uppercased. Used as
 * the avatar fallback for players and teams alike when no image is set.
 *
 * Promoted to `shared/lib` from `src/lib/initials` (#1146, ADR 0031's
 * amendment extending the second-island-consumer clause to presentational
 * components): reached its own second island consumer (retro-scoreboard and
 * join-requests both call it directly) and is also read by TeamAvatar, which
 * crossed the same threshold and moved to `shared/ui` alongside it. The
 * arithmetic is unchanged; only its address moved.
 */
export function initialsFor(name) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}
