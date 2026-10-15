'use strict';

/**
 * One read-only JSON dump of everything the Weekly Darkness Report's rulings
 * need for a week (docs/editorial/README.md). One `BEGIN READ ONLY`
 * transaction on DATABASE_URL, rolled back. Writes nothing to the DB.
 *
 *   node scripts/editorial/dump-week.js [--season 2026] [--week 6] [--out <path.json>]
 *
 * Defaults: season = upcomingNflSeason(); week = the first week whose last
 * kickoff (getSeasonWeekBounds) is still ahead. No `--out` = stdout.
 *
 * Team codes: stats and the depth chart say WAS, nfl_games / players / the
 * projection snapshot say WSH; every value is normalised to WAS (`wsh`) except
 * `game_key`, which stays the opaque odds/weather key (e.g. 2026_06_DAL_WSH).
 *
 * Points are PPR: player_stats.fantasy_points is stored under the default
 * (half-PPR) rules, so every figure is re-priced from `stats` with
 * calculateFantasyPoints(stats, SCORING_PRESETS.ppr), as score-calls.js does.
 *
 * `fpa` takes the defending team from the stat row's own `gameOpponent` key
 * (nflverseSync writes it only on backfilled/finalized rows) and falls back to
 * the week's nfl_games opponent for the player's current team when it is
 * absent. A traded player's pre-trade weeks without the key read as his
 * current team's opponent; `fpa.source` counts the stat rows placed by each
 * path (and the rows neither could place). Ranked on points allowed per game
 * (a team on a bye has fewer games); points and games stay in the row.
 *
 * Exit code 2 (after writing the document) when no on-time scheduled PPR
 * snapshot exists, with a warning on stderr.
 */

const fs = require('fs');

const SKILL = ['QB', 'RB', 'WR', 'TE'];
const IDP = ['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'DB', 'CB', 'S', 'FS', 'SS'];
const TEAM_NOTE = 'WAS in stats/depth chart, WSH in nfl_games/players/snapshot';

/** Pure: numeric columns arrive as strings; null stays null. */
const num = (v) => (v == null ? null : Number(v));
const round2 = (v) => Math.round(v * 100) / 100;

/** Pure: deep copy with every exact 'WSH' value spelled 'WAS'. */
function wsh(value) {
  if (value === 'WSH') return 'WAS';
  if (Array.isArray(value)) return value.map(wsh);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wsh(v)]));
  }
  return value;
}

/** Pure: Map key -> the row with the newest `at` (Date or ISO), first one wins a tie. */
function newestBy(rows, key, at) {
  const out = new Map();
  for (const r of rows) {
    const cur = out.get(r[key]);
    if (!cur || new Date(r[at]) > new Date(cur[at])) out.set(r[key], r);
  }
  return out;
}

/** Pure: first week whose last kickoff is after `now`; null when none. */
function firstOpenWeek(bounds, now) {
  const open = bounds.find((b) => b.lastKickoffAt > now);
  return open ? open.week : null;
}

/** Pure: rows { position, defense, points, games } -> per position, rank 1 = most points per game allowed, ties share. */
function rankFpa(rows) {
  const out = {};
  for (const pos of SKILL) {
    const list = rows.filter((r) => r.position === pos)
      .map((r) => ({ team: r.defense, points: round2(r.points), games: r.games, perGame: round2(r.points / r.games) }))
      .sort((a, b) => b.perGame - a.perGame || a.team.localeCompare(b.team));
    out[pos] = list.map((r) => ({ ...r, rank: 1 + list.filter((x) => x.perGame > r.perGame).length }));
  }
  return out;
}

/** Pure: per-player roll-up of priced (player x week) rows; `games` = stat rows. */
function rollUp(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.id)) by.set(r.id, { id: r.id, name: r.name, position: r.position, nfl_team: r.nfl_team, weeks: [], points: 0, games: 0 });
    if (r.week == null) continue;
    const p = by.get(r.id);
    p.weeks.push({ week: r.week, fantasy_points: r.fantasy_points });
    p.points += r.fantasy_points;
    p.games += 1;
  }
  return [...by.values()].map((p) => ({ ...p, points: round2(p.points) }));
}

/** First week with a future last kickoff, from the stored schedule. */
async function resolveWeek(client, season, now = new Date()) {
  const { getSeasonWeekBounds } = require('../../server/services/pickemSeason.service');
  const week = firstOpenWeek(await getSeasonWeekBounds({ season, db: client }), now);
  if (week == null) throw new Error(`dump-week: no week with a future last kickoff in ${season}; pass --week`);
  return week;
}

/** The whole document, off one (read-only) client. */
async function build(client, { season, week, now = new Date() }) {
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const model = require('../../server/services/projectionModel');
  const { SCORING_PRESETS, calculateFantasyPoints } = require('../../server/services/scoringRules');
  const ppr = (stats) => round2(calculateFantasyPoints(stats, SCORING_PRESETS.ppr));

  const gameRows = await q(
    `SELECT "nfl_team", "opponent", "home_away", "kickoff_at", "venue", "roof", "surface", "rest_days", "game_key"
     FROM "nfl_games" WHERE "season" = $1 AND "week" = $2 ORDER BY "kickoff_at", "game_key", "home_away"`,
    [season, week]
  );
  const odds = newestBy(await q(
    `SELECT "game_key", "spread", "total", "observed_at" FROM "game_odds_snapshots" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  ), 'game_key', 'observed_at');
  const weather = newestBy(await q(
    `SELECT "game_key", "temperature_f", "wind_speed_mph", "wind_gust_mph", "precipitation_probability", "short_forecast", "fetched_at"
     FROM "game_weather_snapshots" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  ), 'game_key', 'fetched_at');
  const games = gameRows.map((g) => {
    const o = odds.get(g.game_key) || {};
    const w = weather.get(g.game_key) || {};
    return {
      ...g,
      spread: num(o.spread), total: num(o.total), odds_observed_at: o.observed_at || null,
      temperature_f: num(w.temperature_f), wind_speed_mph: num(w.wind_speed_mph), wind_gust_mph: num(w.wind_gust_mph),
      precipitation_probability: w.precipitation_probability ?? null, short_forecast: w.short_forecast || null,
      weather_fetched_at: w.fetched_at || null,
    };
  });

  const [snapshot] = await q(
    `SELECT "id", "model_version", "captured_at", "capture_not_after"
     FROM "projection_snapshots"
     WHERE "season" = $1 AND "week" = $2 AND "scoring_profile" = 'ppr' AND "scoring_hash" = $3
       AND "capture_kind" = 'scheduled' AND NOT "is_late"
     ORDER BY "captured_at" DESC LIMIT 1`,
    [season, week, model.scoringHash(SCORING_PRESETS.ppr)]
  );
  const projectionPlayers = snapshot ? (await q(
    `SELECT sp."player_id", p."name", sp."position", sp."nfl_team", sp."mean", sp."median", sp."p10", sp."p90",
            sp."active_probability", sp."confidence", sp."sample_size", sp."injury_status", sp."opponent", sp."home_away", sp."game_kickoff_at"
     FROM "projection_snapshot_players" sp JOIN "players" p ON p."id" = sp."player_id"
     WHERE sp."snapshot_id" = $1 ORDER BY sp."position", sp."mean" DESC NULLS LAST`,
    [snapshot.id]
  )).map((r) => ({ ...r, mean: num(r.mean), median: num(r.median), p10: num(r.p10), p90: num(r.p90), active_probability: num(r.active_probability) }))
    : [];

  const usage = (await q(
    `SELECT s."player_id", p."name", p."nfl_team", p."position", s."week", s."stats"
     FROM "player_stats" s JOIN "players" p ON p."id" = s."player_id"
     WHERE s."season" = $1 AND s."week" < $2 AND p."position" = ANY($3::text[])
     ORDER BY p."position", p."name", s."week"`,
    [season, week, SKILL]
  )).map(({ stats, ...r }) => {
    const st = stats || {};
    return {
      ...r, fantasy_points: ppr(st),
      usageOffenseSnapPct: num(st.usageOffenseSnapPct), usageTargetShare: num(st.usageTargetShare),
      usageTargets: num(st.usageTargets), usageCarries: num(st.usageCarries),
      usagePassAttempts: num(st.usagePassAttempts), receptions: num(st.receptions),
    };
  });

  // newest row per player, and only if it is recent: a player who left the chart ages out
  const depthChart = await q(
    `SELECT * FROM (
       SELECT DISTINCT ON (d."player_id") d."player_id", p."name", d."team_code", d."position_group", d."rank", d."captured_date"
       FROM "player_depth_chart" d JOIN "players" p ON p."id" = d."player_id"
       WHERE d."captured_date" >= CURRENT_DATE - 7
       ORDER BY d."player_id", d."captured_date" DESC
     ) "latest" ORDER BY "team_code", "position_group", "rank"`
  );

  const injured = await q(
    `SELECT p."id", p."name", p."position", p."nfl_team", p."injury_status", p."injury_detail" FROM "players" p
     WHERE p."injury_status" IS NOT NULL
        OR EXISTS (SELECT 1 FROM "player_practice_observations" o
                   WHERE o."player_id" = p."id" AND o."season" = $1 AND o."week" = $2)
     ORDER BY p."position", p."name"`,
    [season, week]
  );
  // every observation, oldest first: the Wed-Fri trend is the injury-flag input
  const observations = await q(
    `SELECT "player_id", "practice_status", "practice_primary_injury", "report_status", "report_primary_injury", "observed_at"
     FROM "player_practice_observations" WHERE "season" = $1 AND "week" = $2 AND "player_id" = ANY($3::int[])
     ORDER BY "player_id", "observed_at"`,
    [season, week, injured.map((p) => p.id)]
  );
  const injuries = injured.map((p) => ({
    ...p,
    practice: observations.filter((o) => o.player_id === p.id).map(({ player_id, ...o }) => o),
  }));

  const weekly = async (positions) => rollUp((await q(
    `SELECT p."id", p."name", p."position",
            CASE WHEN p."position" = 'DEF' THEN fn_normalize_nfl_team(p."nfl_team") ELSE p."nfl_team" END AS "nfl_team",
            s."week", s."stats"
     FROM "players" p LEFT JOIN "player_stats" s ON s."player_id" = p."id" AND s."season" = $1 AND s."week" < $2
     WHERE p."position" = ANY($3::text[]) ORDER BY p."name", s."week"`,
    [season, week, positions]
  )).map(({ stats, ...r }) => ({ ...r, fantasy_points: r.week == null ? null : ppr(stats || {}) })));
  const dst = await weekly(['DEF']);
  const idp = (await weekly(IDP)).filter((p) => p.games > 0);

  const fpaRows = await q(
    `SELECT p."position", s."week", s."stats", fn_normalize_nfl_team(s."stats"->>'gameOpponent') AS "stored",
            fn_normalize_nfl_team(g."opponent") AS "scheduled"
     FROM "player_stats" s JOIN "players" p ON p."id" = s."player_id"
     LEFT JOIN "nfl_games" g ON g."season" = s."season" AND g."week" = s."week"
       AND fn_normalize_nfl_team(g."nfl_team") = fn_normalize_nfl_team(p."nfl_team")
     WHERE s."season" = $1 AND s."week" < $2 AND p."position" = ANY($3::text[])`,
    [season, week, SKILL]
  );
  const byDefense = new Map();
  const source = { gameOpponentRows: 0, scheduleRows: 0, unplacedRows: 0 };
  for (const r of fpaRows) {
    const defense = r.stored || r.scheduled;
    if (!defense) { source.unplacedRows += 1; continue; }
    source[r.stored ? 'gameOpponentRows' : 'scheduleRows'] += 1;
    const k = `${r.position}|${defense}`;
    const cur = byDefense.get(k) || { position: r.position, defense, points: 0, weeks: new Set() };
    cur.points += ppr(r.stats || {});
    cur.weeks.add(r.week);
    byDefense.set(k, cur);
  }
  const fpa = { source, ...rankFpa(wsh([...byDefense.values()].map(({ weeks, ...r }) => ({ ...r, games: weeks.size })))) };

  return wsh({
    games,
    projections: { snapshot: snapshot || null, players: projectionPlayers },
    usage, depthChart, injuries, dst, idp, fpa,
    meta: { season, week, scoring: 'ppr', generatedAt: now.toISOString(), teamCodeNote: TEAM_NOTE },
  });
}

const argOf = (argv, name) => {
  const at = argv.indexOf(name);
  return at < 0 ? null : argv[at + 1];
};

/** Returns the exit code: 0, or 2 when the document is written but no scheduled PPR snapshot exists. */
async function main(argv, injectedPool) {
  if (!process.env.DATABASE_URL) {
    try { process.loadEnvFile(); } catch (e) { /* no .env in cwd; the pool reports a missing URL */ }
  }
  // The pool reads DATABASE_URL when first required, so it loads after .env.
  // eslint-disable-next-line global-require
  const pool = injectedPool || require('../../server/modules/pool');
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const season = argOf(argv, '--season') != null ? Number(argOf(argv, '--season'))
      : await require('../../server/services/nflSeason.service').upcomingNflSeason();
    const week = argOf(argv, '--week') != null ? Number(argOf(argv, '--week')) : await resolveWeek(client, season);
    const doc = await build(client, { season, week });
    const json = JSON.stringify(doc, null, 2);
    const out = argOf(argv, '--out');
    if (out) fs.writeFileSync(out, `${json}\n`); else console.log(json);
    if (doc.projections.snapshot) return 0;
    console.error(`dump-week: WARNING no on-time scheduled PPR projection snapshot for ${season} week ${week}; projections is empty`);
    return 2;
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((err) => {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { build, main, resolveWeek, firstOpenWeek, newestBy, rankFpa, rollUp, wsh };
