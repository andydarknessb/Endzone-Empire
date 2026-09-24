/**
 * Waiver-claim read model (ADR 0029: pure, imports nothing). Turns the
 * `GET /api/waivers` body into what the Waivers page slices render: pending
 * claims in Claim order, shared-drop pairs, a result per resolved claim, the
 * next Clear time and the FAAB committed.
 *
 * WIRE NAMES the server ticket (#1607) had not fixed when this was written,
 * so they are read defensively and default to null: `winning_team_name`,
 * `winning_bid` (the Winning bid and its team, on resolved claims), `week`
 * (the week a claim resolved in) and `clear_at` (a pending claim's own Clear
 * time). Claims resolved before those columns exist carry none and read as
 * plain lost.
 *
 * No claim is ever predicted to win (ADR 0048: bid first, each claim resolves
 * at its own player's Clear time), so a shared drop is only reported, never
 * ranked.
 */

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const time = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
};

const EMPTY = Object.freeze({
  pending: [],
  sharedDrops: [],
  results: [],
  resultsByWeek: [],
  nextClearTime: null,
  faab: null,
});

function byClaimOrder(a, b) {
  const ao = a.claim_order == null ? Infinity : a.claim_order;
  const bo = b.claim_order == null ? Infinity : b.claim_order;
  if (ao !== bo) return ao < bo ? -1 : 1;
  const at = time(a.created_at) ?? 0;
  const bt = time(b.created_at) ?? 0;
  if (at !== bt) return at - bt;
  return a.id - b.id;
}

function resultOf(c) {
  const base = {
    id: c.id,
    playerId: c.player_id ?? null,
    playerName: c.player_name ?? null,
    week: num(c.week),
    bid: num(c.bid) ?? 0,
    resolvedAt: c.processed_at ?? null,
  };
  if (c.status === 'won') return { ...base, result: 'won' };
  if (c.status === 'lost') {
    return {
      ...base,
      result: 'lost',
      winningTeam: c.winning_team_name ?? null,
      winningBid: num(c.winning_bid),
    };
  }
  return { ...base, result: 'didnt-go-through', reason: c.note ?? null };
}

/**
 * @param {object|null|undefined} data  the `GET /api/waivers` body
 * @param {{ now?: Date }} [opts]
 */
export function claimsFromResponse(data, { now = new Date() } = {}) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.myClaims)) return EMPTY;
  const claims = data.myClaims.filter((c) => c && typeof c === 'object');

  const pendingRaw = claims.filter((c) => c.status === 'pending').sort(byClaimOrder);

  const byDrop = new Map();
  for (const c of pendingRaw) {
    if (c.drop_player_id == null) continue;
    if (!byDrop.has(c.drop_player_id)) byDrop.set(c.drop_player_id, []);
    byDrop.get(c.drop_player_id).push(c.id);
  }
  const sharedDrops = [...byDrop.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([dropPlayerId, claimIds]) => ({ dropPlayerId, claimIds }));

  const pending = pendingRaw.map((c) => ({
    id: c.id,
    playerId: c.player_id ?? null,
    playerName: c.player_name ?? null,
    dropPlayerId: c.drop_player_id ?? null,
    dropPlayerName: c.drop_player_name ?? null,
    bid: num(c.bid) ?? 0,
    claimOrder: c.claim_order ?? null,
    clearAt: c.clear_at ?? null,
    sharesDropWith:
      c.drop_player_id == null ? [] : (byDrop.get(c.drop_player_id) || []).filter((id) => id !== c.id),
  }));

  const results = claims
    .filter((c) => c.status === 'won' || c.status === 'lost' || c.status === 'invalid')
    .map(resultOf);

  const weeks = new Map();
  for (const r of results) {
    if (!weeks.has(r.week)) weeks.set(r.week, []);
    weeks.get(r.week).push(r);
  }
  const resultsByWeek = [...weeks.entries()]
    .sort(([a], [b]) => (b ?? -Infinity) - (a ?? -Infinity) || 0)
    .map(([week, rs]) => ({ week, results: rs }));

  let nextClearTime = null;
  if (pending.length) {
    const blanket = data.league?.waivers_clear_at ?? null;
    const blanketT = time(blanket);
    if (blanketT !== null && blanketT > now.getTime()) {
      nextClearTime = blanket;
    } else {
      let best = null;
      for (const c of pending) {
        const t = time(c.clearAt);
        if (t !== null && (best === null || t < best.t)) best = { t, v: c.clearAt };
      }
      nextClearTime = best ? best.v : null;
    }
  }

  let faab = null;
  if (data.league?.waiver_type === 'faab') {
    const committed = pending.reduce((s, c) => s + c.bid, 0);
    faab = { committed, left: (num(data.myTeam?.faab_remaining) ?? 0) - committed };
  }

  return { pending, sharedDrops, results, resultsByWeek, nextClearTime, faab };
}
