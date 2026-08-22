/** First letters of up to the first two words of a name, uppercased. Used as
 * the avatar fallback for players and teams alike when no image is set. */
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
