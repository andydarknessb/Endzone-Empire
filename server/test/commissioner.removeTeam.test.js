const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, remove } = require('./helpers/fakePool');
const { removeTeam } = require('../services/commissioner.service');

// --- commissioner team removal, at the authorization seam (#187) ------------
// Two rules, two messages: no commissioner of either kind may remove their own
// team (compared against the caller), and the league creator's team can never
// be removed by anyone (compared against the league's owner_id). Every other
// removal proceeds, including revoking the removed manager's grant.
//
// These assert state: which teams survive, which league_commissioners rows
// survive, and who was notified. A refusal that still deleted the row would
// pass an assertion about the thrown error alone.

const CREATOR = 1; // the league's owner_id
const CO_COMMISSIONER = 2; // a league_commissioners row, not the owner
const MEMBER = 3; // a plain member

const SELF_MESSAGE = "you can't remove your own team";
const CREATOR_MESSAGE = "the league creator's team can't be removed";

function removeTeamWorld(t) {
  const state = {
    league: { id: 5, name: 'Test League', owner_id: CREATOR },
    teams: [
      { id: 10, league_id: 5, owner_id: CREATOR, name: 'Founder FC' },
      { id: 20, league_id: 5, owner_id: CO_COMMISSIONER, name: 'Deputy Dawgs' },
      { id: 30, league_id: 5, owner_id: MEMBER, name: 'Rank and File' },
    ],
    // The league_commissioners table: co-commissioner grants, owner excluded.
    grants: [CO_COMMISSIONER],
    notified: [],
    transactions: [],
  };
  const fake = createFakePool([
    // requireCommissioner's SELECT carries commissionerPredicate, whose EXISTS
    // subquery has its own FROM, so this needs a raw regex, not select().
    [/FROM "leagues" WHERE "id" = \$1/, (text, params) => ({
      rows: [{
        ...state.league,
        // What commissionerPredicate computes: owner OR a grant row.
        is_commissioner:
          params[1] === state.league.owner_id || state.grants.includes(params[1]),
      }],
    })],
    [select('teams'), (text, params) => ({
      rows: state.teams.filter((team) => team.id === params[0] && team.league_id === params[1]),
    })],
    [remove('teams'), (text, params) => {
      state.teams = state.teams.filter((team) => team.id !== params[0]);
      return { rows: [] };
    }],
    [remove('league_commissioners'), (text, params) => {
      state.grants = state.grants.filter((userId) => userId !== params[1]);
      return { rows: [] };
    }],
    [insert('transactions'), (text, params) => {
      state.transactions.push(params);
      return { rows: [] };
    }],
    [insert('notifications'), (text, params) => {
      state.notified.push(params[0]);
      return { rows: [] };
    }],
  ]).install(t);
  return { fake, state };
}

const teamIds = (state) => state.teams.map((team) => team.id);

test('a co-commissioner cannot remove their own team, and keeps the team and the grant', async (t) => {
  const { fake, state } = removeTeamWorld(t);

  await assert.rejects(
    () => removeTeam({ leagueId: 5, userId: CO_COMMISSIONER, teamId: 20 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, SELF_MESSAGE);
      return true;
    }
  );

  assert.deepEqual(teamIds(state), [10, 20, 30]);
  assert.deepEqual(state.grants, [CO_COMMISSIONER]);
  assert.deepEqual(state.notified, []);
  assert.deepEqual(state.transactions, []);
  fake.assertClean();
});

test('the owner cannot remove their own team', async (t) => {
  const { fake, state } = removeTeamWorld(t);

  await assert.rejects(
    () => removeTeam({ leagueId: 5, userId: CREATOR, teamId: 10 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      // The caller is the target, so the self-removal rule answers first.
      assert.equal(error.message, SELF_MESSAGE);
      return true;
    }
  );

  assert.deepEqual(teamIds(state), [10, 20, 30]);
  fake.assertClean();
});

test("a co-commissioner cannot remove the league creator's team", async (t) => {
  const { fake, state } = removeTeamWorld(t);

  await assert.rejects(
    () => removeTeam({ leagueId: 5, userId: CO_COMMISSIONER, teamId: 10 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, CREATOR_MESSAGE);
      return true;
    }
  );

  assert.deepEqual(teamIds(state), [10, 20, 30]);
  assert.deepEqual(state.grants, [CO_COMMISSIONER]);
  fake.assertClean();
});

test("the owner removes a co-commissioner's team, and the grant goes with it", async (t) => {
  const { fake, state } = removeTeamWorld(t);

  const result = await removeTeam({ leagueId: 5, userId: CREATOR, teamId: 20 });

  assert.deepEqual(result, { leagueId: 5, removedTeamId: 20 });
  assert.deepEqual(teamIds(state), [10, 30]);
  assert.deepEqual(state.grants, []);
  assert.deepEqual(state.notified, [CO_COMMISSIONER]);
  fake.assertClean();
});

test("a co-commissioner removes a plain member's team", async (t) => {
  const { fake, state } = removeTeamWorld(t);

  const result = await removeTeam({ leagueId: 5, userId: CO_COMMISSIONER, teamId: 30 });

  assert.deepEqual(result, { leagueId: 5, removedTeamId: 30 });
  assert.deepEqual(teamIds(state), [10, 20]);
  // The remover's own grant is untouched; only the removed manager loses one.
  assert.deepEqual(state.grants, [CO_COMMISSIONER]);
  assert.deepEqual(state.notified, [MEMBER]);
  fake.assertClean();
});

test('a plain member cannot remove any team', async (t) => {
  const { fake, state } = removeTeamWorld(t);

  await assert.rejects(
    () => removeTeam({ leagueId: 5, userId: MEMBER, teamId: 20 }),
    (error) => {
      assert.equal(error.statusCode, 403);
      return true;
    }
  );

  assert.deepEqual(teamIds(state), [10, 20, 30]);
  fake.assertClean();
});
