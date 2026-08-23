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
 * The message style follows the *.pg.test.js suites' refusal ("unset X, then
 * ..."): the corrective action first, the reason second.
 */
const { sslForConnection } = require('./dbSsl');

/** In priority order. The first one set wins; the rest are reported ignored. */
const URL_VARS = ['DATABASE_URL_MIGRATIONS', 'DATABASE_URL_RUNTIME', 'DATABASE_URL'];

/** Reported ignored, by name only, whenever a URL wins. PGPASSWORD included:
 *  naming it is what tells someone their whole override was discarded. */
const PG_VARS = ['PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '']);

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
 * password. Returns null when the string cannot be parsed, which the caller
 * treats as "not provably loopback" rather than as "local".
 */
function parseUrl(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch (err) {
    return null;
  }
  if (!url.protocol.startsWith('postgres')) return null;
  const database = decode(url.pathname.replace(/^\//, ''));
  return {
    host: url.hostname,
    port: Number(url.port) || DEFAULTS.port,
    database: database || DEFAULTS.database,
    user: url.username ? decode(url.username) : undefined,
  };
}

/**
 * Works out where a knex run would connect, and what it is throwing away to
 * get there. Pure: no env reads, no output, no connection.
 *
 * @param {object} env
 * @returns {{via: 'url'|'pg', sourceVar: string|null, source: string,
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
    const parts = parseUrl(connectionString);
    // A URL that won silently discards the ENTIRE PG* block. Report every
    // member of it that was set, plus the lower-priority URL variables.
    const ignored = [
      ...setUrlVars.slice(1),
      ...PG_VARS.filter((name) => env[name]),
    ];
    return {
      via: 'url',
      sourceVar,
      source: sourceVar,
      host: parts ? parts.host : null,
      port: parts ? parts.port : null,
      database: parts ? parts.database : null,
      user: parts ? parts.user : undefined,
      password: undefined,
      connectionString,
      parsed: Boolean(parts),
      loopback: parts ? isLoopback(parts.host) : false,
      ignored,
      allowedRemote,
    };
  }

  const setPgVars = PG_VARS.filter((name) => env[name]);
  const host = env.PGHOST || DEFAULTS.host;
  return {
    via: 'pg',
    sourceVar: null,
    source: setPgVars.length ? setPgVars.join(', ') : 'the PG* defaults',
    host,
    port: Number(env.PGPORT) || DEFAULTS.port,
    database: env.PGDATABASE || DEFAULTS.database,
    user: env.PGUSER,
    password: env.PGPASSWORD,
    connectionString: undefined,
    parsed: true,
    loopback: isLoopback(host),
    ignored: [],
    allowedRemote,
  };
}

/**
 * The line (or lines) a knex run prints before it connects. Returns an array
 * so the caller decides where they go; never contains a password.
 */
function describeTarget(target) {
  const fields = target.parsed
    ? [
      `host=${target.host}`,
      `port=${target.port}`,
      `database=${target.database}`,
      ...(target.user ? [`user=${target.user}`] : []),
    ].join(' ')
    : 'host=<unparseable connection string>';

  const lines = [`knex target: ${fields} (from ${target.source})`];

  if (target.ignored.length > 0) {
    lines.push(
      `knex target: ${target.source} won. These were set and IGNORED: `
      + `${target.ignored.join(', ')}. A DATABASE_URL* always beats the PG* block here.`,
    );
  }

  if (!target.loopback && target.allowedRemote) {
    lines.push(`knex target: not loopback, allowed by ${OPT_IN}=${OPT_IN_VALUE}.`);
  }

  return lines;
}

/** The refusal, naming the host, the variable that supplied it, and the opt-in. */
function refusalMessage(target) {
  const where = target.parsed
    ? `${target.host}:${target.port}/${target.database}`
    : 'a connection string that could not be parsed';

  const lines = [
    `knex refuses to connect to ${where}, supplied by ${target.source}.`,
  ];

  if (!target.parsed) {
    lines.push('An unparseable target cannot be shown to be local, so it is treated as remote.');
  }

  if (target.ignored.length > 0) {
    lines.push(
      `${target.ignored.join(', ')} were set and IGNORED: a DATABASE_URL* always beats `
      + 'the PG* block here. If you believed you were pointed at a local container, '
      + 'this is why you were not.',
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

module.exports = {
  OPT_IN,
  OPT_IN_VALUE,
  URL_VARS,
  PG_VARS,
  resolveTarget,
  describeTarget,
  refusalMessage,
  announceTarget,
  connectionFor,
  resolveKnexConnection,
};
