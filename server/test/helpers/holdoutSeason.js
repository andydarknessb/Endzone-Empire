/**
 * Deterministic synthetic CLOSED season for holdout tests: all 32 canonical
 * teams, weeks 1-18, exactly 17 appearances per team, byes in even groups of
 * four across weeks 5-12. Shared by the unit suite (as validateSchedule
 * fixtures) and the disposable-Postgres suite (as real `nfl_games` rows), so
 * both test the SAME domain the production validator certifies.
 */
const { CANONICAL_TEAM_KEYS, SEASON_WEEKS } = require('../../services/holdout.service');
const { computeManifestDigest } = require('../../services/scheduleManifest');

function buildSeason({ season, firstKickoff, deadlineOverrides = null }) {
  const teams = [...CANONICAL_TEAM_KEYS];
  const base = new Date(firstKickoff).getTime();
  const byeByWeek = new Map();
  for (let w = 5; w <= 12; w++) {
    byeByWeek.set(w, teams.slice((w - 5) * 4, (w - 5) * 4 + 4));
  }

  const rowsByWeek = new Map();
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    const byes = new Set(byeByWeek.get(week) || []);
    const playing = teams.filter((t) => !byes.has(t));
    // Rotate the pairing by week so opponents vary; any reciprocal pairing
    // satisfies the validator, realism is not the point.
    const rotated = [...playing.slice(week % playing.length), ...playing.slice(0, week % playing.length)];
    const rows = [];
    for (let i = 0; i < rotated.length / 2; i++) {
      const home = rotated[i];
      const away = rotated[rotated.length - 1 - i];
      const kickoff = new Date(base + (week - 1) * 7 * 24 * 3600 * 1000 + i * 10 * 60 * 1000).toISOString();
      const gameKey = `s${season}w${week}g${i}`;
      rows.push({ nfl_team: home, opponent: away, home_away: 'home', kickoff_at: kickoff, game_key: gameKey });
      rows.push({ nfl_team: away, opponent: home, home_away: 'away', kickoff_at: kickoff, game_key: gameKey });
    }
    rowsByWeek.set(week, rows);
  }

  const weeksByTeam = new Map(teams.map((t) => [t, []]));
  const manifestGames = [];
  for (const [week, rows] of rowsByWeek) {
    for (const row of rows) {
      weeksByTeam.get(row.nfl_team).push(week);
      if (row.home_away === 'home') {
        manifestGames.push({ week, away: row.opponent, home: row.nfl_team });
      }
    }
  }
  const matrixRows = teams.map((t) => ({ team_key: t, weeks: weeksByTeam.get(t).sort((a, b) => a - b) }));

  // The manifest's independent per-week deadline: this synthetic season's
  // earliest kickoff per week, capped by any date-flex override (the same
  // MIN rule the generator applies - e.g. a Week 18 Saturday reserve while
  // the rows carry placeholder Sunday times). Tests that shift the DATABASE
  // rows later exercise exactly the stale-schedule attack the deadline
  // exists to stop, because the manifest deadline stays put.
  const captureNotAfter = {};
  const overridesOut = {};
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    const kicks = rowsByWeek.get(week).map((r) => new Date(r.kickoff_at).getTime());
    let deadline = new Date(Math.min(...kicks));
    const override = deadlineOverrides && deadlineOverrides[String(week)];
    if (override) {
      overridesOut[String(week)] = {
        captureNotAfter: override,
        reason: 'date-flex reserve (synthetic)',
        authority: 'test-fixture',
        sourceDerived: deadline.toISOString(),
      };
      const cap = new Date(override);
      if (cap < deadline) deadline = cap;
    }
    captureNotAfter[String(week)] = deadline.toISOString();
  }
  const manifest = {
    season,
    source: 'synthetic test season',
    ...(Object.keys(overridesOut).length > 0 ? { deadlineOverrides: overridesOut } : {}),
    captureNotAfter,
    games: manifestGames,
  };
  manifest.digest = computeManifestDigest(manifest);

  return {
    season,
    rowsByWeek,
    matrixRows,
    byeByWeek,
    manifest,
  };
}

module.exports = { buildSeason };
