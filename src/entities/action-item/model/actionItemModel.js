/**
 * The one client reader of an Action item's id. The server spells it
 * `type:leagueId[:key]`, and a `lineup_problem` key is `season-week`
 * (server/services/homeStatus.service.js's `actionItem`). Surfaces ask HERE for
 * an item's type or for this week's Lineup problem instead of splitting the id
 * themselves, so a change to the format has one client copy to fix (spec #2532,
 * ticket 3/3).
 */

/** An item's type: the id's first segment (`lineup_problem`, `picks_open`, ...). */
export function itemType(item) {
  return String(item?.id ?? '').split(':')[0];
}

/**
 * This league's `lineup_problem` item for that season and week, or undefined: a
 * problem for another week, another league or another type says nothing about
 * this Matchup's lock.
 */
export function lineupProblemFor(items, { leagueId, season, week }) {
  const key = `${season}-${week}`;
  return (Array.isArray(items) ? items : []).find((item) => {
    const [, , itemKey] = String(item.id).split(':');
    return itemType(item) === 'lineup_problem' && String(item.leagueId) === String(leagueId) && itemKey === key;
  });
}
