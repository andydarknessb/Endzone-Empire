/* Median-delta release gate: v3 (replay-head.json) vs v3.1 (replay-v31-run1.json).
 * Read-only DB access: positions + actual stats for scoring. */
require('c:/Users/Cory/Endzone-Empire/node_modules/dotenv').config({ path: 'c:/Users/Cory/Endzone-Empire/.env' });
const fs = require('fs');
const pool = require('c:/Users/Cory/Endzone-Empire/server/modules/pool');
const { SCORING_RULES, calculateFantasyPoints } = require('c:/Users/Cory/Endzone-Empire/server/services/scoring.service');
const { DEFAULT_ROSTER_SLOTS } = require('c:/Users/Cory/Endzone-Empire/server/services/lineup.service');
const { optimalAssignment } = require('c:/Users/Cory/Endzone-Empire/server/services/lineupOptimizer');
const bt = require('c:/Users/Cory/Endzone-Empire/scripts/backtest-weekly-projections.js');

const s = 'C:/Users/Cory/AppData/Local/Temp/claude/c--Users-Cory-Endzone-Empire/15b5b31f-2001-4752-8a5e-a7298bde9fba/scratchpad';
const v3 = JSON.parse(fs.readFileSync(`${s}/replay-head.json`, 'utf8')).rows;
const v31 = JSON.parse(fs.readFileSync(`${s}/replay-v31-run1.json`, 'utf8')).rows;
const key = (r) => `${r[0]}:${r[1]}:${r[2]}`;
const v31Map = new Map(v31.map((r) => [key(r), r]));

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

(async () => {
  try {
    const posResult = await pool.query('SELECT "id", "position" FROM "players"');
    const posById = new Map(posResult.rows.map((r) => [r.id, r.position]));
    const actualsResult = await pool.query(
      `SELECT "ps"."player_id", "ps"."season", "ps"."week", "ps"."stats"
       FROM "player_stats" "ps" JOIN "players" "p" ON "p"."id" = "ps"."player_id"
       WHERE "ps"."season" = ANY($1::int[]) AND "ps"."week" BETWEEN 2 AND 18
         AND "p"."position" = ANY($2::text[])`,
      [[2024, 2025], POSITIONS]
    );
    const actualByKey = new Map(
      actualsResult.rows.map((r) => [`${r.season}:${r.week}:${r.player_id}`,
        calculateFantasyPoints(r.stats, SCORING_RULES)])
    );

    // 1. Median deltas
    let changed = 0;
    const deltas = [];
    const obs3 = [];
    const obs31 = [];
    for (const r3 of v3) {
      const r1 = v31Map.get(key(r3));
      if (!r1) continue;
      const m3 = r3[4];
      const m1 = r1[4];
      if (m3 != null && m1 != null && m3 !== m1) {
        changed += 1;
        deltas.push(Math.abs(m1 - m3));
      }
      const actual = actualByKey.get(key(r3));
      const position = posById.get(r3[2]);
      if (actual == null || !position) continue;
      const base = { season: r3[0], week: r3[1], playerId: r3[2], position, actual };
      obs3.push({ ...base, predicted: m3, p10: r3[5], p90: r3[6] });
      obs31.push({ ...base, predicted: m1, p10: r1[5], p90: r1[6] });
    }
    deltas.sort((a, b) => a - b);
    console.log('=== 1. Median deltas (v3 -> v3.1), all 14,016 rows ===');
    console.log(`  changed medians: ${changed} (${(100 * changed / v3.length).toFixed(1)}%)`);
    if (deltas.length) {
      console.log(`  |delta| among changed: p50=${pct(deltas, 0.5).toFixed(2)} p90=${pct(deltas, 0.9).toFixed(2)} max=${deltas[deltas.length - 1].toFixed(2)} pts`);
    }

    // 2. Ranking inversions within (season, week, position)
    const groups = new Map();
    obs3.forEach((o, i) => {
      const g = `${o.season}:${o.week}:${o.position}`;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    });
    let pairs = 0;
    let inversions = 0;
    for (const idxs of groups.values()) {
      for (let i = 0; i < idxs.length; i++) {
        for (let j = i + 1; j < idxs.length; j++) {
          const a3 = obs3[idxs[i]].predicted; const b3 = obs3[idxs[j]].predicted;
          const a1 = obs31[idxs[i]].predicted; const b1 = obs31[idxs[j]].predicted;
          if ([a3, b3, a1, b1].some((v) => v == null)) continue;
          const s3 = Math.sign(a3 - b3); const s1 = Math.sign(a1 - b1);
          if (s3 === 0 && s1 === 0) continue;
          pairs += 1;
          if (s3 !== s1) inversions += 1;
        }
      }
    }
    console.log('\n=== 2. Weekly/position ranking inversions ===');
    console.log(`  inverted pairs: ${inversions} of ${pairs} comparable pairs (${(100 * inversions / pairs).toFixed(2)}%)`);

    // 3. Start/sit decision changes on the synthetic first-16 rosters
    const byWeek = new Map();
    obs3.forEach((o, i) => {
      const g = `${o.season}:${o.week}`;
      if (!byWeek.has(g)) byWeek.set(g, []);
      byWeek.get(g).push(i);
    });
    let rosterWeeks = 0;
    let changedLineups = 0;
    let regret3Sum = 0;
    let regret31Sum = 0;
    for (const idxs of byWeek.values()) {
      const roster = idxs
        .map((i) => ({ i, playerId: obs3[i].playerId }))
        .sort((a, b) => a.playerId - b.playerId)
        .slice(0, 16);
      if (roster.length < DEFAULT_ROSTER_SLOTS.length) continue;
      rosterWeeks += 1;
      const candidates = roster.map(({ i }) => ({ playerId: obs3[i].playerId, position: obs3[i].position }));
      const actual = new Map(roster.map(({ i }) => [obs3[i].playerId, obs3[i].actual]));
      const pred3 = new Map(roster.map(({ i }) => [obs3[i].playerId, obs3[i].predicted == null ? 0 : obs3[i].predicted]));
      const pred31 = new Map(roster.map(({ i }) => [obs31[i].playerId, obs31[i].predicted == null ? 0 : obs31[i].predicted]));
      const best = optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor: actual });
      const pick = (preds) => optimalAssignment({ rosterSlots: DEFAULT_ROSTER_SLOTS, candidates, pointsFor: preds });
      const c3 = pick(pred3);
      const c31 = pick(pred31);
      const starters = (c) => new Set(c.assignments.filter((a) => a.playerId != null).map((a) => a.playerId));
      const s3set = starters(c3);
      const s31set = starters(c31);
      if (s3set.size !== s31set.size || [...s3set].some((p) => !s31set.has(p))) changedLineups += 1;
      const actualOf = (set) => [...set].reduce((sum, p) => sum + (actual.get(p) || 0), 0);
      regret3Sum += best.total - actualOf(s3set);
      regret31Sum += best.total - actualOf(s31set);
    }
    console.log('\n=== 3. Start/sit decisions (synthetic first-16 rosters; known-flawed proxy) ===');
    console.log(`  roster-weeks: ${rosterWeeks}; lineups that changed v3 -> v3.1: ${changedLineups}`);
    console.log(`  mean regret: v3 ${(regret3Sum / rosterWeeks).toFixed(2)} -> v3.1 ${(regret31Sum / rosterWeeks).toFixed(2)}`);

    // 4. Paired accuracy metric deltas via the backtest's own summarize()
    const fmtS = (x) => ({
      mae: x.mae, rmse: x.rmse, rho: x.spearman, pairAcc: x.accuracy,
      regret: x.meanRegret, cover: x.intervalCoverageP10P90,
    });
    const s3 = fmtS(bt.summarize(obs3));
    const s31 = fmtS(bt.summarize(obs31));
    console.log('\n=== 4. Paired metric deltas (backtest summarize(), identical cohorts) ===');
    for (const k of Object.keys(s3)) {
      const d = (s31[k] ?? 0) - (s3[k] ?? 0);
      console.log(`  ${k.padEnd(8)} v3=${Number(s3[k]).toFixed(4)}  v3.1=${Number(s31[k]).toFixed(4)}  delta=${d >= 0 ? '+' : ''}${d.toFixed(4)}`);
    }
    process.exit(0);
  } catch (err) {
    console.error('FAILED:', err.stack || err.message);
    process.exit(1);
  }
})();
