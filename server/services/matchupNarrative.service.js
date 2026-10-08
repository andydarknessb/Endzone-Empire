const defaultPool = require('../modules/pool');
const { logger } = require('../modules/logger');
const claude = require('./claude');
const lineup = require('./lineup.service');
const expectedFinal = require('./expectedFinal.service');
const { computeStandings } = require('./season.service');
const { countedRoster } = require('./countedRoster.service');
const { rulesForLeague, calculateFantasyPoints } = require('./scoringRules');

/**
 * Matchup narrative (ADR 0060, CONTEXT.md): per Matchup a preview (once the
 * week's projections exist, before the first Kickoff, written once) and a
 * postgame (once final, overwritten on a correction). One league_analytics row
 * per league-week, type 'matchup_narratives':
 *   { matchups: { [matchupId]: { preview?, postgame? } } }, each moment
 *   { narrative, source: 'template' | 'claude', generatedAt }.
 * Teams are named only by `[[team:<id>]]` tokens in facts, templates and
 * prompts; the stored text has the names swapped back in. Every template is
 * stored before any model call, the rewrites then run in parallel, and each
 * write merges one (matchup, moment) key in SQL so siblings cannot clobber
 * each other. A rewrite that states a number the facts do not carry is
 * discarded for the template (ADR 0060 section 3).
 */

const TYPE = 'matchup_narratives';
const SYSTEM =
  'You rewrite short fantasy football matchup notes for a league of friends. Two or three plain ' +
  'sentences. Use ONLY the facts provided. Never invent players, scores or events. Team names ' +
  'appear as [[team:N]] tokens; copy each token exactly where the team is named. Plain text, no ' +
  'headings, no em dashes.';
const PREVIEW_SYSTEM = `${SYSTEM} This is a preview before kickoff: state the projected edge in words only; the text must contain no digits at all.`;
const POSTGAME_SYSTEM = `${SYSTEM} This is a postgame note: you may state the final score and a top scorer's points exactly as given, and no other number.`;

const token = (teamId) => `[[team:${teamId}]]`;
const round2 = (n) => Math.round(Number(n) * 100) / 100;
const record = (s) => `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}`;

/** Pure: the preview template. Tokens name the Teams; no number is stated. */
function templatePreview(f) {
  const lines = [`${f.home.token} and ${f.away.token} meet this week.`];
  if (f.favoured === 'even') {
    lines.push('The projections have them neck and neck.');
  } else {
    const fav = f.favoured === 'home' ? f.home : f.away;
    lines.push(`${fav.token} holds a ${f.edge} projected edge.`);
  }
  const lead = (s) => s.starters[0];
  if (lead(f.home) && lead(f.away)) {
    lines.push(`${f.home.token} leans on ${lead(f.home).name} and ${f.away.token} on ${lead(f.away).name}.`);
  }
  return lines.join(' ');
}

/** Pure: the postgame template. The final score is already on the surface. */
function templatePostgame(f) {
  const { home, away } = f;
  const lines = [];
  const tail = f.closest ? ', the closest finish of the week' : '';
  if (f.winner === 'tie') {
    lines.push(`${home.token} and ${away.token} tied ${home.score} to ${away.score} this week${tail}.`);
  } else {
    const [w, l] = f.winner === home.token ? [home, away] : [away, home];
    lines.push(`${w.token} beat ${l.token} ${w.score} to ${l.score} this week${tail}.`);
  }
  const led = [home, away]
    .filter((s) => s.topScorer && s.topScorer.points > 0)
    .map((s) => `${s.topScorer.name} led ${s.token} with ${s.topScorer.points} points`);
  if (led.length > 0) lines.push(`${led.join(' and ')}.`);
  if (home.record && away.record) lines.push(`${home.token} is now ${home.record} and ${away.token} is ${away.record}.`);
  return lines.join(' ');
}

async function readStore(db, key) {
  const { rows } = await db.query(
    `SELECT "data" FROM "league_analytics"
     WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3 AND "type" = '${TYPE}'`,
    key
  );
  return (rows[0] && rows[0].data && rows[0].data.matchups) || {};
}

/** One (matchup, moment) key merged in SQL: concurrent puts keep each other's keys. */
const put = (db, key, matchupId, moment, narrative, source) =>
  db.query(
    `INSERT INTO "league_analytics" ("league_id", "season", "week", "type", "data")
     VALUES ($1, $2, $3, '${TYPE}',
             jsonb_build_object('matchups', jsonb_build_object($4::text, jsonb_build_object($5::text, $6::jsonb))))
     ON CONFLICT ("league_id", "season", "week", "type")
     DO UPDATE SET "data" = jsonb_set(
       COALESCE("league_analytics"."data", '{"matchups":{}}'::jsonb),
       ARRAY['matchups', $4::text],
       COALESCE("league_analytics"."data"->'matchups'->$4::text, '{}'::jsonb) || jsonb_build_object($5::text, $6::jsonb),
       true),
       "updated_at" = now()`,
    [...key, String(matchupId), moment, JSON.stringify({ narrative, source, generatedAt: new Date().toISOString() })]
  );

const withoutNames = (text, names) =>
  Object.values(names).sort((a, b) => b.length - a.length).reduce((t, n) => t.split(n).join(''), text);

/** A preview states no number at all. */
const previewOk = (text, names) => !/\d/.test(withoutNames(text, names));

/** A postgame may state only the facts' scores and top scorer points. */
function postgameOk(text, names, facts) {
  const allowed = new Set();
  for (const n of [facts.home.score, facts.away.score, facts.home.topScorer?.points, facts.away.topScorer?.points]) {
    if (n != null) [n, Math.trunc(n), Math.round(n)].forEach((v) => allowed.add(String(v)));
  }
  return (withoutNames(text, names).match(/\d+(?:\.\d+)?/g) || []).every((run) => allowed.has(run));
}

/** Template first (names back in), stored; the job carries the rewrite for later. */
async function storeTemplate({ db, key }, job) {
  let text = job.template(job.templateFacts);
  for (const [tok, name] of Object.entries(job.names)) text = text.split(tok).join(name);
  await put(db, key, job.matchupId, job.moment, text, 'template');
  return job;
}

/** Claude's rewrite, stored only when it arrives and passes the number check. */
async function rewrite({ db, client, now, key }, job) {
  const text = await claude.narrative({
    feature: job.feature,
    system: job.system,
    user: `Write the ${job.moment} from these facts:\n${JSON.stringify(job.facts, null, 2)}`,
    placeholders: job.names,
  }, { client, pool: db, now });
  if (text && job.accept(text)) await put(db, key, job.matchupId, job.moment, text, 'claude');
}

async function rewriteAll(ctx, jobs) {
  const results = await Promise.allSettled(jobs.map((job) => rewrite(ctx, job)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      logger.error(
        { err: r.reason, leagueId: ctx.key[0], matchupId: jobs[i].matchupId },
        `matchup ${jobs[i].moment} rewrite failed`
      );
    }
  });
}

const teamNames = async (db, leagueId) =>
  new Map((await db.query(`SELECT "id", "name" FROM "teams" WHERE "league_id" = $1`, [leagueId]))
    .rows.map((t) => [Number(t.id), t.name]));

const namesFor = (names, ...teamIds) => Object.fromEntries(teamIds.map((id) => [token(id), names.get(Number(id))]));

/**
 * Write the preview of every Matchup in the league's current week that has
 * none, while the week's first Kickoff is still ahead. Every template is
 * stored first, then the rewrites run in parallel. Each Matchup is isolated:
 * a failure logs and the others still run.
 */
async function writePreviews({ league, now = new Date(), db = defaultPool, client } = {}) {
  const { id: leagueId, current_season: season, current_week: week } = league;
  const kickoff = (await db.query(
    `SELECT MIN("kickoff_at") AS "first" FROM "nfl_games" WHERE "season" = $1 AND "week" = $2`,
    [season, week]
  )).rows[0];
  if (!kickoff || !kickoff.first || new Date(kickoff.first) <= now) return;

  const key = [leagueId, season, week];
  const store = await readStore(db, key);
  const matchups = (await db.query(
    `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" = $3`,
    key
  )).rows.filter((m) => !m.final && !(store[m.id] && store[m.id].preview));
  if (matchups.length === 0) return;
  const names = await teamNames(db, leagueId);

  const ctx = { db, client, now, key };
  const jobs = [];
  let skipped = 0;
  for (const m of matchups) {
    try {
      const teamIds = [Number(m.home_team_id), Number(m.away_team_id)];
      for (const teamId of teamIds) await lineup.materializeLineup(db, { leagueId, teamId, season, week, league });
      const finals = await expectedFinal.expectedFinalsForWeek({ league, season, week, teamIds, db, now });
      const [h, a] = teamIds.map((id) => finals.get(id));
      if (!h || !a || h.expectedFinal == null || a.expectedFinal == null) { // no lineup or projection yet
        skipped += 1;
        continue;
      }
      const players = new Map((await db.query(
        `SELECT "id", "name", "nfl_team" FROM "players" WHERE "id" = ANY($1)`,
        [[...h.starters, ...a.starters].map((s) => s.playerId)]
      )).rows.map((p) => [p.id, p]));
      // Only a starter who is available and projected to score can be the headliner.
      const side = (teamId, f) => ({
        token: token(teamId),
        starters: [...f.starters]
          .filter((s) => s.availability?.available !== false && s.projection > 0)
          .sort((x, y) => y.projection - x.projection)
          .map((s) => ({
            name: players.get(s.playerId)?.name, position: s.position, nflTeam: players.get(s.playerId)?.nfl_team,
          })),
      });
      const diff = h.expectedFinal - a.expectedFinal;
      const gap = Math.abs(diff) / Math.max(h.expectedFinal, a.expectedFinal);
      const even = diff === 0 || gap < 0.05;
      const facts = {
        home: side(teamIds[0], h),
        away: side(teamIds[1], a),
        favoured: even ? 'even' : diff > 0 ? 'home' : 'away',
        edge: even ? 'even' : gap > 0.15 ? 'clear' : 'slim',
      };
      const namesOf = namesFor(names, ...teamIds);
      jobs.push(await storeTemplate(ctx, {
        matchupId: m.id,
        moment: 'preview',
        feature: 'matchup_preview',
        system: PREVIEW_SYSTEM,
        facts,
        templateFacts: facts,
        template: templatePreview,
        names: namesOf,
        accept: (text) => previewOk(text, namesOf),
      }));
    } catch (err) {
      logger.error({ err, leagueId, matchupId: m.id }, 'matchup preview failed');
    }
  }
  if (skipped > 0) logger.info({ leagueId, season, week, skipped }, 'matchup previews skipped: no lineup or projection yet');
  await rewriteAll(ctx, jobs);
}

/**
 * Write (or overwrite) the postgame of every final Matchup of a league week:
 * templates first, then the rewrites in parallel. Each Matchup is isolated.
 */
async function writePostgames({ leagueId, season, week, now = new Date(), db = defaultPool, client }) {
  const key = [leagueId, season, week];
  const seasonRows = (await db.query(
    `SELECT * FROM "matchups" WHERE "league_id" = $1 AND "season" = $2 AND "week" <= $3`,
    key
  )).rows;
  const finals = seasonRows.filter((m) => m.final && Number(m.week) === Number(week));
  if (finals.length === 0) return;

  const league = (await db.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId])).rows[0];
  const rules = rulesForLeague(league);
  const price = (stats) => (stats ? calculateFantasyPoints(stats, rules) : 0);
  const names = await teamNames(db, leagueId);
  const standings = new Map(
    computeStandings([...names].map(([id, name]) => ({ id, name })), seasonRows).map((s) => [Number(s.teamId), s])
  );
  // The score of record's own population: held as played, then the counted
  // roster (IR dropped; best ball's optimal lineup), so the top scorer is one
  // of the players whose points are in the score shown beside the text.
  const topScorer = async (teamId) => {
    const { rows } = await db.query(
      `SELECT "lineup_entries"."player_id", "lineup_entries"."slot", "players"."name", "players"."position",
              "players"."nfl_team", "player_stats"."stats"
       FROM "lineup_entries"
       JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
       LEFT JOIN "player_stats" ON "player_stats"."player_id" = "lineup_entries"."player_id"
         AND "player_stats"."season" = $2 AND "player_stats"."week" = $3
       WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2 AND "lineup_entries"."week" = $3`,
      [teamId, season, week]
    );
    const held = await lineup.rowsHeldAsPlayed(db, { league, teamId, season, week, rows });
    const roster = countedRoster({ rows: held, league, price });
    const optimal = new Set(roster.optimalStarters.map((s) => s.playerId));
    const top = roster.counted
      .filter((c) => (league.best_ball ? optimal.has(c.playerId) : c.slot !== 'BENCH'))
      .reduce((best, c) => (!best || c.points > best.points ? c : best), null);
    return top ? { name: top.name, position: top.position, points: round2(top.points) } : null;
  };
  const margin = (m) => Math.abs(Number(m.home_score) - Number(m.away_score));
  const smallest = Math.min(...finals.map(margin));

  const ctx = { db, client, now, key };
  const jobs = [];
  for (const m of finals) {
    try {
      const side = async (teamId, score) => {
        const s = !m.is_playoff && standings.get(Number(teamId));
        return {
          token: token(teamId),
          score: round2(score),
          topScorer: await topScorer(Number(teamId)),
          record: s ? record(s) : null,
        };
      };
      const home = await side(m.home_team_id, m.home_score);
      const away = await side(m.away_team_id, m.away_score);
      const full = {
        home,
        away,
        winner: home.score === away.score ? 'tie' : home.score > away.score ? home.token : away.token,
        closest: finals.length > 1 && margin(m) === smallest,
      };
      // The prompt carries scores and top scorers, not the W-L records.
      const { record: homeRecord, ...promptHome } = home;
      const { record: awayRecord, ...promptAway } = away;
      const facts = { ...full, home: promptHome, away: promptAway };
      const namesOf = namesFor(names, m.home_team_id, m.away_team_id);
      jobs.push(await storeTemplate(ctx, {
        matchupId: m.id,
        moment: 'postgame',
        feature: 'matchup_postgame',
        system: POSTGAME_SYSTEM,
        facts,
        templateFacts: full,
        template: templatePostgame,
        names: namesOf,
        accept: (text) => postgameOk(text, namesOf, facts),
      }));
    } catch (err) {
      logger.error({ err, leagueId, matchupId: m.id }, 'matchup postgame failed');
    }
  }
  await rewriteAll(ctx, jobs);
}

module.exports = { writePreviews, writePostgames, templatePreview, templatePostgame };
