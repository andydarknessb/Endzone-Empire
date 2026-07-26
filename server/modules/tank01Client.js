/**
 * The single choke point for every Tank01 (RapidAPI) call.
 *
 * The subscription is ~1,000 requests per MONTH, so spend has to be metered,
 * not just rate-limited. Every call goes through `tank01Get`, which:
 *
 *  1. resolves current billing-cycle usage (Postgres `private.api_usage` sums,
 *     reconciled against the provider's own `x-ratelimit-requests-*` headers),
 *  2. gates the call by priority so the budget sheds cheap work first,
 *  3. honors a process-shared 429 backoff, and
 *  4. counts the attempt.
 *
 * Usage lives in Postgres because both Render services spend quota (the web
 * process for news/admin syncs, the worker for the live engine and scheduler)
 * — an in-memory counter in either would see roughly half the truth.
 *
 * Priorities, cheapest to shed first:
 *   low        news (a stale headline is fine — see news.service)
 *   standard   live box scores, Tank01 clock fallback, player/injury/schedule syncs
 *   essential  a finalized game's box score, which serves BOTH final stat
 *              ingest and the recap — the one call we never want to lose
 *
 * Shedding order as usage climbs: `low` stops at the soft limit (80% of
 * budget), `low` + `standard` stop at the budget, everything stops at the hard
 * ceiling. `degraded` mode also asks pollers to double their cadence.
 *
 * Nothing here is a substitute for the free path: historical stats come from
 * nflverse (scripts/backfill-weekly-stats.js --source nflverse) and never
 * touch this module or the counter.
 */
const pool = require('./pool');

const PROVIDER = 'tank01';
const STATE_TTL_MS = 60 * 1000; // memoize the quota read; a tick shouldn't re-query
const SNAPSHOT_FRESH_MS = 24 * 60 * 60 * 1000;
const PRIORITIES = ['low', 'standard', 'essential'];

/** Config is read per call so a deploy-time env change needs no restart. */
function readConfig(overrides = {}) {
  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  const budget = num(overrides.budget ?? process.env.TANK01_MONTHLY_BUDGET, 950);
  const hardCeiling = num(overrides.hardCeiling ?? process.env.TANK01_HARD_CEILING, 1000);
  const softPct = num(overrides.softPct ?? process.env.TANK01_SOFT_PCT, 80);
  const anchorRaw = num(overrides.anchorDay ?? process.env.TANK01_BILLING_ANCHOR_DAY, 1);
  return {
    budget,
    hardCeiling: Math.max(hardCeiling, budget),
    softPct: Math.min(softPct, 100),
    softLimit: Math.floor((budget * Math.min(softPct, 100)) / 100),
    // 1-28 so every month actually has the anchor day.
    anchorDay: Math.min(Math.max(Math.round(anchorRaw), 1), 28),
  };
}

/**
 * Pure: the UTC date the current billing cycle started, given the anchor day of
 * the month. Before the anchor we're still inside the cycle that began last
 * month — that rollover is the whole point of tracking an anchor rather than
 * assuming the 1st.
 */
function cycleStart(now = new Date(), anchorDay = 1) {
  const day = Math.min(Math.max(Math.round(Number(anchorDay) || 1), 1), 28);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  if (now.getUTCDate() >= day) return new Date(Date.UTC(year, month, day));
  return new Date(Date.UTC(year, month - 1, day));
}

/** Pure: a Date -> 'YYYY-MM-DD' in UTC, matching the `day` date column. */
function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

/** Pure: '/getNFLBoxScore' -> 'getNFLBoxScore' (the api_usage endpoint key). */
function endpointKey(path) {
  return String(path || '')
    .split('?')[0]
    .replace(/^\/+/, '')
    .slice(0, 120) || 'unknown';
}

class QuotaExhaustedError extends Error {
  constructor(message, { mode, used, budget, hardCeiling, priority }) {
    super(message);
    this.name = 'QuotaExhaustedError';
    this.statusCode = 503;
    this.code = 'TANK01_QUOTA_EXHAUSTED';
    this.quota = { mode, used, budget, hardCeiling, priority };
  }
}

/**
 * Backoff (ms) to honor for a thrown request error, or null if it isn't a
 * rate-limit response. Honors a numeric `Retry-After` header (capped), else a
 * sane default. Config errors (no `.response`) return null — not retriable.
 *
 * Lifted here from gameRecap.service so the recap queue and this client share
 * one definition; still re-exported there for the queue's default `backoffFor`.
 */
function retryAfterMs(err) {
  const status = err && err.response && err.response.status;
  if (status !== 429) return null;
  const headers = err.response.headers || {};
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, 120) * 1000;
  return 30_000;
}

/**
 * A synthetic 429 thrown while the shared backoff is still in force. Shaped
 * like a real axios rate-limit error (`response.status` + `retry-after`) so the
 * recap queue's existing `retryAfterMs`-based requeue keeps working without
 * knowing this module exists.
 */
function rateLimitedError(waitMs) {
  const err = new Error(`Tank01 rate-limited; backing off for ${Math.ceil(waitMs / 1000)}s`);
  err.statusCode = 429;
  err.code = 'TANK01_BACKOFF';
  err.response = { status: 429, headers: { 'retry-after': String(Math.ceil(waitMs / 1000)) } };
  return err;
}

/** Pure: RapidAPI quota headers -> { limit, remaining } (nulls when absent). */
function parseQuotaHeaders(headers) {
  const h = headers || {};
  const pick = (name) => {
    const raw = h[name] ?? h[name.toLowerCase()] ?? h[name.toUpperCase()];
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    limit: pick('x-ratelimit-requests-limit'),
    remaining: pick('x-ratelimit-requests-remaining'),
  };
}

/**
 * Pure: usage + config -> gate decision. Kept separate from the DB and the
 * network so the whole shedding policy is unit-testable.
 */
function quotaMode(used, config) {
  if (used >= config.hardCeiling) return 'blocked';
  if (used >= config.budget) return 'essential-only';
  if (used >= config.softLimit) return 'degraded';
  return 'ok';
}

/** Pure: may a call of this priority proceed in this mode? */
function priorityAllowed(priority, mode) {
  if (mode === 'blocked') return false;
  if (mode === 'essential-only') return priority === 'essential';
  // At the soft limit news sheds first; the clock and stat pulls keep running
  // (at a stretched cadence) because they're what users actually see.
  if (mode === 'degraded') return priority !== 'low';
  return true;
}

// ---- Postgres-backed usage store -------------------------------------------

const pgStore = {
  async readUsage({ provider, since }) {
    const res = await pool.query(
      `SELECT COALESCE(SUM("calls"), 0)::int AS "used"
         FROM "private"."api_usage"
        WHERE "provider" = $1 AND "day" >= $2::date`,
      [provider, since]
    );
    return Number(res.rows[0] && res.rows[0].used) || 0;
  },

  async readSnapshot(provider) {
    const res = await pool.query(
      `SELECT "requests_limit", "requests_remaining", "seen_at"
         FROM "private"."api_quota_snapshots" WHERE "provider" = $1`,
      [provider]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      limit: row.requests_limit == null ? null : Number(row.requests_limit),
      remaining: row.requests_remaining == null ? null : Number(row.requests_remaining),
      seenAt: row.seen_at ? new Date(row.seen_at) : null,
    };
  },

  async recordCall({ provider, endpoint, day }) {
    await pool.query(
      `INSERT INTO "private"."api_usage" ("provider", "endpoint", "day", "calls")
       VALUES ($1, $2, $3::date, 1)
       ON CONFLICT ("provider", "endpoint", "day")
       DO UPDATE SET "calls" = "private"."api_usage"."calls" + 1, "updated_at" = now()`,
      [provider, endpoint, day]
    );
  },

  async saveSnapshot({ provider, limit, remaining, seenAt }) {
    await pool.query(
      `INSERT INTO "private"."api_quota_snapshots"
         ("provider", "requests_limit", "requests_remaining", "seen_at")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("provider") DO UPDATE SET
         "requests_limit" = EXCLUDED."requests_limit",
         "requests_remaining" = EXCLUDED."requests_remaining",
         "seen_at" = EXCLUDED."seen_at",
         "updated_at" = now()`,
      [provider, limit, remaining, seenAt]
    );
  },

  /** 14-day per-endpoint breakdown for the admin quota view. */
  async readBreakdown({ provider, days = 14 }) {
    const res = await pool.query(
      `SELECT "endpoint", "day", "calls"
         FROM "private"."api_usage"
        WHERE "provider" = $1 AND "day" >= (now() - make_interval(days => $2))::date
        ORDER BY "day" DESC, "calls" DESC`,
      [provider, days]
    );
    return res.rows.map((r) => ({
      endpoint: r.endpoint,
      day: typeof r.day === 'string' ? r.day : utcDay(new Date(r.day)),
      calls: Number(r.calls) || 0,
    }));
  },
};

// ---- client -----------------------------------------------------------------

/**
 * Build a metered Tank01 client. The default singleton below is what production
 * uses; tests build their own with an in-memory `store` and a fake `transport`
 * so neither the network nor Postgres is involved.
 *
 * @param {object} deps
 * @param {object} deps.store        usage store (see pgStore for the contract)
 * @param {object} deps.transport    axios-like client used for COUNTED calls
 *                                   (default: scoring.rapidApiClient())
 * @param {Function} deps.now        () => Date, injectable for cycle math
 * @param {object} deps.config       budget/ceiling/anchor overrides
 */
function createTank01Client({ store = pgStore, transport, now = () => new Date(), config } = {}) {
  let cachedState = null;
  let cachedAt = 0;
  let backoffUntil = 0;

  function resolveTransport() {
    if (transport) return transport;
    // Lazy require: scoring.service requires this module at load time, so a
    // top-level require here would be a cycle.
    return require('../services/scoring.service').rapidApiClient();
  }

  /**
   * Current cycle usage, taking the HIGHER of our own count and the provider's
   * header view. Local sums miss calls made outside this app (a manual curl,
   * another environment sharing the key); headers miss nothing but go stale, so
   * `max` is the only safe reconciliation.
   */
  async function readUsed(cfg, at) {
    const since = utcDay(cycleStart(at, cfg.anchorDay));
    const [local, snapshot] = await Promise.all([
      store.readUsage({ provider: PROVIDER, since }).catch((err) => {
        console.error('tank01 quota: usage read failed:', err.message);
        return 0;
      }),
      store.readSnapshot(PROVIDER).catch(() => null),
    ]);
    let headerUsed = null;
    if (
      snapshot &&
      Number.isFinite(snapshot.limit) &&
      Number.isFinite(snapshot.remaining) &&
      snapshot.seenAt &&
      at.getTime() - snapshot.seenAt.getTime() < SNAPSHOT_FRESH_MS
    ) {
      headerUsed = Math.max(snapshot.limit - snapshot.remaining, 0);
    }
    return {
      used: Math.max(local, headerUsed == null ? 0 : headerUsed),
      localUsed: local,
      headerUsed,
      snapshot,
      cycleStart: since,
    };
  }

  /**
   * Quota snapshot for gating, the admin view, and /api/health. Memoized ~60s;
   * async because the counters live in Postgres.
   */
  async function getQuotaState({ refresh = false } = {}) {
    if (!refresh && cachedState && Date.now() - cachedAt < STATE_TTL_MS) return cachedState;
    const cfg = readConfig(config);
    const at = now();
    const { used, localUsed, headerUsed, snapshot, cycleStart: start } = await readUsed(cfg, at);
    cachedState = {
      provider: PROVIDER,
      used,
      localUsed,
      headerUsed,
      budget: cfg.budget,
      softLimit: cfg.softLimit,
      hardCeiling: cfg.hardCeiling,
      remaining: Math.max(cfg.budget - used, 0),
      mode: quotaMode(used, cfg),
      cycleStart: start,
      providerLimit: snapshot ? snapshot.limit : null,
      providerRemaining: snapshot ? snapshot.remaining : null,
      providerSeenAt: snapshot && snapshot.seenAt ? snapshot.seenAt.toISOString() : null,
      backoffUntil: backoffUntil > Date.now() ? new Date(backoffUntil).toISOString() : null,
    };
    cachedAt = Date.now();
    return cachedState;
  }

  /** Invalidate the memo — called after every counted call. */
  function invalidate() {
    cachedState = null;
    cachedAt = 0;
  }

  function noteRateLimit(err) {
    const wait = retryAfterMs(err);
    if (wait == null) return;
    backoffUntil = Math.max(backoffUntil, Date.now() + wait);
  }

  async function recordSnapshotFrom(headers) {
    const { limit, remaining } = parseQuotaHeaders(headers);
    if (limit == null && remaining == null) return;
    try {
      await store.saveSnapshot({ provider: PROVIDER, limit, remaining, seenAt: now() });
    } catch (err) {
      console.error('tank01 quota: snapshot write failed:', err.message);
    }
  }

  /**
   * One metered GET.
   *
   * @param {string} path                 e.g. '/getNFLBoxScore'
   * @param {object} [opts]
   * @param {object} [opts.params]        query params
   * @param {'low'|'standard'|'essential'} [opts.priority='standard']
   * @param {object} [opts.transport]     per-call axios-like client; NOT counted
   *                                      and not gated (test escape hatch only)
   * @returns {Promise<object>} the axios response
   * @throws {QuotaExhaustedError} 503 when this priority is out of budget
   */
  async function get(path, { params, priority = 'standard', transport: callTransport } = {}) {
    if (callTransport) return callTransport.get(path, { params });

    const state = await getQuotaState();
    if (!priorityAllowed(priority, state.mode)) {
      throw new QuotaExhaustedError(
        `Tank01 quota ${state.mode} (${state.used}/${state.budget} this cycle): ${priority} calls suspended`,
        { mode: state.mode, used: state.used, budget: state.budget, hardCeiling: state.hardCeiling, priority }
      );
    }
    if (Date.now() < backoffUntil) throw rateLimitedError(backoffUntil - Date.now());

    const client = resolveTransport(); // may throw 503 for missing creds: not a call
    const endpoint = endpointKey(path);

    // Count the ATTEMPT, before the request: an errored call still consumed a
    // request as far as RapidAPI is concerned, and counting first means a
    // crash mid-request can't lose the increment.
    try {
      await store.recordCall({ provider: PROVIDER, endpoint, day: utcDay(now()) });
    } catch (err) {
      console.error('tank01 quota: usage write failed for %s:', endpoint, err.message);
    }
    invalidate();

    try {
      const response = await client.get(path, { params });
      await recordSnapshotFrom(response && response.headers);
      return response;
    } catch (err) {
      noteRateLimit(err);
      if (err && err.response) await recordSnapshotFrom(err.response.headers);
      throw err;
    }
  }

  return {
    get,
    getQuotaState,
    readBreakdown: (opts) => store.readBreakdown({ provider: PROVIDER, ...(opts || {}) }),
    /** Test/ops helper: drop the shared backoff and the memoized state. */
    reset() {
      backoffUntil = 0;
      invalidate();
    },
    get backoffUntil() {
      return backoffUntil;
    },
  };
}

const defaultClient = createTank01Client();

module.exports = {
  // production surface
  tank01Get: (path, opts) => defaultClient.get(path, opts),
  getQuotaState: (opts) => defaultClient.getQuotaState(opts),
  readQuotaBreakdown: (opts) => defaultClient.readBreakdown(opts),
  resetQuotaClient: () => defaultClient.reset(),
  // building blocks (unit tested / reused)
  createTank01Client,
  pgStore,
  QuotaExhaustedError,
  retryAfterMs,
  cycleStart,
  utcDay,
  endpointKey,
  parseQuotaHeaders,
  quotaMode,
  priorityAllowed,
  readConfig,
  PROVIDER,
  PRIORITIES,
};
