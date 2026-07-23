/* eslint-disable no-console */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

// Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WAIVER_STRESS_LEAGUE_ID,
// WAIVER_STRESS_TEAM_X_ID, WAIVER_STRESS_TEAM_Y_ID, WAIVER_STRESS_PLAYER_ID,
// and WAIVER_STRESS_CONFIRM=I_UNDERSTAND_THIS_MUTATES_DATA.

const CONCURRENCY = 5;
const BID = 42;
const CONFIRMATION = 'I_UNDERSTAND_THIS_MUTATES_DATA';
const TRANSACTION_SQLSTATES = new Set(['40001', '40P01', '55P03']);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredId(name) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function postgresCode(error) {
  const explicit = error?.code && String(error.code).toUpperCase();
  if (explicit && /^[0-9A-Z]{5}$/.test(explicit)) return explicit;
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(' ');
  return text.match(/\b[0-9A-Z]{5}\b/i)?.[0]?.toUpperCase() || null;
}

function classify(error) {
  const code = postgresCode(error);
  if (!error) return { category: 'success', code: null };
  if (TRANSACTION_SQLSTATES.has(code)) return { category: 'transaction_conflict', code };
  if (code === '23505') return { category: 'unique_violation', code };
  if (code === '23514' || code === '23503' || code === '23502') {
    return { category: 'constraint_violation', code };
  }
  return { category: 'other_error', code };
}

function reportedIsolation(data) {
  const row = Array.isArray(data) ? data[0] : data;
  const isolation = row?.transaction_isolation || row?.isolation_level;
  return typeof isolation === 'string' ? isolation : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(`CORRUPTION CHECK FAILED: ${message}`);
}

async function checked(label, operation) {
  const result = await operation;
  if (result.error) {
    const error = new Error(`${label}: ${result.error.message}`);
    Object.assign(error, result.error);
    throw error;
  }
  return result;
}

async function main() {
  if (process.env.WAIVER_STRESS_CONFIRM !== CONFIRMATION) {
    throw new Error(
      `Set WAIVER_STRESS_CONFIRM=${CONFIRMATION}; this script resets waiver data in a disposable test league`
    );
  }

  const leagueId = requiredId('WAIVER_STRESS_LEAGUE_ID');
  const teamXId = requiredId('WAIVER_STRESS_TEAM_X_ID');
  const teamYId = requiredId('WAIVER_STRESS_TEAM_Y_ID');
  const playerId = requiredId('WAIVER_STRESS_PLAYER_ID');
  const startingBudget = Number(process.env.WAIVER_STRESS_STARTING_BUDGET || 100);
  const rpcArgument = process.env.WAIVER_STRESS_RPC_ARGUMENT || 'p_league_id';
  const expectedIsolation = process.env.WAIVER_STRESS_ISOLATION_LEVEL || 'RPC-defined';

  assert(teamXId !== teamYId, 'Team X and Team Y must be different teams');
  assert(Number.isSafeInteger(startingBudget) && startingBudget >= BID, 'starting budget must be at least $42');

  const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const league = await checked(
    'load league',
    supabase.from('leagues').select('id,roster_limit').eq('id', leagueId).single()
  );
  const teams = await checked(
    'load teams',
    supabase.from('teams').select('id,league_id').in('id', [teamXId, teamYId])
  );
  const player = await checked(
    'load player',
    supabase.from('players').select('id').eq('id', playerId).single()
  );
  assert(league.data && player.data, 'fixture league and player must exist');
  assert(teams.data.length === 2, 'both fixture teams must exist');
  assert(teams.data.every((team) => team.league_id === leagueId), 'both teams must belong to the fixture league');

  const rosterCounts = await Promise.all(
    [teamXId, teamYId].map((teamId) =>
      checked(
        `count roster for team ${teamId}`,
        supabase.from('team_players').select('id', { count: 'exact', head: true }).eq('team_id', teamId)
      )
    )
  );
  assert(
    rosterCounts.every(({ count }) => count < league.data.roster_limit),
    'both fixture teams need an open roster slot'
  );

  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const claimCreatedAt = new Date().toISOString();

  await checked(
    'configure FAAB league',
    supabase.from('leagues').update({ waiver_type: 'faab', waivers_clear_at: dueAt }).eq('id', leagueId)
  );
  await checked(
    'reset team budgets and priorities',
    supabase
      .from('teams')
      .update({ faab_remaining: startingBudget, waiver_priority: 1 })
      .in('id', [teamXId, teamYId])
  );
  await checked(
    'remove prior claims',
    supabase.from('waiver_claims').delete().eq('league_id', leagueId).eq('player_id', playerId)
  );
  await checked(
    'remove prior roster row',
    supabase.from('team_players').delete().eq('league_id', leagueId).eq('player_id', playerId)
  );
  await checked(
    'remove prior waiver hold',
    supabase.from('waiver_players').delete().eq('league_id', leagueId).eq('player_id', playerId)
  );
  await checked(
    'insert tied claims',
    supabase.from('waiver_claims').insert([
      {
        league_id: leagueId,
        team_id: teamXId,
        player_id: playerId,
        bid: BID,
        status: 'pending',
        created_at: claimCreatedAt,
        updated_at: claimCreatedAt,
      },
      {
        league_id: leagueId,
        team_id: teamYId,
        player_id: playerId,
        bid: BID,
        status: 'pending',
        created_at: claimCreatedAt,
        updated_at: claimCreatedAt,
      },
    ])
  );

  let release;
  const startGate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = Array.from({ length: CONCURRENCY }, (_, index) =>
    (async () => {
      await startGate;
      const started = performance.now();
      try {
        const { data, error } = await supabase.rpc('process_waiver_claims', {
          [rpcArgument]: leagueId,
        });
        const classification = classify(error);
        return {
          thread: index + 1,
          ok: !error,
          milliseconds: Math.round(performance.now() - started),
          ...classification,
          isolation: reportedIsolation(data),
          message: error?.message || null,
          result: data,
        };
      } catch (error) {
        return {
          thread: index + 1,
          ok: false,
          milliseconds: Math.round(performance.now() - started),
          ...classify(error),
          isolation: null,
          message: error.message,
          result: null,
        };
      }
    })()
  );

  release();
  const outcomes = await Promise.all(calls);
  const successes = outcomes.filter(({ ok }) => ok).length;
  const transactionConflicts = outcomes.filter(({ category }) => category === 'transaction_conflict').length;
  const otherErrors = outcomes.length - successes - transactionConflicts;
  const observedIsolations = [...new Set(outcomes.map(({ isolation }) => isolation).filter(Boolean))];

  console.log({
    expectedTransactionIsolation: expectedIsolation,
    observedTransactionIsolation:
      observedIsolations.length > 0 ? observedIsolations : 'not exposed by RPC result',
  });
  console.table(
    outcomes.map(({ thread, ok, milliseconds, category, code, isolation, message }) => ({
      thread,
      ok,
      milliseconds,
      category,
      sqlstate: code,
      isolation,
      message,
    }))
  );
  console.log({
    rpcCalls: CONCURRENCY,
    successes,
    successRate: `${((successes / CONCURRENCY) * 100).toFixed(1)}%`,
    transactionConflicts,
    transactionConflictRate: `${((transactionConflicts / CONCURRENCY) * 100).toFixed(1)}%`,
    otherErrors,
    otherErrorRate: `${((otherErrors / CONCURRENCY) * 100).toFixed(1)}%`,
  });

  const [finalTeams, finalClaims, finalRoster] = await Promise.all([
    checked(
      'load final budgets',
      supabase.from('teams').select('id,faab_remaining').in('id', [teamXId, teamYId])
    ),
    checked(
      'load final claims',
      supabase
        .from('waiver_claims')
        .select('id,team_id,bid,status')
        .eq('league_id', leagueId)
        .eq('player_id', playerId)
    ),
    checked(
      'load final roster',
      supabase
        .from('team_players')
        .select('id,team_id,player_id')
        .eq('league_id', leagueId)
        .eq('player_id', playerId)
    ),
  ]);

  const wonClaims = finalClaims.data.filter(({ status }) => status === 'won');
  const lostClaims = finalClaims.data.filter(({ status }) => status === 'lost');
  assert(wonClaims.length === 1, `expected one won claim, found ${wonClaims.length}`);
  assert(lostClaims.length === 1, `expected one lost claim, found ${lostClaims.length}`);
  assert(finalRoster.data.length === 1, `expected one roster row, found ${finalRoster.data.length}`);

  const winnerId = wonClaims[0].team_id;
  const loserId = winnerId === teamXId ? teamYId : teamXId;
  assert(finalRoster.data[0].team_id === winnerId, 'rostered team does not match the winning claim');
  assert(wonClaims[0].bid === BID && lostClaims[0].bid === BID, 'both claims must retain the $42 bid');

  const budgets = new Map(finalTeams.data.map(({ id, faab_remaining }) => [id, faab_remaining]));
  assert(budgets.get(winnerId) === startingBudget - BID, 'winner budget was not deducted exactly once');
  assert(budgets.get(loserId) === startingBudget, 'loser budget changed');
  assert(
    [...budgets.values()].reduce((sum, budget) => sum + budget, 0) === startingBudget * 2 - BID,
    'combined FAAB deduction was not exactly $42'
  );

  console.log({
    integrity: 'PASS',
    winningTeamId: winnerId,
    losingTeamId: loserId,
    winnerBudget: budgets.get(winnerId),
    loserBudget: budgets.get(loserId),
    rosterRowsForPlayer: finalRoster.data.length,
    successfulClaims: wonClaims.length,
  });
}

main().catch((error) => {
  console.error({
    integrity: 'FAIL',
    sqlstate: postgresCode(error),
    message: error.message,
    details: error.details || null,
    hint: error.hint || null,
  });
  process.exitCode = 1;
});
