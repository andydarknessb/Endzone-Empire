/**
 * Opening week (CONTEXT.md, Opening week; ADR 0071): the first NFL week a
 * fantasy League plays, read from the nfl_games schedule on the caller's client.
 *
 * Returns { season, week, open }. `open` false means every regular-season week
 * of the season in progress has kicked off, so the League has no week to open
 * and its draft cannot start. A draft that started before the League's last
 * regular-season week kicked off and completes after it opens that week anyway.
 */
const NFL_WEEKS = 18;

async function openingWeek(client, { regularSeasonWeeks, now = new Date() }) {
  const result = await client.query(
    `SELECT "season", "week", MIN("kickoff_at") AS "first_kickoff", MAX("kickoff_at") AS "last_kickoff"
     FROM "nfl_games"
     WHERE "week" BETWEEN 1 AND $1
       AND "season" = (SELECT MAX("season") FROM "nfl_games" WHERE "week" BETWEEN 1 AND $1)
     GROUP BY "season", "week"`,
    [NFL_WEEKS]
  );
  return openingWeekOf(result.rows, { regularSeasonWeeks, now });
}

/** Pure: the Opening week for the one season's weeks in `rows`. */
function openingWeekOf(rows, { regularSeasonWeeks, now }) {
  if (rows.length === 0) return { season: now.getUTCFullYear(), week: 1, open: true };

  const season = Number(rows[0].season);
  const weeks = new Map(rows.map((r) => [Number(r.week), r]));
  const kickedOff = (at) => new Date(at) <= now;

  // The season is over once week 18 is on file and every game has kicked off.
  const seasonOver = weeks.has(NFL_WEEKS) && rows.every((r) => kickedOff(r.last_kickoff));
  if (seasonOver) return { season: season + 1, week: 1, open: true };

  // Latest week with a kickoff at or before now; a missing week below it counts as kicked off.
  let latest = 0;
  for (const [week, r] of weeks) {
    if (kickedOff(r.first_kickoff) && week > latest) latest = week;
  }
  if (latest >= regularSeasonWeeks) return { season, week: regularSeasonWeeks, open: false };
  return { season, week: latest + 1, open: true };
}

module.exports = { openingWeek };
