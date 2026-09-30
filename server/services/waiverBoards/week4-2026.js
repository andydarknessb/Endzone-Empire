/**
 * Week 4 2026 editorial waiver board, seeded from the Week 4 Darkness Report's
 * "The Full Board" table (src/content/articles/week4-waiver-wire-darkness-report.jsx),
 * in the column's order. Bids are percent of a $100 FAAB budget; the `$1` rows
 * are 1..1. All 18 are kept so the endpoint's cap still fills after the Ownership
 * cutoff drops some. `playerId` values are the production `players.id` rows that
 * carry an `external_id`, posted by the project lead on #1836.
 *
 * @type {import('./index').WaiverBoard}
 */
module.exports = {
  season: 2026,
  week: 4,
  entries: [
    {
      playerId: 1485,
      name: 'Braelon Allen',
      bidMin: 12,
      bidMax: 18,
      reason: 'Hall week-to-week (thigh). Lead back in a hot offense.',
    },
    {
      playerId: 1271,
      name: 'Ollie Gordon II',
      bidMin: 12,
      bidMax: 15,
      reason: 'Achane on IR, torn ACL. 17 carries, TD. Bad Week 4 spot.',
    },
    {
      playerId: 202,
      name: 'Kenyon Sadiq',
      bidMin: 8,
      bidMax: 12,
      reason: '7 for 105 and a TD. Mason Taylor out (thumb).',
    },
    {
      playerId: 266,
      name: 'Alvin Kamara',
      bidMin: 5,
      bidMax: 8,
      reason:
        'Etienne will miss time (hamstring). Thin Week 3: 9 for 36, 1 catch. Shares with Kendre Miller.',
    },
    {
      playerId: 563,
      name: 'Keenan Allen',
      bidMin: 3,
      bidMax: 6,
      reason:
        'Pierce on IR. 6 for 63 and a TD on 9 targets. Washington has been gashed by receivers.',
    },
    {
      playerId: 197,
      name: 'Jaylen Wright',
      bidMin: 3,
      bidMax: 7,
      reason:
        'The other half of the Achane vacancy. Missed Week 3 (stinger, foot). Coach calls him day-to-day.',
    },
    {
      playerId: 1310,
      name: 'Darren Waller',
      bidMin: 2,
      bidMax: 4,
      reason: 'Season-high 39 snaps, double digits without a score. Coker and Legette banged up.',
    },
    {
      playerId: 487,
      name: 'Jakobi Meyers',
      bidMin: 2,
      bidMax: 4,
      reason: '7 for 64 and a TD on 8 targets, 80%+ snaps. Highest total of the week (51.5).',
    },
    {
      playerId: 1434,
      name: 'Sam Darnold',
      bidMin: 1,
      bidMax: 3,
      reason: 'Back from the glute: 379 yards, 4 TD. Winless Chargers at home, SEA -7.',
    },
    {
      playerId: 486,
      name: 'Jacoby Brissett',
      bidMin: 1,
      bidMax: 3,
      reason:
        "Arizona's starter since Week 1. CBS's top QB add. Faces a Giants team on its backup QB.",
    },
    {
      playerId: 1093,
      name: "Wan'Dale Robinson",
      bidMin: 1,
      bidMax: 3,
      reason: 'Team-high 11 targets, 7 for 57 and a TD. PPR floor.',
    },
    {
      playerId: 324,
      name: 'Geno Smith',
      bidMin: 1,
      bidMax: 2,
      reason: '31 of 37, 321 yards, 3 TD, no picks against Detroit.',
    },
    {
      playerId: 100,
      name: 'Mack Hollins',
      bidMin: 1,
      bidMax: 2,
      reason: 'A.J. Brown on IR (high ankle). Team-leading 12 catches, 6 for 87 last week.',
    },
    {
      playerId: 1160,
      name: "Tre' Harris",
      bidMin: 1,
      bidMax: 2,
      reason: 'Team-high 7 targets, 6 for 76, 63% of routes. Pushing Quentin Johnston.',
    },
    {
      playerId: 714,
      name: 'Kirk Cousins',
      bidMin: 1,
      bidMax: 1,
      reason: 'Nine touchdown passes, three in every game.',
    },
    {
      playerId: 1360,
      name: 'Mike Gesicki',
      bidMin: 1,
      bidMax: 1,
      reason: 'Touchdown in Week 3. Same 51.5-total game as Meyers.',
    },
    {
      playerId: 566,
      name: 'Marcus Mariota',
      bidMin: 1,
      bidMax: 1,
      reason: '3 TD in the win over Seattle. Only if Jayden Daniels sits.',
    },
    {
      playerId: 105,
      name: 'Kendre Miller',
      bidMin: 1,
      bidMax: 1,
      reason: 'The other half of the Etienne vacancy. 4 for 14 and 2 catches in Week 3.',
    },
  ],
};
