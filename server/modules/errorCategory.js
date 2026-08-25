/**
 * Error -> stable category, for the anonymous /api/health payload (#242).
 *
 * The health surface has no auth guard, so any error string it publishes goes
 * to the public internet. Raw `err.message` values leak infrastructure: pg
 * errors carry the database host, project ref, port and username; axios network
 * errors carry the upstream host. This module is the ONE place that turns an
 * error into a fixed, opaque category so the raw string never reaches the wire.
 * The raw detail still lives server-side (the `worker_heartbeats.last_error`
 * column for operators, and the authed admin overview).
 *
 * Classification prefers STRUCTURED properties (err.code, axios response.status,
 * pg SQLSTATE + severity) and falls back to sniffing the message only when no
 * structure is present - which is the case for the worker path, where the
 * health router reads a bare string back out of the heartbeat table. The
 * function NEVER returns the input string: an unrecognized value is `unknown`.
 */

const ERROR_CATEGORIES = Object.freeze({
  DB_UNAVAILABLE: 'db_unavailable',
  UPSTREAM_TIMEOUT: 'upstream_timeout',
  UPSTREAM_HTTP: 'upstream_http',
  CONFIG: 'config',
  UNKNOWN: 'unknown',
});

// Socket/DNS-level failure codes, split so a bare (non-axios) code lands on the
// same arm the message-sniffing fallback would pick for the same token: a
// timeout reads as a timeout, a refusal/reset/lookup failure reads as the
// database being unreachable (the DB pool is this app's dominant non-HTTP
// dependency). An axios-shaped error is resolved earlier, before either set.
const NETWORK_TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED']);
const NETWORK_CONN_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'EPIPE',
  'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN',
]);

/** node-pg surfaces a 5-char SQLSTATE (e.g. '53300', '28P01') as err.code. */
function isSqlState(code) {
  return /^[0-9A-Z]{5}$/.test(code);
}

/**
 * SQLSTATE class 28 is "invalid authorization specification" / "invalid
 * password" - a credential/config problem, not the database being down.
 */
function isAuthSqlState(code) {
  return isSqlState(code) && code.startsWith('28');
}

/** True for an error carrying the axios/HTTP-client shape. */
function looksLikeAxios(err) {
  return err.isAxiosError === true
    || (err.response && typeof err.response === 'object')
    || (err.config && typeof err.config === 'object');
}

function classifyMessage(message) {
  const text = String(message || '');
  if (!text) return null;
  // Upstream HTTP status fingerprints (an axios message without the object).
  if (/request failed with status code\s+\d{3}|\bstatus code\s+[45]\d\d|\bHTTP\/?\s?[45]\d\d/i.test(text)) {
    return ERROR_CATEGORIES.UPSTREAM_HTTP;
  }
  // Timeouts / aborted requests.
  if (/\b(?:timed out|timeout|ETIMEDOUT|ECONNABORTED|ESOCKETTIMEDOUT)\b/i.test(text)) {
    return ERROR_CATEGORIES.UPSTREAM_TIMEOUT;
  }
  // Database fingerprints: pg/postgres wording and connection-level failures.
  if (/\b(?:postgres|postgresql|pg_hba|relation|role|supavisor|pgbouncer|ECONNREFUSED|ECONNRESET)\b|could not connect|connection (?:refused|terminated|reset)|too many connections|pool (?:is )?(?:empty|exhausted)/i.test(text)) {
    return ERROR_CATEGORIES.DB_UNAVAILABLE;
  }
  // Missing/invalid configuration and credentials.
  if (/\bnot configured\b|\bis (?:not set|missing|required|undefined)\b|missing (?:env|environment|credential|api key)|password authentication failed|API[_ ]?KEY/i.test(text)) {
    return ERROR_CATEGORIES.CONFIG;
  }
  return ERROR_CATEGORIES.UNKNOWN;
}

/**
 * Map an error (or a bare message string, or null) to a fixed category.
 *
 * @param {Error|string|null|undefined} input
 * @returns {string|null} an ERROR_CATEGORIES value, or null for a healthy
 *   (empty) input. Never the input string.
 */
function classifyError(input) {
  if (!input) return null;
  if (typeof input === 'string') return classifyMessage(input);
  if (typeof input !== 'object') return ERROR_CATEGORIES.UNKNOWN;

  const err = input;
  const code = typeof err.code === 'string' ? err.code.toUpperCase() : '';

  // Upstream HTTP client first: a returned status is the strongest signal, and
  // an axios-shaped network failure (ECONNREFUSED to an API host) must not be
  // misread as a database outage the way the same bare code would be.
  if (looksLikeAxios(err)) {
    const status = err.response && err.response.status;
    if (Number.isInteger(status)) return ERROR_CATEGORIES.UPSTREAM_HTTP;
    return ERROR_CATEGORIES.UPSTREAM_TIMEOUT;
  }

  // A bare timeout code reads as a timeout regardless of source.
  if (NETWORK_TIMEOUT_CODES.has(code)) return ERROR_CATEGORIES.UPSTREAM_TIMEOUT;

  // Postgres / node-pg. Auth-class SQLSTATE is a config problem; any other
  // SQLSTATE, a pg severity, or a bare connection-level code from the DB pool
  // means the database is unreachable/erroring.
  if (isAuthSqlState(code)) return ERROR_CATEGORIES.CONFIG;
  if (isSqlState(code) || err.severity || NETWORK_CONN_CODES.has(code)) {
    return ERROR_CATEGORIES.DB_UNAVAILABLE;
  }

  return classifyMessage(err.message);
}

module.exports = { classifyError, ERROR_CATEGORIES };
