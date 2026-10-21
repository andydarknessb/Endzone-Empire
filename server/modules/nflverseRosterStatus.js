'use strict';

/**
 * nflverse's weekly roster file as a second opinion on ESPN's roster status
 * (#2487, ADR 0041 amendment). ESPN's roster doc keeps a practice-squad player
 * in `offense` after a gameday elevation reverts; nflverse's latest week lists
 * him `DEV` (practice squad). The one thing it may change is ESPN Active ->
 * Practice squad, and never inside an elevation window its snapshot has not
 * seen (#1768). Pure: the fetch and the kickoff lookup live in espnFactsSync.
 */

const { normalizeNflTeam } = require('../services/nflTeam');

const ELEVATION_DEADLINE_HOUR_ET = 16;
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
const ET_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });

/** `last_updated` ("YYYY-MM-DD HH:MM:SS EDT|EST", as timestamp.json writes it) as an instant, or null. */
function parseLastUpdated(text) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (EDT|EST)$/.exec(String(text).trim());
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}${m[3] === 'EDT' ? '-04:00' : '-05:00'}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `espnId|team` for one athlete on one canonical team: a DEV row counts only for the team ESPN has him on, so a
 * player signed off another club's practice squad is not overridden while nflverse still lists the old club. */
const practiceSquadKey = (espnId, team) => `${Number(espnId)}|${team}`;

/** `practiceSquadKey`s of the athletes nflverse lists `DEV` at the file's latest week. */
function latestWeekPracticeSquadIds(rows) {
  const week = (r) => Number(r.week);
  const latest = rows.reduce((max, r) => (week(r) > max ? week(r) : max), -Infinity);
  const ids = new Set();
  for (const r of rows) {
    if (week(r) === latest && r.status === 'DEV' && r.espn_id) ids.add(practiceSquadKey(r.espn_id, normalizeNflTeam(r.team)));
  }
  return ids;
}

/** The instant of `hour`:00 America/New_York on ET calendar day `ymd` (DST-correct). */
function etInstant(ymd, hour) {
  for (const offset of [4, 5]) {
    const instant = new Date(`${ymd}T${String(hour + offset).padStart(2, '0')}:00:00Z`);
    if (Number(ET_HOUR.format(instant)) === hour) return instant;
  }
  throw new Error(`no America/New_York instant for ${ymd} ${hour}:00`);
}

/** 16:00 ET on the ET day before the ET date of `kickoff`: when elevations for that game lock. */
function elevationDeadline(kickoff) {
  const [y, m, d] = ET_DATE.format(kickoff).split('-').map(Number);
  const dayBefore = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  return etInstant(dayBefore, ELEVATION_DEADLINE_HOUR_ET);
}

/**
 * True when ESPN's Active for `athleteId` on `teamCode` should read Practice
 * squad. `snapshot` is `{ practiceSquadIds, updatedAt, nextKickoffByTeam }`
 * (null when nflverse could not be read: never an override).
 */
function nflverseSaysPracticeSquad(snapshot, { athleteId, teamCode, now }) {
  if (!snapshot || !snapshot.practiceSquadIds.has(practiceSquadKey(athleteId, teamCode))) return false;
  const kickoff = snapshot.nextKickoffByTeam.get(teamCode);
  if (!kickoff) return true;
  const deadline = elevationDeadline(kickoff);
  return !(now >= deadline && snapshot.updatedAt < deadline);
}

module.exports = {
  parseLastUpdated,
  latestWeekPracticeSquadIds,
  elevationDeadline,
  nflverseSaysPracticeSquad,
};
