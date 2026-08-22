const pool = require('../modules/pool');

/**
 * League type gate. A pick'em-only league (leagues.pickem_only = true) has no
 * draft, rosters, lineups, matchups, waivers, trades, or fantasy scoring, so
 * every fantasy mutation is refused at the smallest set of choke points:
 * blanket router mounts (draft, scoring), a few explicit route guards, and
 * service-level one-liners for defense in depth. 409 not 403: the caller is
 * authorized, the league's type just makes the action meaningless (the same
 * semantics as PICKEM_MODE_LOCKED).
 *
 * The mounts and route guards answer before each route's own membership or
 * commissioner check, so any signed-in caller who knows a league id can learn
 * it is pick'em-only, private leagues included. Accepted: league type is
 * non-sensitive metadata (join-public already tells strangers a league's
 * is_public and draft state), and a mount cannot know each route's
 * authorization rule.
 */

const PICKEM_ONLY_CODE = 'PICKEM_ONLY_LEAGUE';
const PICKEM_ONLY_MESSAGE = "this is a pick'em league; it has no draft, rosters, or matchups";

class PickemOnlyLeagueError extends Error {
  constructor(message = PICKEM_ONLY_MESSAGE) {
    super(message);
    this.statusCode = 409;
    this.code = PICKEM_ONLY_CODE;
  }
}

/** Pure: does this leagues row describe a pick'em-only league? */
function isPickemOnly(league) {
  return Boolean(league && league.pickem_only);
}

/**
 * Throw for a pick'em-only league row. For services that already hold the
 * row (SELECT * FROM "leagues"), this is the one-liner to add beside their
 * existing guards.
 */
function assertFantasyLeagueRow(league) {
  if (isPickemOnly(league)) throw new PickemOnlyLeagueError();
}

/**
 * Look the league up and throw for a pick'em-only one. An unknown league is
 * NOT an error here: the caller owns its own not-found / not-a-member
 * semantics, this only answers "is the action meaningful for this type".
 * `db` is a pool or a checked-out client.
 */
async function assertFantasyLeague(db, leagueId) {
  const result = await db.query(
    `SELECT "pickem_only" FROM "leagues" WHERE "id" = $1`,
    [leagueId]
  );
  assertFantasyLeagueRow(result.rows[0]);
}

/* ------------------------------------------------------------------ *
 * SQL fragments. Code literals only: the alias is a table alias chosen *
 * by the caller, never request input, and it is validated as an       *
 * identifier so the fragment can be spliced where discovery already   *
 * splices code-literal fragments.                                     *
 * ------------------------------------------------------------------ */

function column(alias, name) {
  if (alias === undefined || alias === null || alias === '') return `"${name}"`;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(alias))) {
    throw new Error(`leagueType: table alias must be a bare identifier, got ${JSON.stringify(alias)}`);
  }
  return `"${alias}"."${name}"`;
}

/** WHERE fragment: matches a pick'em-only league. No polarity flag — it reads as the rule it states. */
function pickemOnlyWhereSql(alias) {
  return `${column(alias, 'pickem_only')} = true`;
}

/** WHERE fragment: matches a league with a fantasy side. */
function fantasySideWhereSql(alias) {
  return `${column(alias, 'pickem_only')} = false`;
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Express middleware factory. Mount with a param path so the league id is
 * available: `router.use('/league/:id', requireFantasyLeague())`. For the odd
 * write that carries its league id in the body instead, mount it on the route
 * with `from: 'body'` (`from` is 'params' | 'body'). With writesOnly
 * (the default) reads pass untouched so shared components' speculative GETs
 * never turn into error banners; writes always fail closed. A malformed or
 * unknown id is left to the route's own validation.
 */
function requireFantasyLeague({ param = 'id', from = 'params', writesOnly = true } = {}) {
  return async (req, res, next) => {
    if (writesOnly && READ_METHODS.has(req.method)) return next();
    const raw = (req[from] || {})[param];
    if (!/^\d+$/.test(String(raw))) return next();
    try {
      await assertFantasyLeague(pool, Number(raw));
    } catch (error) {
      if (error instanceof PickemOnlyLeagueError) {
        return res.status(error.statusCode).json({ error: error.message, code: error.code });
      }
      console.error('league type check failed', error);
      return res.status(500).json({ error: 'failed to check league type' });
    }
    return next();
  };
}

module.exports = {
  PICKEM_ONLY_CODE,
  PICKEM_ONLY_MESSAGE,
  PickemOnlyLeagueError,
  isPickemOnly,
  assertFantasyLeagueRow,
  assertFantasyLeague,
  requireFantasyLeague,
  column,
  pickemOnlyWhereSql,
  fantasySideWhereSql,
};
