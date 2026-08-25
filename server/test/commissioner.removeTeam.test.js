const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, remove } = require('./helpers/fakePool');
const { removeTeam } = require('../services/commissioner.service');

// --- commissioner team removal, at the authorization and phase seams --------
// Three rules, three messages: the league must be Removable at all (a fantasy
// league is removable only while pre-draft, #195), no commissioner of either
// kind may remove their own team (compared against the caller, #187), and the
// league creator's team can never be removed by anyone (compared against the
// league's owner_id). Every other removal proceeds, including revoking the
// removed manager's grant.
//
// These assert state: which teams survive, which league_commissioners rows
// survive, and who was notified. A refusal that still deleted the row would
// pass an assertion about the thrown error alone, so each refusal also asserts
// that NO delete was issued at all.

const CREATOR = 1; // the league's owner_id
const CO_COMMISSIONER = 2; // a league_commissioners row, not the owner
const MEMBER = 3; // a plain member

const SELF_MESSAGE = "you can't remove your own team";
const CREATOR_MESSAGE = "the league creator's team can't be removed";
const DRAFT_STARTED_MESSAGE = "teams can't be removed once the draft has started";

// The league columns default to a pre-draft fantasy league (removal succeeds
// as it always did); a case that needs another phase passes an override.
function removeTeamWorld(t, leagueOverrides = {}) {
  const state = {
    league: {
      id: 5, name: 'Test League', owner_id: CREATOR,
      pickem_only: false, draft_status: 'pending', season_status: 'regular',
      ...leagueOverrides,
    },
    teams: [
      { id: 10, league_id: 5, owner_id: CREATOR, name: 'Founder FC' },
      { id: 20, league_id: 5, owner_id: CO_COMMISSIONER, name: 'Deputy Dawgs' },
      { id: 30, league_id: 5, owner_id: MEMBER, name: 'Rank and File' },
    ],
    // The league_commissioners table: co-commissioner grants, owner excluded.
    grants: [CO_COMMISSIONER],
    notified: [],
    transactions: [],
    deletes: 0, // any DELETE against teams or league_commissioners
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
      state.deletes += 1;
      state.teams = state.teams.filter((team) => team.id !== params[0]);
      return { rows: [] };
    }],
    [remove('league_commissioners'), (text, params) => {
      state.deletes += 1;
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

// --- the Removable phase gate (#195) ----------------------------------------
// A fantasy league is removable only while pre-draft. Once the draft has
// started, removal is refused (409) and nothing is deleted: not the team, not
// its grant, and no notification. A pick'em-only league has no draft and stays
// removable in every phase.

test('a fantasy league still pre-draft removes normally (the phase gate allows it)', async (t) => {
  const { fake, state } = removeTeamWorld(t, { draft_status: 'pending' });

  const result = await removeTeam({ leagueId: 5, userId: CREATOR, teamId: 30 });

  assert.deepEqual(result, { leagueId: 5, removedTeamId: 30 });
  assert.deepEqual(teamIds(state), [10, 20]);
  assert.deepEqual(state.notified, [MEMBER]);
  assert.ok(state.deletes >= 1, 'the team was actually deleted');
  fake.assertClean();
});

test('a fantasy league with the draft active refuses removal and deletes nothing', async (t) => {
  const { fake, state } = removeTeamWorld(t, { draft_status: 'active' });

  await assert.rejects(
    () => removeTeam({ leagueId: 5, userId: CREATOR, teamId: 30 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, DRAFT_STARTED_MESSAGE);
      return true;
    }
  );

  assert.deepEqual(teamIds(state), [10, 20, 30]);
  assert.deepEqual(state.grants, [CO_COMMISSIONER]);
  assert.deepEqual(state.notified, []);
  assert.deepEqual(state.transactions, []);
  assert.equal(state.deletes, 0, 'no DELETE was issued on a phase refusal');
  fake.assertClean();
});

for (const season_status of ['regular', 'playoffs', 'complete']) {
  test(`a fantasy league with the draft complete (season ${season_status}) refuses removal and deletes nothing`, async (t) => {
    const { fake, state } = removeTeamWorld(t, { draft_status: 'complete', season_status });

    await assert.rejects(
      () => removeTeam({ leagueId: 5, userId: CREATOR, teamId: 30 }),
      (error) => {
        assert.equal(error.statusCode, 409);
        assert.equal(error.message, DRAFT_STARTED_MESSAGE);
        return true;
      }
    );

    assert.deepEqual(teamIds(state), [10, 20, 30]);
    assert.deepEqual(state.grants, [CO_COMMISSIONER]);
    assert.deepEqual(state.notified, []);
    assert.equal(state.deletes, 0, 'no DELETE was issued on a phase refusal');
    fake.assertClean();
  });
}

test("a pick'em-only league has no draft, so removal is unchanged whatever its status", async (t) => {
  // draft_status 'active' would block a fantasy league; a pick'em-only league
  // ignores it and stays removable.
  const { fake, state } = removeTeamWorld(t, {
    pickem_only: true, draft_status: 'active', season_status: 'regular',
  });

  const result = await removeTeam({ leagueId: 5, userId: CREATOR, teamId: 30 });

  assert.deepEqual(result, { leagueId: 5, removedTeamId: 30 });
  assert.deepEqual(teamIds(state), [10, 20]);
  assert.deepEqual(state.notified, [MEMBER]);
  assert.ok(state.deletes >= 1, 'the team was actually deleted');
  fake.assertClean();
});

test('the phase gate is checked before the per-team rules: a self-removal past pre-draft still gets one 409', async (t) => {
  // A co-commissioner removing their OWN team in an active-draft league fails
  // both the phase rule and the self rule; the ruling accepts either message,
  // and the phase rule (a property of the league) answers first.
  const { fake, state } = removeTeamWorld(t, { draft_status: 'active' });

  await assert.rejects(
    () => removeTeam({ leagueId: 5, userId: CO_COMMISSIONER, teamId: 20 }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.message, DRAFT_STARTED_MESSAGE);
      return true;
    }
  );

  assert.deepEqual(teamIds(state), [10, 20, 30]);
  assert.deepEqual(state.grants, [CO_COMMISSIONER]);
  assert.equal(state.deletes, 0);
  fake.assertClean();
});
