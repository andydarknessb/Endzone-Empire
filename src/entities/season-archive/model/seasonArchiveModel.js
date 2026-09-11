/**
 * The Season archive read model, pure (ADR 0029: the entities layer; season-
 * archive is its third slice, after Matchup and Standings). It is the one
 * spelling of an archived season and the League's all-time Team roster as the
 * client knows them - CONTEXT.md "Season archive".
 *
 * `seasonView(season)` decides the two things the wire's `outcome`/`champions`
 * alone cannot: whether a season's standings are the pick'em shape (points/
 * correct) or the fantasy shape (wins/losses/ties), and which archived
 * standings row, if any, matches each champion, for a caller to caption. A
 * champion with no matching row is a data defect (Cory's 2026-09-11 ruling on
 * #1213, settling the note #1211/PR #1222 left open): this model reports it
 * as `standing: null` rather than inventing one, and leaves what to do about
 * it (log it, render the name alone) to the caller. That is also why this
 * module never imports the standings entity: it hands back the raw matching
 * row, never a formatted Record or points line - formatting a Record is the
 * standings entity's rule alone (CONTEXT.md "Record"), and an entity never
 * imports another entity (ADR 0029).
 *
 * `allTimeRowFromRow` normalizes one row of `allTime[]` (#1212): a pick'em
 * Team's `wins`/`losses`/`ties` stay `null` rather than being coerced to
 * zero, because zeroing them would invent a Record that never happened.
 * Formatting a non-null Record is likewise the caller's job, through the
 * standings entity's `teamStandingFromRow`, imported at the page - never here.
 *
 * This module is pure: it imports nothing at all.
 */

/**
 * A pick'em-only league archives its pick'em table (points, correct picks)
 * rather than a W-L record; the rows themselves say which shape they are.
 */
export function isPickemStandings(standings) {
  return (
    Array.isArray(standings)
    && standings.length > 0
    && standings.every((row) => row.wins === undefined && row.points !== undefined)
  );
}

/**
 * One archived season as the client knows it.
 *
 *   { season, standings, trophies, draftGrades, trophiesErrored,
 *     draftGradesErrored, champions, pickem, coChampions, explicitNoChampion }
 *
 * `champions[].standing` is the raw archived standings row matching that
 * champion's teamId, or `null` when none matches. `pickem` is true for a
 * declared pick'em result ('champions' is the one outcome only a pick'em
 * season ever carries) or, for a legacy/declared no-champion season the
 * outcome string alone cannot tell apart from a champion-less fantasy one,
 * whenever the standings themselves carry the pick'em shape.
 */
export function seasonView(season) {
  const standings = Array.isArray(season?.standings) ? season.standings : [];
  const champions = Array.isArray(season?.champions)
    ? season.champions.map((champion) => ({
      ...champion,
      standing: standings.find((row) => row && row.teamId === champion.teamId) || null,
    }))
    : [];

  return {
    season: season?.season,
    standings,
    trophies: Array.isArray(season?.trophies) ? season.trophies : [],
    draftGrades: Array.isArray(season?.draftGrades) ? season.draftGrades : null,
    trophiesErrored: !!season?.trophiesErrored,
    draftGradesErrored: !!season?.draftGradesErrored,
    champions,
    pickem: season?.outcome === 'champions' || isPickemStandings(standings),
    coChampions: champions.length > 1,
    explicitNoChampion: season?.outcome === 'no_champion',
  };
}

/**
 * Whether a live Team-profile update (a rename or new avatar) must never
 * rewrite this season's archived champions/standings/draftGrades: a declared
 * pick'em result is frozen archive text at every outcome it persists, not
 * only a declared champions one - 'no_champion' persists too, with an empty
 * `champions` array, the same outcome string a champion-less FANTASY season
 * carries. The outcome string alone can't tell them apart there, so the
 * standings shape (`isPickemStandings`) is what does. A legacy pick'em season
 * with no declared result (outcome null) still patches through, same as a
 * fantasy season.
 */
export function isFrozenPickemSeason(season) {
  return (
    season?.outcome === 'champions'
    || (season?.outcome === 'no_champion'
      && isPickemStandings(Array.isArray(season?.standings) ? season.standings : []))
  );
}

/**
 * One row of the League's all-time Team roster (#1212). `championships` and
 * `wins`/`losses`/`ties` are the sum of every archived season the server
 * already folded in (server/services/seasonArchive.service.js); this is a
 * total, not a derivation, so it only normalizes types. A pick'em Team's
 * wins/losses/ties stay `null` - never coerced to zero, which would invent a
 * Record that never happened (CONTEXT.md "Record").
 */
export function allTimeRowFromRow(row) {
  const r = row || {};
  return {
    teamId: r.teamId ?? null,
    name: r.name ?? null,
    avatarUrl: r.avatarUrl ?? null,
    championships: Number(r.championships) || 0,
    wins: typeof r.wins === 'number' ? r.wins : null,
    losses: typeof r.losses === 'number' ? r.losses : null,
    ties: typeof r.ties === 'number' ? r.ties : null,
  };
}

/**
 * The whole all-time read: `allTime[]`, normalized, in the order the server
 * sends it (championships desc, then wins desc, then teamId asc - #1212's
 * R5). A body with no `allTime` array is an empty roster, never a throw.
 */
export function allTimeFromResponse(body) {
  const rows = Array.isArray(body?.allTime) ? body.allTime : [];
  return rows.map(allTimeRowFromRow);
}
