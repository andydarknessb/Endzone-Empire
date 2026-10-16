/**
 * League membership: who holds a Team in a league, how a manager comes to
 * hold one, and the refusal for anyone who does not.
 *
 * Membership IS the Team row (ADR 0002): a `teams` row with the manager's
 * `owner_id` is the only record that they belong to the league, in a fantasy
 * league and a pick'em-only league alike. Every league-scoped read and write
 * is gated on it and should authorize through this module:
 *
 * - `isMember` when a yes/no is enough and the caller keeps its own refusal.
 * - `requireMember` when the caller wants the Team row or the standard
 *   refusal. It refuses by throwing the coded 403 ("not a member of this
 *   league"), so call it only where the surrounding catch renders
 *   `error.statusCode`; a route that maps every error to 500 uses `isMember`.
 *
 * `joinLeague` is the only writer of `teams` rows. Every join path (creating
 * the league, an invite code, joining a public league directly, an approved
 * join request) ends in it; the paths differ only in what must be true
 * beforehand, and those gates stay at the entry points. Admission, whether
 * this manager may join this joinable league right now (not already a
 * member, league not full), is `assertAdmissible`: the same rule on every
 * path, decided when the Team is created, never when a request was filed.
 * Team-name validation (#111) lives here and nowhere else: every path must
 * supply a trimmed 1-120 character name, checked after admission (a refused
 * join never surfaces a name complaint instead of the real reason) and
 * before the insert. There is no default name to fall back to any more:
 * a manager's account identifier must never stand in for one (Team identity,
 * CONTEXT.md).
 *
 * `draft_position` is a provisional arrival order (team count + 1 at join
 * time) and nothing more: no unique constraint, every reader sorts
 * `draft_position NULLS LAST, id`, the set-draft-order route renumbers it,
 * and removals leave gaps.
 *
 * `MembershipError` is the coded error for this module and the roles built
 * on top of it (leagueRole.service.js: commissioner, owner). It carries an
 * optional `reason` in the same shape as DiscoveryError, so a route can
 * ship a joinability refusal through `serviceErrorBody`.
 *
 * The inverse write, a commissioner removing a Team, lives in
 * commissioner.service.js for now.
 */
const { joinability, joinRefusalMessage } = require('./leaguePhase');
const { isFull } = require('./leagueSize');
const { validateTeamName } = require('./teamName');

class MembershipError extends Error {
  constructor(statusCode, message, { reason } = {}) {
    super(message);
    this.statusCode = statusCode;
    if (reason) this.reason = reason;
  }
}

const NOT_A_MEMBER = 'not a member of this league';
const ALREADY_A_MEMBER = 'already has a team in this league';
const LEAGUE_FULL = 'league is full';
const BANNED = 'you have been banned from this league';

const crypto = require('crypto');

const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

/**
 * Pure: the form of an email a ban is matched on, so one inbox cannot rejoin
 * under a trivial variant. Lowercased and trimmed; a `+tag` is dropped from the
 * local part on every provider; for Gmail the dots are dropped too and
 * googlemail.com folds into gmail.com. Null for anything without an `@`.
 */
function emailBanKey(email) {
  const value = String(email || '').trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return null;
  let local = value.slice(0, at).split('+')[0];
  let domain = value.slice(at + 1);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return local ? `${local}@${domain}` : null;
}

/**
 * Pure: what a ban stores and matches, the SHA-256 of emailBanKey. A ban keeps
 * a hash, never the address, so it can outlive an account's deletion without
 * retaining the email. Null when the email has no key.
 */
function emailBanHash(email) {
  const key = emailBanKey(email);
  return key ? crypto.createHash('sha256').update(key).digest('hex') : null;
}

/**
 * Accepts a pool or a checked-out client. True when the commissioner banned
 * this account from the league, or banned an account whose email has the same
 * ban key (a re-signup after deletion, or a +tag / Gmail-dot alias).
 */
async function isBanned(db, leagueId, userId) {
  if (!leagueId || !userId) return false;
  const result = await db.query(
    `SELECT "league_bans"."user_id", "league_bans"."email_hash", "users"."email" AS "joiner_email"
     FROM "league_bans" JOIN "users" ON "users"."id" = $2
     WHERE "league_bans"."league_id" = $1`,
    [leagueId, userId]
  );
  if (result.rows.length === 0) return false;
  const joinerHash = emailBanHash(result.rows[0].joiner_email);
  return result.rows.some((ban) => ban.user_id === userId || (ban.email_hash != null && ban.email_hash === joinerHash));
}

/** Accepts a pool or a checked-out client. True when the user holds a Team in the league. */
async function isMember(db, leagueId, userId) {
  if (!leagueId || !userId) return false;
  const result = await db.query(
    `SELECT 1 FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2`,
    [leagueId, userId]
  );
  return !!result.rows[0];
}

/**
 * The member's Team row, or the standard 403 refusal. `forUpdate` locks the
 * Team row for callers about to mutate it (mirrors leagueRole.requireOwner).
 */
async function requireMember(db, { leagueId, userId, forUpdate = false }) {
  if (!leagueId || !userId) throw new MembershipError(403, NOT_A_MEMBER);
  const result = await db.query(
    `SELECT * FROM "teams" WHERE "league_id" = $1 AND "owner_id" = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [leagueId, userId]
  );
  const team = result.rows[0];
  if (!team) throw new MembershipError(403, NOT_A_MEMBER);
  return team;
}

/**
 * Admission: may `userId` join `league` right now? Admission presupposes a
 * joinable league, so that is asked first (League phase owns the answer; a
 * refusal carries its `reason`), then banned (a 403: a commissioner's Remove &
 * ban, league_bans), then already-a-member, then full. Throws
 * the 409 refusal, or returns `{ teamCount }` so the caller need not count
 * again. `league` is the row the caller already holds FOR UPDATE; `client`
 * is the same transaction, so the reads see what the lock protects.
 */
async function assertAdmissible(client, league, userId) {
  const answer = joinability(league);
  if (!answer.joinable) {
    throw new MembershipError(409, joinRefusalMessage(answer.reason), { reason: answer.reason });
  }
  if (await isBanned(client, league.id, userId)) throw new MembershipError(403, BANNED);
  if (await isMember(client, league.id, userId)) throw new MembershipError(409, ALREADY_A_MEMBER);
  const countResult = await client.query(
    `SELECT COUNT(*)::int AS n FROM "teams" WHERE "league_id" = $1`,
    [league.id]
  );
  const teamCount = countResult.rows[0].n;
  if (isFull(teamCount, league.max_teams)) throw new MembershipError(409, LEAGUE_FULL);
  return { teamCount };
}

/**
 * The membership write: `userId` joins `leagueId` with a Team named
 * `teamName`, a required trimmed 1-120 character name (validateTeamName).
 * Locks the league row (a no-op when the caller's transaction already holds
 * it), checks admission, validates the name, and inserts the Team at the
 * next arrival position. A unique violation from the insert is the
 * already-a-member refusal: a racing join got there first. Returns
 * `{ league, team }`. The caller owns BEGIN/COMMIT/ROLLBACK.
 */
async function joinLeague(client, { leagueId, userId, teamName }) {
  const leagueResult = await client.query(
    `SELECT * FROM "leagues" WHERE "id" = $1 FOR UPDATE`,
    [leagueId]
  );
  const league = leagueResult.rows[0];
  if (!league) throw new MembershipError(404, 'league not found');
  const { teamCount } = await assertAdmissible(client, league, userId);

  const { value: name, error: nameError } = validateTeamName(teamName);
  if (nameError) throw new MembershipError(400, nameError);

  let teamResult;
  try {
    teamResult = await client.query(
      `INSERT INTO "teams" ("league_id", "owner_id", "name", "draft_position")
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [leagueId, userId, name, teamCount + 1]
    );
  } catch (error) {
    if (error.code === '23505') throw new MembershipError(409, ALREADY_A_MEMBER);
    throw error;
  }
  return { league, team: teamResult.rows[0] };
}

module.exports = {
  MembershipError,
  isMember,
  isBanned,
  emailBanKey,
  emailBanHash,
  requireMember,
  assertAdmissible,
  joinLeague,
};
