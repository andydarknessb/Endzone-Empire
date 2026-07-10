/**
 * Sample player pool so the app is usable before a RapidAPI sync runs.
 * The scoring service upserts real players by external_id, so these rows
 * (external_id null) coexist with synced data.
 */
exports.seed = async function (knex) {
  const existing = await knex('players').count('id as n').first();
  if (Number(existing.n) > 0) return; // don't clobber synced data

  await knex('players').insert([
    { name: 'Patrick Mahomes', position: 'QB', nfl_team: 'Kansas City Chiefs' },
    { name: 'Josh Allen', position: 'QB', nfl_team: 'Buffalo Bills' },
    { name: 'Lamar Jackson', position: 'QB', nfl_team: 'Baltimore Ravens' },
    { name: 'Jalen Hurts', position: 'QB', nfl_team: 'Philadelphia Eagles' },
    { name: 'Christian McCaffrey', position: 'RB', nfl_team: 'San Francisco 49ers' },
    { name: 'Bijan Robinson', position: 'RB', nfl_team: 'Atlanta Falcons' },
    { name: 'Saquon Barkley', position: 'RB', nfl_team: 'Philadelphia Eagles' },
    { name: 'Derrick Henry', position: 'RB', nfl_team: 'Baltimore Ravens' },
    { name: 'Jahmyr Gibbs', position: 'RB', nfl_team: 'Detroit Lions' },
    { name: 'Breece Hall', position: 'RB', nfl_team: 'New York Jets' },
    { name: 'Justin Jefferson', position: 'WR', nfl_team: 'Minnesota Vikings' },
    { name: "Ja'Marr Chase", position: 'WR', nfl_team: 'Cincinnati Bengals' },
    { name: 'CeeDee Lamb', position: 'WR', nfl_team: 'Dallas Cowboys' },
    { name: 'Amon-Ra St. Brown', position: 'WR', nfl_team: 'Detroit Lions' },
    { name: 'Tyreek Hill', position: 'WR', nfl_team: 'Miami Dolphins' },
    { name: 'A.J. Brown', position: 'WR', nfl_team: 'Philadelphia Eagles' },
    { name: 'Puka Nacua', position: 'WR', nfl_team: 'Los Angeles Rams' },
    { name: 'Garrett Wilson', position: 'WR', nfl_team: 'New York Jets' },
    { name: 'Travis Kelce', position: 'TE', nfl_team: 'Kansas City Chiefs' },
    { name: 'Sam LaPorta', position: 'TE', nfl_team: 'Detroit Lions' },
    { name: 'Mark Andrews', position: 'TE', nfl_team: 'Baltimore Ravens' },
    { name: 'Trey McBride', position: 'TE', nfl_team: 'Arizona Cardinals' },
    { name: 'Justin Tucker', position: 'K', nfl_team: 'Baltimore Ravens' },
    { name: 'Harrison Butker', position: 'K', nfl_team: 'Kansas City Chiefs' },
    { name: 'San Francisco 49ers', position: 'DEF', nfl_team: 'San Francisco 49ers' },
    { name: 'Dallas Cowboys', position: 'DEF', nfl_team: 'Dallas Cowboys' },
  ]);
};
