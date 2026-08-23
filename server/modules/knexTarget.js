/**
 * Resolves the database a knex CLI run is about to touch, says so out loud
 * before anything connects, and refuses a non-loopback host that nobody
 * explicitly asked for. Required by BOTH knexfiles (#258).
 *
 * Why this exists: on 2026-08-23 an IC ran `npx knex migrate:latest` with all
 * five PG* variables set at a local container, from a worktree that carried a
 * copied `.env`. The knexfiles resolve
 * `DATABASE_URL_MIGRATIONS || DATABASE_URL_RUNTIME || DATABASE_URL` and fall
 * back to PG* only when none is set, so the PG* block was discarded WITHOUT A
 * WORD and three migrations applied to the shared production database.
 *
 * The order of the two mechanisms here is deliberate, and it is not the order
 * the ticket lists them in:
 *
 *   1. THE PRINT IS PRIMARY. The first thing any knex CLI run does is write
 *      the resolved host, port, database and THE VARIABLE THAT SUPPLIED THEM
 *      to stderr. Every other check can be satisfied by a run pointed at the
 *      wrong place; only the printed line makes the mistake visible BEFORE
 *      the write rather than after. A line reading `from DATABASE_URL` would
 *      have ended the incident above on sight.
 *   2. THE REFUSAL IS THE BACKSTOP, for when nobody is reading. It is
 *      necessary and NOT sufficient: ruling out remote hosts still permits
 *      writing to a colleague's local database, or to the wrong local
 *      database on the same port. Those are cases only the printed line
 *      catches, which is the other reason the print is not decoration.
 *
 * Nothing here reads process.env directly (the caller passes `env`) and
 * nothing writes to a stream directly (the caller passes `write`), so the
 * tests exercise this module rather than a copy of it.
 *
 * THE PASSWORD IS NEVER PRINTED. Neither the discrete PGPASSWORD nor the
 * connection string that embeds one is ever put in a line or a message; only
 * variable NAMES are. `server/test/knexTarget.test.js` asserts that on every
 * path, including the refusal path.
 *
 * On message style: the *.pg.test.js suites' refusal is the precedent this
 * borrows from, and it is one line, corrective action first:
 *
 *   unset DATABASE_URL, DATABASE_URL_RUNTIME -- these tests must only ever
 *   see a disposable PG* database
 *
 * What is kept from it is the vocabulary and the naming of the offending
 * variables. What is deliberately NOT kept is the ordering: this refusal
 * leads with the host it is refusing, because unlike a test suite it can be
 * hit by someone who does not yet know which database they are pointed at,
 * and that fact is the whole point of the message. The corrections follow,
 * one per line, because there are two of them and they are alternatives.
 */
const { sslForConnection } = require('./dbSsl');

/** In priority order. The first one set wins; the rest are reported ignored. */
const URL_VARS = ['DATABASE_URL_MIGRATIONS', 'DATABASE_URL_RUNTIME', 'DATABASE_URL'];

/** Reported ignored, by name only, whenever a URL wins. PGPASSWORD included:
 *  naming it is what tells someone their whole override was discarded. */
const PG_VARS = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

/**
 * The three spellings the issue names, plus the bracketed IPv6 form.
 *
 * NOT the empty string, though dbSsl.js's own list includes it. A connection
 * string with no authority (`postgresql:///postgres`) parses to an empty
 * hostname, and pg then takes the host from PGHOST and connects there. So an
 * empty host defeated both mechanisms at once: the guard allowed it, and the
 * printed line read `host=` with nothing after it, blank in exactly the place
 * it was meant to be loudest. Anything that cannot be shown to be local is
 * refused here, and dbSsl's list is a separate question (it decides TLS, and
 * erring towards SSL is the safe direction there).
 *
 * Other near-misses that are deliberately absent, and therefore refused:
 * 127.0.0.2, 0.0.0.0, ::ffff:127.0.0.1, a trailing-dot `127.0.0.1.`, and
 * decimal 2130706433. Some of those really are local; refusing them is one
 * KNEX_ALLOW_REMOTE away, whereas a loose matcher is how a guard goes quiet.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Must be exactly this. "true"/"yes"/"0" are all refusals, so a half-remembered
 *  spelling fails closed rather than opening production. */
const OPT_IN = 'KNEX_ALLOW_REMOTE';
const OPT_IN_VALUE = '1';

const DEFAULTS = { host: 'localhost', port: 5432, database: 'endzone_empire' };

function isLoopback(host) {
  return LOOPBACK_HOSTS.has(String(host === undefined || host === null ? '' : host).toLowerCase());
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

/**
 * Pulls host/port/database/user out of a connection string WITHOUT the
 * password. Returns `{ parts }` on success, or `{ unresolved }` naming why
 * the target could not be established, which the caller treats as "not
 * provably loopback" rather than as "local".
 *
 * The two failures are told apart because they need different advice: an
 * unparseable string is a typo, whereas a host-less one is silently
 * completed from PGHOST by pg and is the more dangerous of the two.
 */
function parseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch (err) {
    return { unresolved: 'unparseable' };
  }
  if (!url.protocol.startsWith('postgres')) return { unresolved: 'unparseable' };
  if (!url.hostname) return { unresolved: 'no-host' };
  const database = decode(url.pathname.replace(/^\//, ''));
  return {
    parts: {
      host: url.hostname,
      port: Number(url.port) || DEFAULTS.port,
      database: database || DEFAULTS.database,
      user: url.username ? decode(url.username) : undefined,
    },
  };
}

/**
 * Works out where a knex run would connect, and what it is throwing away to
 * get there. Pure: no env reads, no output, no connection.
 *
 * @param {object} env
 * @returns {{via: 'url'|'pg', source: string,
 *            host: string, port: number, database: string, user: string|undefined,
 *            password: string|undefined, connectionString: string|undefined,
 *            parsed: boolean, loopback: boolean, ignored: string[],
 *            allowedRemote: boolean}}
 */
function resolveTarget(env) {
  const setUrlVars = URL_VARS.filter((name) => env[name]);
  const allowedRemote = env[OPT_IN] === OPT_IN_VALUE;

  if (setUrlVars.length > 0) {
    const sourceVar = setUrlVars[0];
    const connectionString = env[sourceVar];
    const { parts, unresolved = null } = parseUrl(connectionString);
    // A URL that won silently discards the ENTIRE PG* block. Report every
    // member of it that was set, plus the lower-priority URL variables.
    const ignored = [
      ...setUrlVars.slice(1),
      ...PG_VARS.filter((name) => env[name]),
    ];
    return {
      via: 'url',
      // On this path `source` IS the winning variable's name. On the PG* path
      // it is the list of PG* variables that were set. One field either way:
      // `via` already says which kind it is, so a second near-identical field
      // would only be one more thing to keep in step.
      source: sourceVar,
      host: parts ? parts.host : null,
      port: parts ? parts.port : null,
      database: parts ? parts.database : null,
      user: parts ? parts.user : undefined,
      password: undefined,
      connectionString,
      parsed: Boolean(parts),
      unresolved,
      loopback: parts ? isLoopback(parts.host) : false,
      ignored,
      allowedRemote,
    };
  }

  const setPgVars = PG_VARS.filter((name) => env[name]);
  const host = env.PGHOST || DEFAULTS.host;
  return {
    via: 'pg',
    source: setPgVars.length ? setPgVars.join(', ') : 'the PG* defaults',
    host,
    port: Number(env.PGPORT) || DEFAULTS.port,
    database: env.PGDATABASE || DEFAULTS.database,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    connectionString: undefined,
    parsed: true,
    unresolved: null,
    loopback: isLoopback(host),
    ignored: [],
    allowedRemote,
  };
}

/**
 * Explains WHY the ignored variables lost, based on what actually lost.
 *
 * The two reasons are different rules and the output must not confuse them.
 * The deploy's own shape is two DATABASE_URL* variables and no PG* at all, so
 * a fixed "a DATABASE_URL* always beats the PG* block" sentence would be
 * explaining a defeat that never happened, in the very line Cory reads to
 * confirm a release is pointed at the right database.
 */
/** "PGHOST was set and IGNORED" / "PGHOST, PGPORT were set and IGNORED". */
function ignoredClause(ignored) {
  return `${ignored.join(', ')} ${ignored.length === 1 ? 'was' : 'were'} set and IGNORED.`;
}

function whyIgnored(target) {
  const reasons = [];
  if (target.ignored.some((name) => PG_VARS.includes(name))) {
    reasons.push('A DATABASE_URL* always beats the PG* block here.');
  }
  if (target.ignored.some((name) => URL_VARS.includes(name))) {
    reasons.push(
      `Among ${URL_VARS.join(', ')}, the first one set wins.`,
    );
  }
  return reasons.join(' ');
}

/**
 * The line (or lines) a knex run prints before it connects. Returns an array
 * so the caller decides where they go; never contains a password.
 */
function describeTarget(target) {
  // Never `host=` with nothing after it. A blank where the host belongs is
  // worse than no line at all: it reads as "resolved, and it is nothing".
  const UNRESOLVED_FIELDS = {
    'no-host': 'host=<none: the connection string does not name one>',
    unparseable: 'host=<unknown: the connection string could not be parsed>',
  };

  const fields = target.parsed
    ? [
      `host=${target.host}`,
      `port=${target.port}`,
      `database=${target.database}`,
      ...(target.user ? [`user=${target.user}`] : []),
    ].join(' ')
    : UNRESOLVED_FIELDS[target.unresolved];

  const lines = [`knex target: ${fields} (from ${target.source})`];

  if (target.ignored.length > 0) {
    lines.push(
      `knex target: ${target.source} won. `
      + `${ignoredClause(target.ignored)} ${whyIgnored(target)}`,
    );
  }

  if (!target.loopback && target.allowedRemote) {
    lines.push(`knex target: not loopback, allowed by ${OPT_IN}=${OPT_IN_VALUE}.`);
  }

  return lines;
}

/** The refusal, naming the host, the variable that supplied it, and the opt-in. */
function refusalMessage(target) {
  const UNRESOLVED_WHERE = {
    'no-host': 'a connection string that names no host',
    unparseable: 'a connection string that could not be parsed',
  };
  const UNRESOLVED_WHY = {
    // The dangerous one: pg quietly completes a host-less string from PGHOST,
    // so this can reach a remote database while looking like nothing at all.
    'no-host': 'pg would take the host from PGHOST, so this cannot be shown to be local.',
    unparseable: 'An unparseable target cannot be shown to be local.',
  };

  const where = target.parsed
    ? `${target.host}:${target.port}/${target.database}`
    : UNRESOLVED_WHERE[target.unresolved];

  const lines = [
    `knex refuses to connect to ${where}, supplied by ${target.source}.`,
  ];

  if (!target.parsed) {
    lines.push(`${UNRESOLVED_WHY[target.unresolved]} It is treated as remote.`);
  }

  if (target.ignored.length > 0) {
    lines.push(
      `${ignoredClause(target.ignored)} ${whyIgnored(target)} `
      + 'If you believed you were pointed at a local container, this is why you were not.',
    );
  }

  lines.push(
    target.via === 'url'
      ? `Unset ${target.source} (a repo-root .env is loaded automatically) and re-run, `
        + 'if you meant a local database.'
      : 'Point PGHOST at localhost and re-run, if you meant a local database.',
  );
  lines.push(
    `Set ${OPT_IN}=${OPT_IN_VALUE} only if you really mean this host. `
    + "Render's preDeployCommand sets it; nothing else should.",
  );

  return lines.join('\n');
}

/**
 * Prints the resolved target, then refuses a non-loopback host without the
 * opt-in. The print happens FIRST and unconditionally, including on the path
 * that throws: the line is the mechanism, the throw is the backstop.
 *
 * @returns {object} the resolved target, when the run is allowed to proceed
 * @throws {Error} before any connection is opened, when it is not
 */
function announceTarget({ env = process.env, write = defaultWrite } = {}) {
  const target = resolveTarget(env);

  for (const line of describeTarget(target)) write(line);

  if (!target.loopback && !target.allowedRemote) {
    throw new Error(refusalMessage(target));
  }

  return target;
}

function defaultWrite(line) {
  process.stderr.write(`${line}\n`);
}

/** The connection object knex is handed, built from an already-resolved target. */
function connectionFor(target) {
  if (target.via === 'url') {
    return {
      connectionString: target.connectionString,
      ssl: sslForConnection(target.connectionString),
    };
  }
  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password: target.password,
  };
}

/**
 * What a knexfile calls: announce, guard, and hand back the connection. One
 * call so the two knexfiles cannot drift apart.
 */
function resolveKnexConnection(options) {
  return connectionFor(announceTarget(options));
}

// OPT_IN is exported because the tests assert on the name rather than
// hard-coding it. OPT_IN_VALUE, URL_VARS and PG_VARS deliberately are NOT:
// nothing outside this file reads them today, and the seven *.pg.test.js
// suites that each redeclare their own URL_VARS keep doing so on purpose,
// since their whole gate depends on requiring nothing that loads .env.
module.exports = {
  OPT_IN,
  resolveTarget,
  describeTarget,
  refusalMessage,
  announceTarget,
  connectionFor,
  resolveKnexConnection,
};
