/**
 * The database world the join handlers read when they run for real (#231).
 *
 * THE MASKING TRAP THIS FILE EXISTS TO AVOID. Both join handlers wrap their
 * body in a try/catch that acks a generic failure - 'failed to join draft
 * room' / 'failed to join league room'. An unanswered query throws inside
 * `createFakePool`, so a fixture GAP and a genuine refusal both come back as
 * "an error". A test asserting merely that an error arrived would pass while
 * proving nothing. Two things keep that honest:
 *
 *   1. every query either handler issues is answered here, explicitly, and
 *      the list below is the whole of it;
 *   2. the suite asserts the SPECIFIC error string, never truthiness, so a
 *      gap ('failed to join ...') can never impersonate a refusal ('you are
 *      not in this league').
 *
 * Two of the five collide under the shape matchers: `select('teams')` matches
 * BOTH the viewer's own team read and the draft-state teams read, and
 * `select('leagues')` matches BOTH the commissioner question and the
 * draft-state league read. They are separated the way the fakePool header
 * prescribes - "put overrides before defaults" - so the narrow raw regex for
 * one goes FIRST and the reformat-tolerant `select(table)` catches the other.
 * Keying both on exact column lists instead would break on a harmless column
 * addition.
 *
 *   both joins   lookupTeam            SELECT "id", "name" FROM "teams" ...
 *   both joins   isLeagueCommissioner  SELECT 1 FROM "leagues" ... EXISTS (league_commissioners)
 *   draft:join   getDraftState league  SELECT * FROM "leagues" WHERE "id" = $1
 *   draft:join   getDraftState teams   ... FROM "teams" JOIN "users" ...
 *   draft:join   getDraftState picks   ... FROM "draft_picks" JOIN "players" ...
 *
 * What this proves and what it does not: like `draftJoinCommissioner`'s
 * fixture, the commissioner predicate is not EXECUTED here - the world
 * answers from a JS Set, playing the rows Postgres would return without
 * running the SQL. Evidence about the ANSWER comes from that; evidence about
 * the QUESTION comes from `fake.calls`, which the suite reads back.
 *
 * That sibling fixture is a hand-written duplicate of this one - same manager
 * ids, same Team names, same `{ coCommissioners }` signature - and NOTHING
 * keeps the two in step (#260). Read the "NOT ENFORCED" note in
 * socketJoinEndToEnd.test.js's header before changing anything here.
 */
const { createFakePool, select } = require('./fakePool');

const LEAGUE_ID = 1;

const OWNER = { userId: 7, username: 'commish', teamId: 71, teamName: 'Founding Fathers' };
const CO_COMMISSIONER = { userId: 8, username: 'second', teamId: 81, teamName: 'Second Chair' };
const MEMBER = { userId: 9, username: 'manager', teamId: 91, teamName: 'Just Here To Draft' };
/** Holds no Team in this league, so ADR 0002 makes them a non-member. */
const OUTSIDER = { userId: 404, username: 'stranger' };

const MANAGERS = [OWNER, CO_COMMISSIONER, MEMBER];

/** The `leagues` row `getDraftState` reads. Pending on purpose: an active
 *  draft would pull `teamForPick` and the draft-order rules into a test that
 *  is about the join acknowledgement and nothing else. */
const LEAGUE_ROW = {
  id: LEAGUE_ID,
  name: 'The League',
  owner_id: OWNER.userId,
  draft_status: 'pending',
  current_pick: 1,
  draft_rotation: 'snake',
  draft_order_overrides: null,
  invite_code: 'SECRET-CODE',
};

/**
 * A league whose commissioners are exactly the owner plus `coCommissioners`,
 * and whose members are exactly MANAGERS.
 */
function leagueWorld({ coCommissioners = [] } = {}) {
  const commissioners = new Set([OWNER.userId, ...coCommissioners]);
  /** The manager holding a Team in this league, or undefined. Not a
   *  predicate: callers need the Team it found, not just whether one exists. */
  const managerIn = (leagueId, userId) =>
    (leagueId === LEAGUE_ID ? MANAGERS.find((m) => m.userId === userId) : undefined);

  return createFakePool([
    // OVERRIDE FIRST: the draft-state teams read, which `select('teams')`
    // below would otherwise swallow.
    [/FROM "teams" JOIN "users"/,
      (text, [leagueId]) => ({
        rows: leagueId === LEAGUE_ID
          ? MANAGERS.map((m, index) => ({
            id: m.teamId,
            name: m.teamName,
            draft_position: index + 1,
            autodraft: false,
            draft_ready: false,
            owner_id: m.userId,
            teamId: m.teamId,
            teamName: m.teamName,
            owner: m.username,
          }))
          : [],
      })],

    // viewerContext -> lookupTeam. The viewer's Team IS their membership
    // (ADR 0002), so this one read is also the "may they join" answer.
    [select('teams'), (text, [leagueId, userId]) => {
      const manager = managerIn(leagueId, userId);
      return { rows: manager ? [{ id: manager.teamId, name: manager.teamName }] : [] };
    }],

    // OVERRIDE FIRST again: the commissioner question, ahead of the
    // draft-state league read that `select('leagues')` answers.
    // Owner OR a league_commissioners row, both decided by one Set so the
    // two kinds of commissioner cannot drift apart.
    [/^SELECT 1 FROM "leagues"/, (text, [leagueId, userId]) => ({
      rows: leagueId === LEAGUE_ID && commissioners.has(userId) ? [{ '?column?': 1 }] : [],
    })],

    // getDraftState's three reads, reached only by draft:join and only once
    // the membership answer above was yes.
    [select('leagues'), (text, [leagueId]) => ({
      rows: leagueId === LEAGUE_ID ? [{ ...LEAGUE_ROW }] : [],
    })],

    [/FROM "draft_picks" JOIN "players"/, () => ({ rows: [] })],
  ]);
}

module.exports = {
  leagueWorld,
  LEAGUE_ID,
  OWNER,
  CO_COMMISSIONER,
  MEMBER,
  OUTSIDER,
};
