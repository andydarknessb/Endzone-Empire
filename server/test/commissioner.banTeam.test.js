const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool, select, insert, update, remove } = require('./helpers/fakePool');
const { banTeam, listBans, unban } = require('../services/commissioner.service');

// --- Remove & ban ------------------------------------------------------------
// The same per-team rules as removeTeam (shared loadTeamToRemove), then a ban
// row, then the team's fate by League phase: deleted while Removable, handed to
// the CPU (owner_id NULL) once the draft has started, with its open trades and
// pending claims cancelled. Refusals assert state unchanged and the protected
// writes at zero (docs/agents/refusal-tests.md).

const CREATOR = 1;
const CO_COMMISSIONER = 2;
const MEMBER = 3;

function banWorld(t, leagueOverrides = {}) {
  const state = {
    league: {
      id: 5, name: 'Minneapple League', owner_id: CREATOR,
      pickem_only: false, draft_status: 'pending', season_status: 'regular',
      ...leagueOverrides,
    },
    teams: [
      { id: 10, league_id: 5, owner_id: CREATOR, name: 'Founder FC' },
      { id: 20, league_id: 5, owner_id: CO_COMMISSIONER, name: 'Deputy Dawgs' },
      { id: 30, league_id: 5, owner_id: MEMBER, name: 'Rank and File' },
      { id: 40, league_id: 5, owner_id: null, name: 'Already CPU' },
    ],
    grants: [CO_COMMISSIONER],
    bans: [],
    cancelledTradesFor: [],
    cancelledClaimsFor: [],
    notified: [],
    transactions: [],
  };
  const fake = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1/, (text, params) => ({
      rows: [{
        ...state.league,
        is_commissioner: params[1] === state.league.owner_id || state.grants.includes(params[1]),
      }],
    })],
    [select('teams'), (text, params) => ({
      rows: state.teams.filter((team) => team.id === params[0] && team.league_id === params[1]),
    })],
    [select('league_commissioners'), (text, params) => ({
      rows: state.grants.includes(params[1]) ? [{ '?column?': 1 }] : [],
    })],
    [insert('league_bans'), (text, params) => {
      state.bans.push({ id: state.bans.length + 1, user_id: params[1], team_name: params[2], banned_by: params[3] });
      return { rows: [] };
    }],
    [remove('league_commissioners'), (text, params) => {
      state.grants = state.grants.filter((userId) => userId !== params[1]);
      return { rows: [] };
    }],
    [remove('teams'), (text, params) => {
      state.teams = state.teams.filter((team) => team.id !== params[0]);
      return { rows: [] };
    }],
    [update('teams'), (text, params) => {
      const team = state.teams.find((row) => row.id === params[0]);
      team.owner_id = null;
      team.autodraft = true;
      return { rows: [] };
    }],
    [update('trades'), (text, params) => {
      state.cancelledTradesFor.push(params[1]);
      return { rows: [] };
    }],
    [update('waiver_claims'), (text, params) => {
      state.cancelledClaimsFor.push(params[0]);
      return { rows: [] };
    }],
    [insert('transactions'), (text, params) => {
      state.transactions.push(JSON.parse(params[3]));
      return { rows: [] };
    }],
    [insert('notifications'), (text, params) => {
      state.notified.push(params[0]);
      return { rows: [] };
    }],
  ]).install(t);
  return { fake, state };
}

const DRAFTED = { draft_status: 'complete', season_status: 'regular' };

test('pre-draft: Remove & ban deletes the team, bans the account by Team name, and tells the manager', async (t) => {
  const { fake, state } = banWorld(t);

  const result = await banTeam({ leagueId: 5, userId: CREATOR, teamId: 30 });

  assert.deepEqual(result, { leagueId: 5, teamId: 30, outcome: 'removed' });
  assert.deepEqual(state.teams.map((team) => team.id), [10, 20, 40]);
  assert.deepEqual(state.bans, [{ id: 1, user_id: MEMBER, team_name: 'Rank and File', banned_by: CREATOR }]);
  assert.deepEqual(state.notified, [MEMBER]);
  assert.equal(state.transactions[0].action, 'ban_team');
  assert.equal(state.transactions[0].outcome, 'removed');
  assert.equal(fake.matching(update('teams')).length, 0, 'a removable league deletes, never hands to the CPU');
  fake.assertClean();
});

test('after the draft: the team stays, CPU-managed, with its trades and claims cancelled', async (t) => {
  const { fake, state } = banWorld(t, DRAFTED);

  const result = await banTeam({ leagueId: 5, userId: CREATOR, teamId: 30 });

  assert.deepEqual(result, { leagueId: 5, teamId: 30, outcome: 'cpu' });
  const team = state.teams.find((row) => row.id === 30);
  assert.equal(team.owner_id, null);
  assert.equal(team.autodraft, true);
  assert.deepEqual(state.cancelledTradesFor, [30]);
  assert.deepEqual(state.cancelledClaimsFor, [30]);
  assert.deepEqual(state.bans.map((ban) => ban.user_id), [MEMBER]);
  assert.deepEqual(state.notified, [MEMBER]);
  assert.equal(fake.matching(remove('teams')).length, 0, 'a drafted team is never deleted');
  fake.assertClean();
});

test("the creator bans a co-commissioner's team and the grant goes with it", async (t) => {
  const { fake, state } = banWorld(t, DRAFTED);

  await banTeam({ leagueId: 5, userId: CREATOR, teamId: 20 });

  assert.deepEqual(state.grants, []);
  assert.deepEqual(state.bans.map((ban) => ban.user_id), [CO_COMMISSIONER]);
  fake.assertClean();
});

for (const [name, userId, teamId, statusCode, message] of [
  ['your own team', CO_COMMISSIONER, 20, 409, "you can't remove your own team"],
  ["the creator's team", CO_COMMISSIONER, 10, 409, "the league creator's team can't be removed"],
  ['a team already managed by the CPU', CREATOR, 40, 409, 'that team is already managed by the CPU'],
  ['a team in another league', CREATOR, 99, 404, 'team not found in this league'],
  ['a plain member banning anyone', MEMBER, 20, 403, 'only the commissioner can do this'],
]) {
  test(`refuses ${name}, and bans, deletes and cancels nothing`, async (t) => {
    const { fake, state } = banWorld(t, DRAFTED);

    await assert.rejects(
      () => banTeam({ leagueId: 5, userId, teamId }),
      (error) => {
        assert.equal(error.statusCode, statusCode);
        assert.equal(error.message, message);
        return true;
      }
    );

    assert.deepEqual(state.bans, []);
    assert.equal(fake.matching(insert('league_bans')).length, 0);
    assert.equal(fake.matching(update('teams')).length, 0);
    assert.equal(fake.matching(remove('teams')).length, 0);
    assert.deepEqual(state.notified, []);
    fake.assertClean();
  });
}

test('listBans serves id, Team name and date only, never the account', async (t) => {
  const fake = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 5, owner_id: CREATOR, is_commissioner: true }] })],
    [select('league_bans'), () => ({
      rows: [{ id: 7, team_name: 'Rank and File', created_at: 'then', user_id: MEMBER, banned_by: CREATOR }],
    })],
  ]).install(t);

  assert.deepEqual(await listBans({ leagueId: 5, userId: CREATOR }), [
    { id: 7, team_name: 'Rank and File', created_at: 'then' },
  ]);
  fake.assertClean();
});

test('unban deletes the row and logs it; an unknown ban is a 404', async (t) => {
  const deleted = [];
  const fake = createFakePool([
    [/FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 5, owner_id: CREATOR, is_commissioner: true }] })],
    [remove('league_bans'), (text, [banId]) => {
      if (banId !== 7) return { rows: [] };
      deleted.push(banId);
      return { rows: [{ team_name: 'Rank and File' }] };
    }],
    [insert('transactions'), () => ({ rows: [] })],
  ]).install(t);

  assert.deepEqual(await unban({ leagueId: 5, userId: CREATOR, banId: 7 }), { leagueId: 5, banId: 7 });
  assert.deepEqual(deleted, [7]);
  await assert.rejects(
    () => unban({ leagueId: 5, userId: CREATOR, banId: 8 }),
    (error) => error.statusCode === 404
  );
  fake.assertClean();
});
