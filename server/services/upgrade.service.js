const pool = require('../modules/pool');
const { withTransaction } = require('../modules/withTransaction');
// Kept whole (not destructured): each is a seam a test replaces with
// `t.mock.method`, and a destructured binding is captured at require time.
const projectionService = require('./projection.service');
const lineupService = require('./lineup.service');
const { optimalLineup } = require('./lineupOptimizer');
const { loadIdentityIdsFor } = require('./playerIdentity.service');
const { normalizeNflTeam } = require('./nflTeam');
const { round2 } = require('./scoringRules');

/**
 * The Upgrade and the Swap net (CONTEXT.md), one module for every caller: the
 * Decision card, the Players page and the Upgrade accuracy script. Two entries:
 * `upgradesFor`, the live read (database in, Maps out), and `upgradeOver`, the
 * pure core it and the script share. The Upgrade reads Start verdicts and
 * produces none (ADR 0061); a Free agent's or waiver player's Upgrade is read
 * in his first playable week (#2166, ADR 0062).
 */

const UPGRADE_CANDIDATE = Symbol('upgrade-candidate');

/**
 * The optimal assignment over `roster` (sorted by `playerId`), with
 * `candidate` (`{ position, projection }`) added when given. A kicked-off
 * starter is pinned to his slot and a kicked-off bench player is no candidate.
 */
function bestLineup(roster, rosterSlots, candidate = null) {
  const pointsFor = new Map(roster.map((r) => [r.playerId, Number(r.projection) || 0]));
  const { pinned, candidates: pool } = lineupService.heldLineup(roster.map((r) => ({ ...r, locked: r.kickedOff })));
  if (candidate) {
    pointsFor.set(UPGRADE_CANDIDATE, Number(candidate.projection) || 0);
    pool.push({ playerId: UPGRADE_CANDIDATE, position: candidate.position });
  }
  return optimalLineup({ rosterSlots, candidates: pool, pointsFor, pinned });
}

/**
 * The Upgrade (ADR 0055): how much `candidate` (`{ position, projection }`)
 * adds to the caller's optimal lineup for the week: the optimal total with him
 * on the roster minus the optimal total without him, never below 0.
 *
 * `roster` is `[{ playerId, name, position, slot, projection, unavailable, kickedOff }]`,
 * IR excluded; an Unavailable player arrives with `projection` 0 and his reason
 * in `unavailable`.
 *
 * `overPlayer` is the roster player in the optimal lineup without the
 * candidate who is not in the one with him (`points` is his own effective
 * projection), null when the candidate fills an empty slot or gains nothing;
 * `slot` is the slot the candidate takes (null when he takes none).
 *
 * Order-invariant: the optimizer is deterministic only for a fixed input
 * order, and the roster read has no ORDER BY, so `roster` is sorted by
 * `playerId` here. Without it, which of two tied players `overPlayer` names
 * would change between page loads.
 */
function upgradeFor(candidate, unsortedRoster, rosterSlots) {
  const roster = [...unsortedRoster].sort((a, b) => a.playerId - b.playerId);
  const without = bestLineup(roster, rosterSlots);
  const withHim = bestLineup(roster, rosterSlots, candidate);
  const points = Math.max(0, round2(withHim.total - without.total));
  const out = points > 0
    ? roster.find((r) => without.byPlayer.has(r.playerId) && !withHim.byPlayer.has(r.playerId))
    : null;
  return {
    points,
    overPlayer: out
      ? { id: out.playerId, name: out.name ?? null, points: round2(Number(out.projection) || 0), unavailable: out.unavailable ?? null }
      : null,
    slot: withHim.byPlayer.get(UPGRADE_CANDIDATE) ?? null,
  };
}

/**
 * What claiming `candidate` nets once the manager's pick `dropPlayerId` leaves
 * the roster (ADR 0062): the optimal lineup with him in and the drop out, minus
 * the optimal lineup `roster` fields now. Signed, so it goes negative when the
 * drop is worth more than the candidate. The Upgrade itself never takes the drop.
 */
function swapNetFor(candidate, unsortedRoster, rosterSlots, dropPlayerId) {
  const roster = [...unsortedRoster].sort((a, b) => a.playerId - b.playerId);
  const kept = roster.filter((r) => r.playerId !== Number(dropPlayerId));
  return round2(bestLineup(kept, rosterSlots, candidate).total - bestLineup(roster, rosterSlots).total);
}

/**
 * Pure core. `roster` is the team's lineup rows, IR excluded (`playerId`,
 * `slot`, `name`, `position`, `kickedOff`), `candidate` is `{ id, position }`
 * and `run` a Weekly projection read (`pointsFor`, `startVerdictFor`). Returns
 * `{ upgrade, swapNet }`: `upgrade` is null when the Start verdict refuses the
 * candidate (Unavailable this week, or Not recommended with an untrusted
 * number: Position-baseline, #1809, or Backup quarterback, ADR 0057; Doubtful
 * keeps a trusted number and so his Upgrade); `swapNet` is a number only when
 * `dropPlayerId` is given and the candidate was not refused.
 *
 * A roster player who is Unavailable this week (bye, Out, IR, No NFL team,
 * Practice squad: the engine keeps his full estimate, ADR 0044, but he adds
 * nothing to the lineup) or a Backup quarterback counts as 0, with the reason
 * riding along as `unavailable` so `overPlayer` can say "zero because
 * Unavailable" (#1793). Backup outranks Position-baseline in the verdict (ADR
 * 0057, amended 2026-10-07), so a rostered QB who is both is still zeroed.
 */
function upgradeOver({ roster, candidate, run, rosterSlots, dropPlayerId = null }) {
  const verdict = run.startVerdictFor(candidate.id);
  if (verdict.outcome === 'unavailable' || (verdict.outcome === 'not_recommended' && !verdict.numberTrusted)) {
    return { upgrade: null, swapNet: null };
  }
  const rows = roster.map((r) => {
    const v = run.startVerdictFor(r.playerId);
    const zeroReason = v.outcome === 'unavailable'
      ? (v.reason || 'out') // a stored verdict without a reason still zeroes him
      : (v.reason === 'backup' ? 'backup' : null);
    return { ...r, projection: zeroReason ? 0 : run.pointsFor(r.playerId), unavailable: zeroReason };
  });
  const asCandidate = { position: candidate.position ?? null, projection: run.pointsFor(candidate.id) };
  return {
    upgrade: upgradeFor(asCandidate, rows, rosterSlots),
    swapNet: dropPlayerId !== null ? swapNetFor(asCandidate, rows, rosterSlots, dropPlayerId) : null,
  };
}

/**
 * `Map<playerId, week | null>` (#2166, ADR 0062): the first playable week of
 * every candidate. A Free agent joins now, a player on waivers at his Clear
 * time (his own when he has a waiver row, else the league's blanket one), and his
 * first playable week is the first week from `week` through the league's last
 * playoff week whose game for his NFL team kicks off after that. A bye (no
 * game row) is skipped; none left means `null`. Clear times are compared with
 * `now` here rather than in SQL, so a test injects the clock. Another team's
 * player (#2167) joins when a trade could first complete: now, or now plus
 * `trade_review_hours` when the league reviews trades (`trade_veto_votes > 0`
 * and `trade_review_hours > 0`), an immediate accept being the only fair upper
 * bound. A team with no game row anywhere in the window (an unsynced schedule,
 * which locks nobody either) keeps the current week.
 */
async function firstPlayableWeeks({ league, season, week, now, candidateIds, identityIdsById, nflTeamById }) {
  const weekById = new Map();
  if (candidateIds.length === 0) return weekById;
  const lastWeek = projectionService.lastPlayoffWeek(league);
  const identityIds = [...new Set(candidateIds.flatMap((id) => identityIdsById.get(id) || [id]))];

  const [scheduleResult, waiverResult, rosteredResult] = await Promise.all([
    pool.query(
      `SELECT "nfl_team", "week", "kickoff_at" FROM "nfl_games"
       WHERE "season" = $1 AND "week" >= $2 AND "week" <= $3`,
      [season, week, lastWeek]
    ),
    pool.query(
      `SELECT "player_id", "available_at" FROM "waiver_players"
       WHERE "league_id" = $1 AND "player_id" = ANY($2::int[])`,
      [league.id, identityIds]
    ),
    pool.query(
      `SELECT "player_id" FROM "team_players" WHERE "league_id" = $1 AND "player_id" = ANY($2::int[])`,
      [league.id, identityIds]
    ),
  ]);
  // Kickoffs by normalised team, then by week: a week with no entry is a bye.
  const kickoffsByTeam = new Map();
  for (const row of scheduleResult.rows) {
    const nflTeam = normalizeNflTeam(row.nfl_team);
    if (nflTeam === null) continue;
    if (!kickoffsByTeam.has(nflTeam)) kickoffsByTeam.set(nflTeam, new Map());
    kickoffsByTeam.get(nflTeam).set(Number(row.week), new Date(row.kickoff_at));
  }
  const clearAt = new Map();
  for (const row of waiverResult.rows) {
    const at = new Date(row.available_at);
    if (!clearAt.has(row.player_id) || at > clearAt.get(row.player_id)) clearAt.set(row.player_id, at);
  }
  const rosteredElsewhere = new Set(rosteredResult.rows.map((r) => r.player_id));
  const blanket = league.waivers_clear_at ? new Date(league.waivers_clear_at) : null;

  for (const id of candidateIds) {
    const identities = identityIdsById.get(id) || [id];
    const kickoffs = kickoffsByTeam.get(normalizeNflTeam(nflTeamById.get(id)));
    if (!kickoffs) {
      weekById.set(id, week);
      continue;
    }
    let joinAt;
    if (identities.some((identityId) => rosteredElsewhere.has(identityId))) {
      // Another team's player (#2167): he joins when a trade could first
      // complete, assuming an immediate accept: now, or now plus the review
      // window when the league reviews trades (same predicate as
      // `respondToTrade`).
      const reviewed = league.trade_veto_votes > 0 && league.trade_review_hours > 0;
      joinAt = reviewed ? new Date(now.getTime() + league.trade_review_hours * 3600 * 1000) : now;
    } else {
      // His own clear time when he has a waiver row (the latest across his
      // identities), else the league's blanket one, else now: the same
      // COALESCE(own, blanket, now) `processWaivers` resolves a claim with. A
      // clear time already past means he can join now.
      const own = identities.map((identityId) => clearAt.get(identityId)).filter(Boolean)
        .reduce((latest, at) => (latest && latest > at ? latest : at), null);
      const clearsAt = own ?? blanket;
      joinAt = clearsAt && clearsAt > now ? clearsAt : now;
    }
    let first = null;
    for (let wk = week; wk <= lastWeek && first === null; wk++) {
      const kickoff = kickoffs.get(wk);
      if (kickoff && kickoff > joinAt) first = wk;
    }
    weekById.set(id, first);
  }
  return weekById;
}

/**
 * The live read for the caller's league and team: `{ upgrades, swapNets,
 * pointsFor, run }`. `upgrades` maps each candidate id to `{ points,
 * overPlayer, slot, week }` or null; `swapNets` maps it to `{ points, week }`
 * when `dropPlayerId` (#2168) is given; `pointsFor(id)` is the candidate's
 * projection from his own first playable week's read (the Players page's
 * Upgrade-sort tie-break, #1911); `run` is the current week's Weekly projection
 * read, which the Decision card also reads its projected points, Volatility,
 * Start verdict and opponent rank from, so the card and its Upgrade stay one
 * producer call. `now` (default the current time) is the clock Clear times and
 * kickoffs are compared with.
 *
 * Materializes the caller's lineup inside a transaction, reading every entry
 * but IR with whether his game has kicked off (ADR 0055), then makes ONE
 * `getWeeklyProjections` call for the current week over those players and
 * every candidate, plus one per distinct LATER first playable week (the roster
 * and that week's candidates, no kickoff hold: nothing has kicked off yet).
 *
 * The upgrade is null for a candidate in a best-ball league (undefined there,
 * ADR 0040), already on the caller's roster (checked over his FULL identity
 * set: a duplicate-source row for a rostered athlete must still read as "already
 * yours", formal review f1), with No NFL team (the engine still carries his old
 * per-game pace until v3.2, #1438 story 5), with no playable week through the
 * league's last playoff week, or refused by `upgradeOver`.
 */
async function upgradesFor({ league, team, week, candidateIds, dropPlayerId = null, now = new Date(), season = league.current_season }) {
  const ids = [...new Set((candidateIds || []).map(Number).filter(Number.isInteger))];
  const settings = lineupService.parseLineupSettings(league);

  const { rosterRows, kickedOffIds } = await withTransaction(
    pool,
    async (client) => {
      await lineupService.materializeLineup(client, {
        leagueId: league.id, teamId: team.id, season, week, league,
      });
      const result = await client.query(
        `SELECT "lineup_entries"."player_id", "lineup_entries"."slot", "players"."name",
                "players"."position", "players"."nfl_team"
         FROM "lineup_entries"
         JOIN "players" ON "players"."id" = "lineup_entries"."player_id"
         WHERE "lineup_entries"."team_id" = $1 AND "lineup_entries"."season" = $2 AND "lineup_entries"."week" = $3
           AND "lineup_entries"."slot" <> 'IR'`,
        [team.id, season, week]
      );
      // Whose game has kicked off: the same predicate the lineup lock uses.
      const kicked = await lineupService.lockedPlayerIds(client, {
        season, week, now, players: result.rows.map((r) => ({ id: r.player_id, nflTeam: r.nfl_team })),
      });
      return { rosterRows: result.rows, kickedOffIds: kicked };
    },
    // A unique label - the guard (scripts/handRolledTransactionGuard.test.js)
    // requires every withTransaction call site to carry one.
    { label: 'player-card' }
  );

  const rosterResult = await pool.query(
    `SELECT "player_id" FROM "team_players" WHERE "team_id" = $1`,
    [team.id]
  );
  const ownRosterIds = new Set(rosterResult.rows.map((r) => r.player_id));

  const playersResult = ids.length > 0
    ? await pool.query(`SELECT "id", "position", "nfl_team" FROM "players" WHERE "id" = ANY($1::int[])`, [ids])
    : { rows: [] };
  const positionById = new Map(playersResult.rows.map((r) => [r.id, r.position]));
  const nflTeamById = new Map(playersResult.rows.map((r) => [r.id, r.nfl_team]));
  const noNflTeamIds = new Set(playersResult.rows.filter((r) => r.nfl_team == null).map((r) => r.id));

  // One identity read for every candidate, whatever N is.
  const identityIdsById = await loadIdentityIdsFor(ids);

  const hasNoUpgrade = (id) => league.best_ball
    || noNflTeamIds.has(id)
    || (identityIdsById.get(id) || [id]).some((identityId) => ownRosterIds.has(identityId));
  // Who is read in which week (#2166, ADR 0062): only the rest need one.
  const readable = ids.filter((id) => !hasNoUpgrade(id));
  const weekById = await firstPlayableWeeks({
    league, season, week, now, candidateIds: readable, identityIdsById, nflTeamById,
  });

  const rosterIds = rosterRows.map((r) => r.player_id);
  // `getWeeklyProjections` handles an empty player set, returning a valid
  // (all-null) result, so every reader goes through the same `pointsFor`.
  const run = await projectionService.getWeeklyProjections({
    season, week, league, playerIds: [...new Set([...rosterIds, ...ids])],
  });
  const runsByWeek = new Map([[week, run]]);
  const laterWeeks = [...new Set([...weekById.values()].filter((w) => w !== null && w !== week))].sort((a, b) => a - b);
  for (const laterWeek of laterWeeks) {
    const candidatesThatWeek = readable.filter((id) => weekById.get(id) === laterWeek);
    runsByWeek.set(laterWeek, await projectionService.getWeeklyProjections({
      season, week: laterWeek, league, playerIds: [...new Set([...rosterIds, ...candidatesThatWeek])],
    }));
  }

  const rosterFor = (isCurrentWeek) => rosterRows.map((r) => ({
    playerId: r.player_id,
    slot: r.slot,
    name: r.name,
    position: r.position,
    kickedOff: isCurrentWeek && kickedOffIds.has(r.player_id),
  }));

  const upgrades = new Map();
  const swapNets = new Map();
  for (const id of ids) {
    const candidateWeek = weekById.get(id);
    if (hasNoUpgrade(id) || candidateWeek === null) {
      upgrades.set(id, null);
      continue;
    }
    const { upgrade, swapNet } = upgradeOver({
      roster: rosterFor(candidateWeek === week),
      candidate: { id, position: positionById.get(id) ?? null },
      run: runsByWeek.get(candidateWeek),
      rosterSlots: settings.rosterSlots,
      dropPlayerId,
    });
    upgrades.set(id, upgrade && { ...upgrade, week: candidateWeek });
    if (swapNet !== null) swapNets.set(id, { points: swapNet, week: candidateWeek });
  }

  const pointsFor = (id) => (runsByWeek.get(weekById.get(id)) ?? run).pointsFor(id);
  return { upgrades, swapNets, pointsFor, run };
}

module.exports = { upgradesFor, upgradeOver };
