/**
 * Flood control for League chat sends (#440, flood resistance).
 *
 * This is the enforcement half of "a member cannot overwhelm the feed": a pure
 * decision over a caller-owned store, kept free of socket/req plumbing so it is
 * unit-testable without a server (the same shape as modules/rateLimit.hit). The
 * socket handler in draftSocket.js owns one process-local store and calls
 * checkChatSend per `chat:send`; a blocked send is answered with an explicit
 * retry time and NOTHING is persisted (ADR: rate-limit responses "never silently
 * drop content" - the sender keeps their text and is told when to try again).
 *
 * TWO WINDOWS, BOTH MUST PASS. A member's text is capped at BOTH 5 per 10s (a
 * burst) AND 30 per 60s (a sustained rate); a send is allowed only when it is
 * under every applicable ceiling. GIF sends (delivered by the provider-gated
 * work in #446, which calls this module with kind 'gif') are capped harder: one
 * per 10s per member, plus a separate LEAGUE-WIDE burst ceiling so a coordinated
 * group cannot fill the feed with animation even while each member stays under
 * their own per-member limit.
 *
 * NO PARTIAL CONSUMPTION. Because a send must clear several windows at once, the
 * check is two-phase: every limit is evaluated first, and a hit is recorded
 * against every limit ONLY when all of them pass. Recording as we go (the shape
 * of a naive `hit()` chain) would let a send that is ultimately blocked by a
 * later window still consume capacity in an earlier one, so a blocked sender
 * would be penalised twice.
 *
 * WHY PROCESS-LOCAL. socket.io draft/chat sessions are sticky to one instance,
 * so a per-process store sees all of a member's sends. This mirrors
 * rateLimit.js's local fallback; it is intentionally not Redis-backed because
 * the ceiling is a flood guard, not a billing counter, and a brief per-instance
 * split after a failover costs at most a few extra messages.
 */

const TEN_SECONDS = 10_000;
const ONE_MINUTE = 60_000;

// Per-member text ceilings (#440 acceptance criteria: five per ten seconds and
// thirty per minute).
const TEXT_PER_10S = 5;
const TEXT_PER_60S = 30;

// GIF ceilings: one per ten seconds per member, and a league-wide burst ceiling
// across all members (#440). The league-wide number is deliberately small - a
// GIF is heavier than a line of text, and the ceiling exists to stop a flood,
// not to ration ordinary use.
const GIF_PER_10S = 1;
const GIF_LEAGUE_PER_10S = 5;

/**
 * The limits that apply to each message kind. `scope` decides whose bucket the
 * limit draws from: 'member' is per (league, sender), 'league' is per league
 * across every sender.
 */
const LIMITS = {
  text: [
    { scope: 'member', windowMs: TEN_SECONDS, max: TEXT_PER_10S },
    { scope: 'member', windowMs: ONE_MINUTE, max: TEXT_PER_60S },
  ],
  gif: [
    { scope: 'member', windowMs: TEN_SECONDS, max: GIF_PER_10S },
    { scope: 'league', windowMs: TEN_SECONDS, max: GIF_LEAGUE_PER_10S },
  ],
};

/** A limit's bucket key. The windowMs is part of the key so a member's two text
 *  windows (10s and 60s) are counted independently in the one store. */
function bucketKey(limit, leagueId, userId) {
  const scope = limit.scope === 'league' ? `L:${leagueId}` : `U:${leagueId}:${userId}`;
  return `${scope}:${limit.windowMs}`;
}

/**
 * Prune the bucket to the entries still inside `windowMs` of `now` and return
 * them. Pruning is lazy (only on access) and writes the shortened array back so
 * the store cannot grow without bound.
 */
function liveHits(store, key, now, windowMs) {
  const windowStart = now - windowMs;
  const prior = store.get(key) || [];
  const kept = prior.filter((t) => t > windowStart);
  if (kept.length !== prior.length) store.set(key, kept);
  return kept;
}

/**
 * Decide whether one `chat:send` may proceed, and record it if so.
 *
 * @param {Map<string, number[]>} store - caller-owned bucket store
 * @param {{ leagueId:number, userId:number, kind?:'text'|'gif', now:number }} ctx
 * @returns {{ allowed:boolean, retryAfterMs:number, retryAfterSeconds:number }}
 */
function checkChatSend(store, { leagueId, userId, kind = 'text', now } = {}) {
  const limits = LIMITS[kind];
  if (!limits) throw new Error(`unknown chat kind: ${kind}`);

  // Phase 1: evaluate every ceiling without recording. The retry time is the
  // longest wait across the ceilings this send trips - it is not allowed until
  // the most-constrained one frees.
  let retryAfterMs = 0;
  for (const limit of limits) {
    const hits = liveHits(store, bucketKey(limit, leagueId, userId), now, limit.windowMs);
    if (hits.length >= limit.max) {
      retryAfterMs = Math.max(retryAfterMs, hits[0] + limit.windowMs - now);
    }
  }
  if (retryAfterMs > 0) {
    return { allowed: false, retryAfterMs, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  // Phase 2: all clear - record this send against every ceiling at once.
  for (const limit of limits) {
    const key = bucketKey(limit, leagueId, userId);
    const arr = store.get(key) || [];
    arr.push(now);
    store.set(key, arr);
  }
  return { allowed: true, retryAfterMs: 0, retryAfterSeconds: 0 };
}

module.exports = {
  checkChatSend,
  TEN_SECONDS,
  ONE_MINUTE,
  TEXT_PER_10S,
  TEXT_PER_60S,
  GIF_PER_10S,
  GIF_LEAGUE_PER_10S,
};
