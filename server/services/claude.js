const Anthropic = require('@anthropic-ai/sdk');
const defaultPool = require('../modules/pool');
const { cycleStart } = require('../modules/tank01Client');
const { logger } = require('../modules/logger');

/**
 * The ONE Claude client (ADR 0061): pins the model, records every call in
 * `llm_usage`, and refuses to call once the billing month's
 * ANTHROPIC_MONTHLY_BUDGET is spent. Callers get a string or null and fall back
 * to their stored template on null.
 */

const MODEL = 'claude-opus-5-5';
// USD per 1M tokens.
const PRICES = { input: 4, output: 20, cache_read: 0.2, cache_write: 5 };

/** Config is read per call so a deploy-time env change needs no restart. */
function readConfig() {
  const num = (value, fallback, min) => {
    const parsed = value === undefined || value === '' ? NaN : Number(value);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  };
  return {
    apiKey: process.env.ANTHROPIC_API_KEY || null,
    // 0 is a valid budget: spend nothing.
    budget: num(process.env.ANTHROPIC_MONTHLY_BUDGET, 20, 0),
    anchorDay: num(process.env.ANTHROPIC_BILLING_ANCHOR_DAY, 1, 1),
  };
}

let spentLoggedFor = null; // cycle start (ISO) already logged as spent

/**
 * Rewrite one Narrative. Returns the trimmed text, or null when unconfigured,
 * over budget, not a clean end_turn (refusal, max_tokens), empty or failed
 * (never throws). `placeholders` maps `[[team:<id>]]` tokens to the real
 * strings the prompt must not carry (ADR 0061 section 5); every token is put
 * back in the output, and an output with a token left over or mangled is null.
 */
async function narrative(
  { feature, system, user, maxTokens = 4096, placeholders = {} },
  { client: suppliedClient, pool = defaultPool, now = new Date() } = {}
) {
  const cfg = readConfig();
  if (!suppliedClient && !cfg.apiKey) return null;
  try {
    const since = cycleStart(now, cfg.anchorDay);
    const { rows } = await pool.query(
      'SELECT COALESCE(SUM("usd"), 0) AS "spent" FROM "llm_usage" WHERE "created_at" >= $1',
      [since]
    );
    if (Number(rows[0].spent) >= cfg.budget) {
      if (spentLoggedFor !== since.toISOString()) {
        spentLoggedFor = since.toISOString();
        logger.warn({ budget: cfg.budget, since }, 'ANTHROPIC_MONTHLY_BUDGET spent; skipping model calls');
      }
      return null;
    }

    const client = suppliedClient || new Anthropic({ apiKey: cfg.apiKey, timeout: 30_000, maxRetries: 0 });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      output_config: { effort: 'low' },
      system,
      messages: [{ role: 'user', content: user }],
    });

    const u = response.usage || {};
    const tokens = {
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cache_read: u.cache_read_input_tokens || 0,
      cache_write: u.cache_creation_input_tokens || 0,
    };
    const usd = (
      tokens.input * PRICES.input +
      tokens.output * PRICES.output +
      tokens.cache_read * PRICES.cache_read +
      tokens.cache_write * PRICES.cache_write
    ) / 1e6;
    try {
      await pool.query(
        `INSERT INTO "llm_usage"
           ("feature", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "usd")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [feature, MODEL, tokens.input, tokens.output, tokens.cache_read, tokens.cache_write, usd]
      );
    } catch (err) {
      // The text was paid for; a ledger miss must not throw it away.
      logger.error({ err, feature }, 'llm_usage insert failed');
    }

    if (response.stop_reason !== 'end_turn') return null;
    let text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    for (const [token, value] of Object.entries(placeholders)) text = text.split(token).join(value);
    if (text.includes('[[team:')) return null;
    return text || null;
  } catch (err) {
    logger.error({ err, feature }, 'claude narrative failed, falling back to template');
    return null;
  }
}

module.exports = { narrative, readConfig, MODEL, PRICES };
