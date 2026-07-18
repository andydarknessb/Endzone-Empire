/**
 * Shared name-matching helpers for cross-provider player joins (headshots,
 * ADP, ...). Providers spell names differently, so we compare a folded key.
 */

/**
 * A normalized key for fuzzy name matching across providers: lowercased, with
 * accents and generational suffixes (Jr/Sr/II-V) stripped and whitespace
 * collapsed. Intra-word punctuation (apostrophes, periods) is DELETED so
 * "Ja'Marr"/"JaMarr" and "A.J."/"AJ" converge; hyphens become spaces since
 * they separate words ("Amon-Ra" -> "amon ra").
 */
function normalizeNameKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[.'`’]/g, '') // apostrophes / periods deleted (intra-word)
    .replace(/-/g, ' ') // hyphens separate words
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when our stored nfl_team matches a provider team (full name or abbr). */
function teamMatches(ourTeam, entry) {
  if (!ourTeam) return false;
  const t = String(ourTeam).trim().toLowerCase();
  return (
    (entry.team && String(entry.team).toLowerCase() === t) ||
    (entry.teamShort && String(entry.teamShort).toLowerCase() === t)
  );
}

module.exports = { normalizeNameKey, teamMatches };
