const pool = require('../modules/pool');
const { isMember } = require('./leagueMembership.service');
const {
  isLeagueCommissioner,
  listCoCommissioners,
  serializeCoCommissioners,
  coCommissionerTeamIds,
} = require('./leagueRole.service');
const { getMarketStatus } = require('./adp.service');
const { teamIdentityColumns, teamIdentityJoin, viewerTeamIdOf } = require('./teamIdentity');
const irPolicy = require('./irPolicy.service');

/**
 * `GET /api/league/:id`'s read, extracted out of the route so it can be
 * tested and reasoned about apart from HTTP plumbing (#1499, same shape as
 * the Players page module: a call plus a coded refusal, with the route left
 * to authenticate, call, and map status). The route's body is now a call to
 * `leagueDetail` plus the two-way status mapping below.
 *
 * A refusal is a `LeagueDetailError` carrying `statusCode` and a stable
 * `code` (ADR 0032's discriminator convention) alongside its `message`. The
 * route keeps emitting exactly what it always has - `{ error: <message> }`,
 * no `code` on the wire - so responses stay byte-equal; this route is not
 * one of ADR 0032's thirteen envelope conversions, and nothing about its
 * wire shape changes here.
 */
class LeagueDetailError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const LEAGUE_NOT_FOUND = 'league not found';
const NOT_A_MEMBER = 'not a member of this league';

/**
 * `{ viewerTeamId, league, teams }` for one league, as one viewer may read
 * it - teams, owners and roster counts (the module's own doc heading in the
 * route used to carry this comment). Throws `LeagueDetailError(404, ...)`
 * when the league does not exist and `LeagueDetailError(403, ...)` when the
 * viewer holds no Team in it. `db` defaults to the shared pool; the shared
 * fake-pool helper (server/test/helpers/fakePool.js) is passed straight in
 * as `db` by this module's tests rather than mocking the pool module.
 */
async function leagueDetail({ leagueId, viewer }, { db = pool } = {}) {
  // The league is a shared surface, so a consumer names the creator by Team
  // identity alone (#112, parent #108, contracted by #115). The account
  // username the EXPAND step served beside it (`owner_username`) is gone, and
  // with it the users JOIN that supplied it. `leagues.owner_id` stays on
  // `leagues.*`: it is a league-level column (which account created the
  // league), not another member's account identity fanned out per row the
  // way `teams[].owner_id` was, and #334's survey scoped its removal out of
  // #343 - only `owner_username` leaves this object here. LEFT JOIN for Team
  // identity because a creator removed from their own league leaves no team.
  const leagueResult = await db.query(
    `SELECT "leagues".*,
            ${teamIdentityColumns('owner_team', 'owner')}
       FROM "leagues"
       ${teamIdentityJoin('"leagues"."id"', '"leagues"."owner_id"', 'owner_team')}
      WHERE "leagues"."id" = $1`,
    [leagueId]
  );
  const league = leagueResult.rows[0];
  if (!league) throw new LeagueDetailError(404, 'LEAGUE_NOT_FOUND', LEAGUE_NOT_FOUND);

  if (!(await isMember(db, leagueId, viewer))) {
    throw new LeagueDetailError(403, 'NOT_A_MEMBER', NOT_A_MEMBER);
  }

  const teamsResult = await db.query(
    `SELECT "teams"."id", "teams"."name", "teams"."draft_position",
            "teams"."faab_remaining", "teams"."locked", "teams"."draft_ready",
            "teams"."avatar_url", "teams"."avatar_static_url",
            -- owner_id rides here only so viewerTeamIdOf() can pick out the
            -- caller's own team off the raw rows below; it is account identity
            -- and is stripped from the serialized teams[] entry (#343, #115).
            "teams"."owner_id",
            ${teamIdentityColumns()},
            COUNT("team_players"."id")::int AS "roster_count"
     -- #1214: this used to also LEFT JOIN "matchups" and sum a "total_points"
     -- column, which fanned every team_players row out across every matchup
     -- row (roster_count = roster size x matchups played; total_points =
     -- points x roster size). total_points had no consumer under src/ and was
     -- the wrong number by rule regardless (Record is computed once, from
     -- finalized regular-season matchups only, by season.getStandings) - so
     -- both the join and the column are gone rather than patched.
     FROM "teams"
     LEFT JOIN "team_players" ON "team_players"."team_id" = "teams"."id"
     WHERE "teams"."league_id" = $1
     GROUP BY "teams"."id"
     ORDER BY "teams"."draft_position", "teams"."id"`,
    [leagueId]
  );
  // is_commissioner is the viewer's effective role (owner or co-commissioner)
  // — every client-side commissioner gate reads it.
  //
  // Who holds commissioner power stays visible to every member: knowing who
  // can rule on your trade isn't sensitive, and it saves a second request.
  // What changed in #324 is how that fact is told. CONTEXT.md's Team
  // identity rule admits no exception for role disclosure, so power is a
  // property of the TEAM and never an account handed over with it. The two
  // kinds of commissioner are told apart on the same terms: the creator is
  // `league.ownerTeamId` / `ownerTeamName`, already here, and a GRANT is
  // `teams[].is_co_commissioner` below. The flag is deliberately the grant
  // alone - the creator's team is not flagged, because the creator is named
  // on the league itself and conflating them would lose which is which.
  // The account ids grant and revoke need ride commissioner-conditionally,
  // stripped by the same `is_commissioner` check as `invite_code` two lines
  // below, which is the precedent this follows rather than a new mechanism.
  league.is_commissioner = await isLeagueCommissioner(db, leagueId, viewer);
  const coCommissionerRows = await listCoCommissioners(db, leagueId);
  league.co_commissioners = serializeCoCommissioners(coCommissionerRows, {
    isCommissioner: league.is_commissioner,
  });
  // Only a commissioner should see the invite code
  if (!league.is_commissioner) delete league.invite_code;
  // The player market's observable state (#748): how many players carry an
  // ADP, the floor, the last successful sync, and staleness. Not gated on
  // is_commissioner the way invite_code is above - the control that reads it
  // (DraftStartControl) is already commissioner-scoped at the call site, so
  // there is nothing sensitive here for a plain member to see and no second
  // gate to keep in sync with the first. It IS gated on the draft being
  // pending (decision 3, 758-f2): a running or finished draft already used
  // whatever market it had, so the field has no meaning past that point.
  // Gating it here, once, means every current and future consumer gets the
  // rule for free instead of re-deriving "pending" from draft_status itself.
  //
  // getMarketStatus() reaches the shared pool directly rather than through
  // `db` (it always has, from before this extraction) - unchanged here, so a
  // caller that overrides `db` still exercises the real market read exactly
  // as the route did.
  if (league.draft_status === 'pending') league.market = await getMarketStatus();
  // Derived from the ROWS rather than from what this viewer was served, so
  // the flag says the same thing to a member as to a commissioner: a team is
  // flagged exactly when a grant names it. Team identity on both sides of
  // the match, so there is nothing to explain about which column is which.
  const grantedTeamIds = coCommissionerTeamIds(coCommissionerRows);
  // roster_capacity beside roster_count (#1475): how many players the team
  // may hold RIGHT NOW under the occupancy-based rule (CONTEXT.md, Roster
  // capacity) - the draft roster size plus one spot per IR-eligible player
  // actually stashed in IR. roster_limit stays on the league row with its
  // IR-inclusive meaning; a "19/20" built from it reads as a spot to spare
  // on a roster the waiver claim and free-agent add both refuse as full.
  const capacityByTeam = await irPolicy.rosterCapacityByTeam(db, {
    league,
    teamIds: teamsResult.rows.map((team) => team.id),
  });
  const teams = teamsResult.rows.map((team) => {
    // A teams[] entry names its manager by Team identity only. `owner_id`
    // rode on the raw row so viewerTeamIdOf() could resolve the caller's team
    // (below); strip it from the serialization so no member reads another
    // manager's account id (#343, #115). `owner` (the username) is no longer
    // selected; the delete is defensive against a raw row that still carries
    // one.
    const entry = {
      ...team,
      roster_capacity: capacityByTeam.get(Number(team.id)) ?? null,
      is_co_commissioner: grantedTeamIds.has(team.teamId),
    };
    delete entry.owner_id;
    delete entry.owner;
    return entry;
  });

  // viewerTeamId is how a consumer answers "which of these is me" without
  // holding another manager's account ID (#112): teamId === viewerTeamId.
  return {
    viewerTeamId: viewerTeamIdOf(teamsResult.rows, viewer),
    league,
    teams,
  };
}

module.exports = { leagueDetail, LeagueDetailError, LEAGUE_NOT_FOUND, NOT_A_MEMBER };
