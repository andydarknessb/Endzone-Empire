const pool = require('../modules/pool');
const clock = require('../modules/clock');
const prefs = require('./prefs.service');
const { banterFor, SITUATIONS } = require('./pushBanter');
const { round2 } = require('./scoringRules');

/**
 * Push alerts (CONTEXT.md, ADR 0064): every Push alert is sent through
 * `sendAlert({ kind, ...facts })`. KINDS holds one row per kind and the row is
 * the whole alert; this module owns the pipeline around it: recipients ->
 * preference gate -> rate -> ledger -> text + Banter -> send.
 *
 * Row: { prefKey, recipients(facts, db), once?(facts, r), rate?, text(facts, r),
 *        banter?(facts, r) }.
 *  - recipients: async, [{ userId, ...ctx }]; one entry per push to send.
 *  - once: { subject, fingerprint } of the push_events row that makes a repeat
 *    a no-op (unique on user, kind, subject, fingerprint).
 *  - rate: { perUserMs, excludeFingerprintLike? }: at most one push per user
 *    per window, read from the ledger before the once insert, so a capped
 *    recipient writes no row and the next tick retries.
 *  - banter: the Banter string (pushBanter.js) or null.
 */

const CLOSE_MARGIN = 10;
const LIVE_ALERT_CAP_MS = 5 * 60 * 1000; // big-play and score-lead: one push per Manager per window
const BIG_PLAY_WORDS = {
  passing: 'passing touchdown', rushing: 'rushing touchdown', receiving: 'receiving touchdown',
  defensive: 'defensive touchdown', return: 'return touchdown', fieldGoal: 'field goal',
  extraPoint: 'extra point', sack: 'sack', interception: 'interception return',
  fumble: 'fumble recovery', puntReturn: 'punt return',
};
const INJURY_ALERT_LABELS = { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'IR' };

// A row's per-item recipient lookup that loses one item, not the alert, on a failure.
async function eachSafe(kind, items, fn) {
  const out = [];
  for (const item of items || []) {
    try {
      out.push(...await fn(item));
    } catch (err) {
      console.error('push alert %s failed:', kind, err.message);
    }
  }
  return out;
}

const leaderOf = (m) => {
  const home = Number(m.homeScore);
  const away = Number(m.awayScore);
  return home > away ? 'home' : away > home ? 'away' : 'tied';
};
// One decimal, unless that prints the two scores as the same figure: then two,
// so the copy never shows equal figures beside a lead (matchupModel does the same).
const scoreText = (a, b) => {
  const places = Number(a).toFixed(1) === Number(b).toFixed(1) ? 2 : 1;
  return [Number(a).toFixed(places), Number(b).toFixed(places)];
};
const figures = (s) => scoreText(s.mineScore, s.theirScore);
const scoreBody = (s) => { const [x, y] = figures(s); return `${s.mine.name} ${x} - ${s.theirs.name} ${y}`; };

// The two Managers of a scored matchup, each with their own side of the score.
async function matchupSides(db, m) {
  const teams = await db.query(
    `SELECT "id", "name", "owner_id" FROM "teams" WHERE "id" = ANY($1::int[])`,
    [[m.homeTeamId, m.awayTeamId]]
  );
  return [
    { mine: teams.rows.find((r) => r.id === m.homeTeamId), theirs: teams.rows.find((r) => r.id === m.awayTeamId), mineScore: m.homeScore, theirScore: m.awayScore, side: 'home' },
    { mine: teams.rows.find((r) => r.id === m.awayTeamId), theirs: teams.rows.find((r) => r.id === m.homeTeamId), mineScore: m.awayScore, theirScore: m.homeScore, side: 'away' },
  ].filter((s) => s.mine && s.theirs && s.mine.owner_id != null);
}

const gameCenter = (leagueId) => `/#/league/${leagueId}/game-center`;
const bigPlayWhat = (p) => `${p.name} ${BIG_PLAY_WORDS[p.type] || p.type}`;
const bigPlayLines = (r) => r.qualifying.map((p) =>
  `${bigPlayWhat(p)} (${Math.round(p.points * 10) / 10} pts, ${r.side.own.includes(p) ? 'yours' : "your opponent's"})`);

const managersOfLeague = async (league, db) => (await db.query(
  `SELECT "owner_id" FROM "teams" WHERE "league_id" = $1`,
  [league.id]
)).rows.map((r) => ({ userId: r.owner_id }));

/**
 * Big play alerts (#2108): after a live sync's league is scored, push both
 * managers of a matchup when one of this sync's Scoring plays by a starter is
 * worth BIG_PLAY_MIN_POINTS (default 6) under that league's rules. One push per
 * owner per sync, and none while a `big-play` ledger row for that owner is under
 * five minutes old (the capped plays are dropped, not queued). Runs after
 * scoreMatchups has committed, never inside its transaction.
 *
 * A play is priced at its whole fantasy value under that league's rules (R4):
 * the player's point change for the sync as `rulesForLeague` prices it, not the
 * touchdown's own price alone. The plays carry the sync's stat line before and
 * after (`statsBefore`/`statsAfter`); plays of one player from the same sync
 * (identical lines) share that whole change, split across them by
 * attributePlayPoints under the league's rules, so a sync's plays still sum to
 * the player's whole change. A DEF's pointsAllowed/yardsAllowed are game-state
 * tiers, not a play, so they are left out of both lines before pricing. The
 * same unrounded number decides eligibility and (rounded to a tenth) fills the
 * body and the Banter `{points}`. A play without the stat lines (an older
 * producer), or whose before-line is empty (a player's first sync of the game,
 * which would price every earlier stat as the play), falls back to the
 * touchdown's price under league rules, or `pointsDelta` for a field goal.
 */
async function bigPlayRecipients({ leagueId, season, week, scored, plays }, db) {
  const minPoints = Number(process.env.BIG_PLAY_MIN_POINTS) || 6;
  if (!plays || plays.length === 0 || !scored || scored.length === 0) return [];
  const { rulesForLeague, calculateFantasyPoints } = require('./scoringRules');
  const { PLAY_STAT_EVENTS, attributePlayPoints } = require('./boxScoreApply.service');
  const league = (await db.query(`SELECT * FROM "leagues" WHERE "id" = $1`, [leagueId])).rows[0];
  const rules = rulesForLeague(league);
  // A play carries its event `type` but not the stat key it was detected from.
  const statKeyOf = (type) => Object.keys(PLAY_STAT_EVENTS).find((k) => PLAY_STAT_EVENTS[k].type === type);
  // One sync's plays for a player share a stat line pair: group on it, price
  // the group's whole change under league rules, split it across the group.
  const groups = new Map();
  for (const p of plays) {
    if (!p.statsBefore || !p.statsAfter) continue;
    // A first sync (no line before) would price the whole game so far as one
    // play; such a play keeps the touchdown's own price instead.
    if (Object.keys(p.statsBefore).length === 0) continue;
    const key = `${p.playerId}|${JSON.stringify(p.statsBefore)}|${JSON.stringify(p.statsAfter)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const pointsOf = new Map();
  for (const group of groups.values()) {
    // pointsAllowed/yardsAllowed are a DEF's game-state tiers, not a play: left
    // in, a DEF's first sync prices the whole tier (+20 at 0/0) onto a sack, and
    // a tier drop in the same sync zeroes a pick-six. Price the play without them.
    const playLine = ({ pointsAllowed, yardsAllowed, ...line }) => line;
    const statsBefore = playLine(group[0].statsBefore);
    const statsAfter = playLine(group[0].statsAfter);
    const whole = round2(calculateFantasyPoints(statsAfter, rules) - calculateFantasyPoints(statsBefore, rules));
    const events = group.map((p) => ({ statKey: statKeyOf(p.type) }));
    attributePlayPoints(statsBefore, statsAfter, events, whole, rules)
      .forEach((points, i) => pointsOf.set(group[i], points));
  }
  const big = plays
    .map((p) => {
      const statKey = statKeyOf(p.type);
      // No stat lines (an older producer, or a first sync): the touchdown's price under league rules; a field goal keeps pointsDelta (default rules).
      const points = pointsOf.has(p) ? pointsOf.get(p)
        : statKey === 'fieldGoal' ? p.pointsDelta : calculateFantasyPoints({ [statKey]: p.tdDelta }, rules);
      return { ...p, statKey, points };
    })
    .filter((p) => p.points >= minPoints);
  if (big.length === 0) return [];

  const teamIds = scored.flatMap((m) => [m.homeTeamId, m.awayTeamId]);
  const [starters, owners, stats] = await Promise.all([
    db.query(
      `SELECT "team_id", "player_id" FROM "lineup_entries"
       WHERE "team_id" = ANY($1::int[]) AND "season" = $2 AND "week" = $3
         AND "slot" NOT IN ('BENCH', 'IR') AND "player_id" = ANY($4::int[])`,
      [teamIds, season, week, big.map((p) => p.playerId)]
    ),
    db.query(`SELECT "id", "owner_id" FROM "teams" WHERE "id" = ANY($1::int[])`, [teamIds]),
    db.query(
      `SELECT "player_id", "stats" FROM "player_stats"
       WHERE "player_id" = ANY($1::int[]) AND "season" = $2 AND "week" = $3`,
      [big.map((p) => p.playerId), season, week]
    ),
  ]);
  const ownerOf = new Map(owners.rows.map((r) => [r.id, r.owner_id]));
  const statsOf = new Map(stats.rows.map((r) => [r.player_id, r.stats || {}]));

  const out = [];
  for (const m of scored) {
    // A stat correction on a finished game is not a live play.
    if (m.status === 'played' || m.status === 'final') continue;
    const playsFor = (teamId) => big.filter((p) =>
      starters.rows.some((s) => s.team_id === teamId && s.player_id === p.playerId));
    const sides = [
      { teamId: m.homeTeamId, own: playsFor(m.homeTeamId) },
      { teamId: m.awayTeamId, own: playsFor(m.awayTeamId) },
    ];
    const qualifying = [...sides[0].own, ...sides[1].own];
    if (qualifying.length === 0) continue;
    // The fingerprint's count is the player's running total of that stat, so a
    // later touchdown by the same player is a new push, not a ledger repeat.
    const fingerprint = qualifying
      .map((p) => `${p.playerId}:${p.statKey}:${Number((statsOf.get(p.playerId) || {})[p.statKey]) || p.tdDelta}`)
      .sort().join(',');
    for (const side of sides) {
      const userId = ownerOf.get(side.teamId);
      if (userId == null) continue;
      out.push({ userId, matchupId: m.matchupId, fingerprint, qualifying, side });
    }
  }
  return out;
}

/**
 * Push each owner their own matchup's score news (#2107), after the scoring
 * pass has committed: a lead change (home | away | tied), and once the matchup
 * reaches `played` (every starter's game over, the status scoreMatchups
 * attaches per ADR 0030). The leader is remembered in the push_events ledger:
 * the owner's latest `score-lead` row for the matchup holds `<leader>:<n>`, and
 * a push goes out only when the leader differs from it, at most one per owner
 * per five minutes (the live poll can flip a close game every 30 seconds). The counter n keeps a return
 * to an earlier leader (home, away, home) from hitting the ledger's unique key.
 * The first scoring of a week records the leader without a push.
 */
async function scoreLeadRecipients({ scored }, db) {
  return eachSafe('score-lead', scored, async (m) => {
    if (m.status === 'final') return []; // the result is written; nothing is news
    // Once played, the Final push is the news; a later stat correction must not
    // send a lead change to someone already told the result.
    if (m.status === 'played') return [];
    const subject = String(m.matchupId);
    const leader = leaderOf(m);
    const out = [];
    const sides = await matchupSides(db, m);
    // The preference is read here, before the silent record, so a Manager who
    // turns Score update on mid-game starts from a fresh record, not a push.
    const wanting = new Set(await prefs.usersWanting(sides.map((s) => s.mine.owner_id), 'scoreUpdates'));
    for (const s of sides) {
      const userId = s.mine.owner_id;
      if (!wanting.has(userId)) continue;
      // Each owner compares against their own last row, so a capped owner
      // (below) still gets the change once the cap lapses.
      const prev = await db.query(
        `SELECT "fingerprint" FROM "push_events"
         WHERE "user_id" = $1 AND "kind" = 'score-lead' AND "subject" = $2
         ORDER BY "created_at" DESC LIMIT 1`,
        [userId, subject]
      );
      if (!prev.rows[0]) {
        await db.query(
          `INSERT INTO "push_events" ("user_id", "kind", "subject", "fingerprint")
           VALUES ($1, 'score-lead', $2, $3) ON CONFLICT DO NOTHING`,
          [userId, subject, `${leader}:0`]
        );
        continue;
      }
      const [prevLeader, n] = prev.rows[0].fingerprint.split(':');
      if (prevLeader === leader) continue;
      out.push({ userId, matchupId: m.matchupId, s, leader, n: Number(n) });
    }
    return out;
  });
}

const KINDS = {
  'big-play': {
    prefKey: 'touchdownCelebrations',
    recipients: bigPlayRecipients,
    once: (facts, r) => ({ subject: String(r.matchupId), fingerprint: r.fingerprint }),
    rate: { perUserMs: LIVE_ALERT_CAP_MS },
    text: ({ leagueId }, r) => {
      const lines = bigPlayLines(r);
      return {
        title: lines.length === 1 ? `Big play: ${bigPlayWhat(r.qualifying[0])}` : `${lines.length} big plays`,
        body: lines.join('\n'),
        url: gameCenter(leagueId),
      };
    },
    banter: (facts, r) => {
      const lines = bigPlayLines(r);
      const first = r.qualifying[0];
      return lines.length > 1
        ? banterFor('bigPlaySeveral', `big-play:${r.matchupId}:${r.fingerprint}`, { count: lines.length })
        : banterFor(r.side.own.includes(first) ? 'bigPlayMine' : 'bigPlayTheirs', `big-play:${r.matchupId}:${r.fingerprint}`, {
          player: first.name,
          event: BIG_PLAY_WORDS[first.type] || first.type,
          points: Math.round(first.points * 10) / 10,
        });
    },
  },

  'score-lead': {
    prefKey: 'scoreUpdates',
    recipients: scoreLeadRecipients,
    once: (facts, r) => ({ subject: String(r.matchupId), fingerprint: `${r.leader}:${r.n + 1}` }),
    // At most one lead push per owner per five minutes; a capped change
    // writes no row, so the next poll still sees the old leader and sends
    // once five minutes pass. The ':0' rows are silent records, not pushes.
    rate: { perUserMs: LIVE_ALERT_CAP_MS, excludeFingerprintLike: '%:0' },
    text: ({ leagueId }, r) => ({
      title: r.leader === 'tied' ? 'Tied up' : r.leader === r.s.side ? 'You took the lead' : 'You lost the lead',
      body: scoreBody(r.s),
      url: gameCenter(leagueId),
    }),
    banter: (facts, r) => banterFor(
      r.leader === 'tied' ? 'tied' : r.leader === r.s.side ? 'leadTaken' : 'leadLost',
      `score-lead:${r.matchupId}:${r.leader}:${r.n + 1}`,
      { mine: r.s.mine.name, theirs: r.s.theirs.name }
    ),
  },

  'score-played': {
    prefKey: 'scoreUpdates',
    recipients: ({ scored }, db) => eachSafe('score-played', scored, async (m) => {
      if (m.status !== 'played') return [];
      const leader = leaderOf(m);
      return (await matchupSides(db, m)).map((s) => ({ userId: s.mine.owner_id, matchupId: m.matchupId, s, leader }));
    }),
    once: (facts, r) => ({ subject: String(r.matchupId), fingerprint: 'played' }),
    text: ({ leagueId }, r) => {
      const result = r.leader === 'tied' ? 'tied' : r.leader === r.s.side ? 'you won' : 'you lost';
      const score = figures(r.s).join('-');
      return {
        title: `Final: ${result} ${score}`,
        body: `Unofficial until the commissioner advances the week. ${scoreBody(r.s)}`,
        url: gameCenter(leagueId),
      };
    },
    banter: (facts, r) => {
      // Compared in hundredths so 63.1 vs 64.1 (0.9999999999999929 apart) is a full point.
      const lostClose = Math.abs(Math.round(Number(r.s.mineScore) * 100) - Math.round(Number(r.s.theirScore) * 100)) < 100;
      const situation = r.leader === 'tied' ? 'finalTied' : r.leader === r.s.side ? 'finalWon' : lostClose ? 'finalLostClose' : 'finalLost';
      return banterFor(situation, `score-played:${r.matchupId}:played`, { mine: r.s.mine.name, theirs: r.s.theirs.name });
    },
  },

  // "Your matchup is close" alerts: at most one per matchup per week. Both
  // owners of any matchup within CLOSE_MARGIN points, but only late in the
  // window (both teams have points on the board), so week-opening 0-0 "ties"
  // don't fire.
  'close-matchup': {
    prefKey: 'closeMatchups',
    recipients: ({ scored }, db) => eachSafe('close-matchup', scored, async (m) => {
      const margin = Math.abs(Number(m.homeScore) - Number(m.awayScore));
      if (m.homeScore <= 0 || m.awayScore <= 0 || margin > CLOSE_MARGIN) return [];
      const owners = await db.query(
        `SELECT "owner_id" FROM "teams" WHERE "id" = ANY($1::int[])`,
        [[m.homeTeamId, m.awayTeamId]]
      );
      return owners.rows.map((o) => ({ userId: o.owner_id, matchupId: m.matchupId, margin: Math.round(margin * 10) / 10 }));
    }),
    once: ({ week }, r) => ({ subject: `${r.matchupId}:${week}`, fingerprint: 'close' }),
    text: ({ leagueId, week }, r) => ({
      title: 'Your matchup is close!',
      body: `Week ${week}: separated by just ${r.margin} points. Keep watching.`,
      url: gameCenter(leagueId),
    }),
    banter: ({ week }, r) => banterFor('closeMatchup', `close:${r.matchupId}:${week}`, { margin: r.margin, week }),
  },

  // #2106: after the unit commits, one `injuryAlerts` push per manager per player
  // whose designation changed, across every unfinished league that rosters him.
  // Each manager's url is his own first league's lineup page.
  injury: {
    prefKey: 'injuryAlerts',
    recipients: async ({ changes }, db) => {
      if (!changes || changes.length === 0) return [];
      const { rows } = await db.query(
        `SELECT tp."player_id", tp."league_id", t."owner_id", p."name", p."injury_detail"
           FROM "team_players" tp
           JOIN "teams" t ON t."id" = tp."team_id"
           JOIN "players" p ON p."id" = tp."player_id"
           JOIN "leagues" l ON l."id" = tp."league_id"
          WHERE tp."player_id" = ANY($1::int[]) AND l."season_status" != 'complete'
          ORDER BY tp."league_id", tp."id"`,
        [changes.map((c) => c.playerId)]
      );
      const out = [];
      for (const { playerId, currentDesignation } of changes) {
        const rostered = rows.filter((row) => row.player_id === playerId);
        if (rostered.length === 0) continue;
        const label = INJURY_ALERT_LABELS[currentDesignation] || 'healthy';
        const firstLeague = new Map(); // owner -> his lowest league_id (rows arrive ordered)
        for (const row of rostered) if (!firstLeague.has(row.owner_id)) firstLeague.set(row.owner_id, row.league_id);
        for (const [owner, leagueId] of firstLeague) {
          out.push({
            userId: owner, leagueId, playerId, label,
            name: rostered[0].name, injury_detail: rostered[0].injury_detail,
          });
        }
      }
      return out;
    },
    once: ({ day }, r) => ({ subject: String(r.playerId), fingerprint: `${r.label}:${day}` }),
    text: (facts, r) => ({
      title: `${r.name} is now ${r.label}`,
      body: r.injury_detail || '',
      url: `/#/league/${r.leagueId}/lineup`,
    }),
  },

  'ir-action': {
    prefKey: 'irAlerts',
    recipients: async ({ flags }) => (flags || []).map((flag) => ({
      userId: flag.userId, leagueId: flag.leagueId, message: flag.message,
    })),
    text: (facts, r) => ({
      title: 'IR roster action required',
      body: r.message,
      url: `/#/league/${r.leagueId}/lineup`,
    }),
  },

  // Lineup, Pick'em and trade keep their recipient in the facts: the caller
  // already has it for the in-app and email copy.
  'lineup-reminder': {
    prefKey: 'lineupReminder',
    recipients: async ({ team }) => [{ userId: team.owner_id }],
    once: ({ team, season, week }) => ({ subject: `${team.id}:${season}:${week}`, fingerprint: 'sent' }),
    text: ({ leagueId, week, problems }) => ({
      title: 'Set your lineup before kickoff',
      body: `Lineup check for week ${week}: ${problems.join('; ')}`,
      url: `/#/league/${leagueId}/lineup`,
    }),
    banter: ({ team, season, week }) => banterFor('lineupProblem', `lineup-reminder:${team.id}:${season}:${week}:sent`, { week }),
  },

  'pickem-reminder': {
    prefKey: 'pickemReminder',
    recipients: async ({ member }) => [{ userId: member.owner_id }],
    once: ({ league }) => ({ subject: `${league.id}:${league.season}:${league.week}`, fingerprint: 'sent' }),
    text: ({ league, missing }) => ({
      title: "Make your Pick'em picks before kickoff",
      body: `Week ${league.week} Pick'em: ${missing} game${missing === 1 ? '' : 's'} still unpicked before kickoff.`,
      url: `/#/league/${league.id}/pickem`,
    }),
  },

  // The digest window is the newest watermark in the ledger (the fingerprint is
  // the processed_at of the newest digested claim), so a restart does not repeat
  // the last hour.
  //
  // The watermark is a JS Date, which is MILLISECOND precision; processed_at is
  // timestamptz, which is MICROSECOND precision. pg hands the row back already
  // truncated, so a plain `processed_at > $watermark` re-selects the very claim
  // the watermark was advanced to (03:09:53.450243 > 03:09:53.450) on every
  // scheduler tick, and the manager gets the same "WON" email every five
  // minutes until the worker restarts (66 copies, 2026-09-02). The query
  // truncates its side to milliseconds too so both sides compare at the same
  // precision; a claim sharing the newest claim's millisecond is in the same
  // batch, so nothing falls through the gap.
  'waiver-results': {
    prefKey: 'waiverResults',
    recipients: async ({ leagueId }, db) => {
      const last = await db.query(
        `SELECT "fingerprint" FROM "push_events"
         WHERE "kind" = 'waiver-results' AND "subject" = $1
         ORDER BY "created_at" DESC LIMIT 1`,
        [String(leagueId)]
      );
      const since = last.rows[0]
        ? new Date(last.rows[0].fingerprint)
        : new Date(clock.now().getTime() - 60 * 60 * 1000);
      const claims = await db.query(
        `SELECT "waiver_claims"."status", "waiver_claims"."note", "waiver_claims"."bid",
                "waiver_claims"."processed_at",
                "players"."name" AS "player_name",
                "teams"."owner_id", "users"."email", "leagues"."name" AS "league_name"
         FROM "waiver_claims"
         JOIN "teams" ON "teams"."id" = "waiver_claims"."team_id"
         JOIN "users" ON "users"."id" = "teams"."owner_id"
         JOIN "players" ON "players"."id" = "waiver_claims"."player_id"
         JOIN "leagues" ON "leagues"."id" = "waiver_claims"."league_id"
         WHERE "waiver_claims"."league_id" = $1
           AND "waiver_claims"."status" IN ('won', 'lost')
           AND date_trunc('milliseconds', "waiver_claims"."processed_at") > $2`,
        [leagueId, since]
      );
      if (claims.rows.length === 0) return [];
      // Advance to the newest digested claim (not now()) so nothing processed
      // between this query and the ledger write can slip through the gap.
      const newest = claims.rows.reduce(
        (max, r) => (new Date(r.processed_at) > max ? new Date(r.processed_at) : max),
        since
      );
      const byOwner = new Map();
      for (const row of claims.rows) {
        if (!byOwner.has(row.owner_id)) {
          byOwner.set(row.owner_id, { userId: row.owner_id, email: row.email, leagueName: row.league_name, lines: [], newest });
        }
        const bid = Number(row.bid) > 0 ? ` ($${row.bid})` : '';
        byOwner.get(row.owner_id).lines.push(
          row.status === 'won'
            ? `WON: ${row.player_name}${bid}`
            : `LOST: ${row.player_name}${bid}${row.note ? ` · ${row.note}` : ''}`
        );
      }
      return [...byOwner.values()];
    },
    once: ({ leagueId }, r) => ({ subject: String(leagueId), fingerprint: r.newest.toISOString() }),
    text: ({ leagueId }, r) => ({
      title: `Waiver results: ${r.leagueName}`,
      body: r.lines.join(' · '),
      url: `/#/league/${leagueId}/waivers`,
    }),
  },

  'draft-reminder': {
    prefKey: 'draftReminders',
    recipients: ({ league }, db) => managersOfLeague(league, db),
    // A rescheduled draft is a new state, so it reminds again.
    once: ({ league, action }) => ({
      subject: String(league.id),
      fingerprint: `${action}:${new Date(league.draft_date).toISOString()}`,
    }),
    text: ({ league, action }) => ({
      title: 'Draft reminder',
      body: `${league.name}'s draft starts ${action === 'remind_1h' ? 'in about an hour' : 'in about 24 hours'}.`,
      url: `/#/league/${league.id}/draft`,
    }),
  },

  'draft-starting': {
    prefKey: 'draftReminders',
    recipients: ({ league }, db) => managersOfLeague(league, db),
    // A reset or rolled-over draft starts again under the same league id, so
    // the draft date is part of the state.
    once: ({ league }) => ({ subject: String(league.id), fingerprint: `start:${new Date(league.draft_date).toISOString()}` }),
    text: ({ league }) => ({
      title: 'Draft starting now',
      body: `${league.name}'s draft is live. Join the room.`,
      url: `/#/league/${league.id}/draft`,
    }),
    banter: ({ league }) => banterFor('draftStarting', `draft:${league.id}`, { league: league.name }),
  },

  'trade-offer': {
    prefKey: 'tradeOffers',
    recipients: async ({ otherTeamOwnerId }) => [{ userId: otherTeamOwnerId }],
    text: ({ myTeamName, leagueId }) => ({
      title: 'New trade offer',
      body: `${myTeamName} sent you a trade offer`,
      url: `/#/league/${leagueId}/trades`,
    }),
  },

  // Test alert (CONTEXT.md, Push alerts): one Push alert a Manager sends to
  // their own devices from Notification Settings, to see what an alert looks
  // like on the device in hand. The facts are sample facts, named as such. The
  // Banter line is drawn from one of the real situations with a fresh seed per
  // send, so a second tap reads differently; it joins the body at delivery only
  // for a Manager whose Banter preference is on, as every alert does. No ledger
  // and no preference gate: a test goes only where the Manager asked for it.
  test: {
    prefKey: null,
    recipients: async ({ userId, now = Date.now() }) => [{ userId, now }],
    text: () => ({
      title: 'Test alert',
      body: 'Sent from your Notification Settings. A real alert puts its facts here.',
      url: '/#/settings/notifications',
    }),
    banter: (facts, r) => banterFor(SITUATIONS[r.now % SITUATIONS.length], `push-test:${r.userId}:${r.now}`, {
      mine: 'Your Squad',
      theirs: 'The Other Guys',
      player: 'Sample Player',
      event: 'rushing touchdown',
      points: 6.5,
      count: 3,
      margin: 2.5,
      week: 1,
      league: 'Your League',
    }),
  },
};

async function deliver(kind, row, facts) {
  // Looked up here, not at load, so a test can stand in for the web-push send.
  const push = require('./push.service');
  let recipients = [];
  let sent = 0;
  const fresh = [];
  try {
    recipients = (await row.recipients(facts, pool)).filter((r) => r.userId != null);
    const wanted = row.prefKey == null
      ? null
      : new Set(await prefs.usersWanting(recipients.map((r) => r.userId), row.prefKey));
    for (const r of recipients) {
      if (wanted && !wanted.has(r.userId)) continue;
      try {
        if (row.rate) {
          const { perUserMs, excludeFingerprintLike } = row.rate;
          const cutoff = new Date(clock.now().getTime() - perUserMs);
          const capped = await pool.query(
            `SELECT 1 FROM "push_events" WHERE "user_id" = $1 AND "kind" = $2 AND "created_at" > $3` +
            `${excludeFingerprintLike ? ' AND "fingerprint" NOT LIKE $4' : ''} LIMIT 1`,
            excludeFingerprintLike ? [r.userId, kind, cutoff, excludeFingerprintLike] : [r.userId, kind, cutoff]
          );
          if (capped.rows.length > 0) continue;
        }
        if (row.once) {
          const { subject, fingerprint } = row.once(facts, r);
          const inserted = await pool.query(
            `INSERT INTO "push_events" ("user_id","kind","subject","fingerprint") VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING "user_id"`,
            [r.userId, kind, subject, fingerprint]
          );
          if (inserted.rows.length === 0) continue;
        }
        const payload = row.text(facts, r);
        if (row.banter) payload.banter = row.banter(facts, r);
        // Once the ledger row is in, the decision to alert is made and delivery
        // is best effort: a send failure is logged and the row stays.
        fresh.push(r);
        sent += (await push.sendPushToUsers([r.userId], payload)).sent;
      } catch (err) {
        console.error('push alert %s failed:', kind, err.message);
      }
    }
  } catch (err) {
    console.error('push alert %s failed:', kind, err.message);
  }
  return { sent, skipped: recipients.length - fresh.length, fresh };
}

/**
 * Send one Push alert. `kind` names a row of KINDS and the rest are the event's
 * facts (never a user list). Throws on an unknown kind (a programming error);
 * otherwise never throws. Returns { sent, skipped, fresh }: `fresh` are the
 * recipients that passed the preference gate, the rate rule and the ledger and
 * were handed to the web-push adapter (whether or not a device was subscribed),
 * `sent` sums the adapter's counts, `skipped` counts the recipients dropped.
 */
function sendAlert({ kind, ...facts }) {
  if (!Object.hasOwn(KINDS, kind)) throw new Error(`unknown push alert kind: ${kind}`);
  return deliver(kind, KINDS[kind], facts);
}

module.exports = { sendAlert };
