/**
 * Week 5 2026 editorial waiver board, seeded from the Week 5 Darkness Report's
 * "The Full Board" table (src/content/articles/week5-waiver-wire-darkness-report.jsx),
 * in the column's order. Bids are percent of a $100 FAAB budget; the `$1` rows
 * are 1..1. All 21 are kept so the endpoint's cap still fills after the Ownership
 * cutoff drops some. `playerId` values are the production `players.id` rows from
 * the editorial rulings for issue #2022.
 *
 * @type {import('./index').WaiverBoard}
 */
module.exports = {
  season: 2026,
  week: 5,
  entries: [
    {
      playerId: 363,
      name: 'Emanuel Wilson',
      bidMin: 12,
      bidMax: 18,
      reason: 'Charbonnet out Week 5, Price on IR. 81 yards, two TDs, 28.5 points.',
    },
    {
      playerId: 845,
      name: 'Will Shipley',
      bidMin: 10,
      bidMax: 15,
      reason: 'Barkley week-to-week (hamstring), Bigsby to IR. Projected for 15+ touches.',
    },
    {
      playerId: 1388,
      name: 'Keon Coleman',
      bidMin: 8,
      bidMax: 12,
      reason: '6 for 116 and a TD. DJ Moore hurt (AC joint).',
    },
    {
      playerId: 398,
      name: 'T.J. Hockenson',
      bidMin: 6,
      bidMax: 10,
      reason: '13 for 119 on a 39% target share without Jefferson.',
    },
    {
      playerId: 714,
      name: 'Kirk Cousins',
      bidMin: 5,
      bidMax: 8,
      reason: '20+ points three straight weeks. Superflex starter.',
    },
    {
      playerId: 1373,
      name: 'C.J. Stroud',
      bidMin: 4,
      bidMax: 7,
      reason: '347 yards, 2 TDs. Draws Tennessee (16.25 implied).',
    },
    {
      playerId: 546,
      name: 'Jameis Winston',
      bidMin: 3,
      bidMax: 6,
      reason: 'Dart out for the regular season. 250 yards, 3 TDs in Week 4.',
    },
    {
      playerId: 1347,
      name: 'Romeo Doubs',
      bidMin: 3,
      bidMax: 6,
      reason: '6 for 58 and two TDs, 25% target share. A.J. Brown on IR.',
    },
    {
      playerId: 1268,
      name: 'Brenton Strange',
      bidMin: 3,
      bidMax: 6,
      reason: '7 for 95 on a 35% target share.',
    },
    {
      playerId: 407,
      name: 'Brian Robinson Jr.',
      bidMin: 3,
      bidMax: 6,
      reason: 'Three rushing TDs. The goal-line half of a committee.',
    },
    {
      playerId: 1048,
      name: 'Darius Cooper',
      bidMin: 2,
      bidMax: 5,
      reason: 'Two TDs, 28% target share. DeVonta Smith and Hollywood Brown out.',
    },
    {
      playerId: 221,
      name: 'Jalon Daniels',
      bidMin: 2,
      bidMax: 4,
      reason: 'Mayfield out until Week 7 at the earliest (thumb). Debut start: 148 passing, 55 rushing.',
    },
    {
      playerId: 237,
      name: 'MarShawn Lloyd',
      bidMin: 2,
      bidMax: 4,
      reason: 'Has had the job since Week 1 with Jacobs out: 2.7 yards a carry. Committee with Kaleb Johnson.',
    },
    {
      playerId: 965,
      name: 'Michael Mayer',
      bidMin: 2,
      bidMax: 4,
      reason: '8 for 82, 21% target share.',
    },
    {
      playerId: 1379,
      name: 'Tyler Allgeier',
      bidMin: 2,
      bidMax: 4,
      reason: 'Jeremiyah Love questionable. 42 yards and a TD. Handcuff in a 54.5 total.',
    },
    {
      playerId: 1204,
      name: 'Tyson Bagent',
      bidMin: 1,
      bidMax: 3,
      reason: 'Caleb Williams week-to-week (hamstring). Named the Week 5 starter.',
    },
    {
      playerId: 900,
      name: 'Dohnte Meyers',
      bidMin: 1,
      bidMax: 3,
      reason: '7 for 82. Chase in concussion protocol, Higgins day-to-day.',
    },
    {
      playerId: 935,
      name: 'Keaton Mitchell',
      bidMin: 1,
      bidMax: 3,
      reason: '5 catches, 19% target share. Pass-down role.',
    },
    {
      playerId: 575,
      name: 'Malik Washington',
      bidMin: 1,
      bidMax: 3,
      reason: '29% target share, 5 for 67.',
    },
    {
      playerId: 620,
      name: 'Isaac TeSlaa',
      bidMin: 1,
      bidMax: 1,
      reason: '4 for 95. Detroit has the week\'s top implied total (29.5).',
    },
    {
      playerId: 843,
      name: 'Roman Wilson',
      bidMin: 1,
      bidMax: 1,
      reason: '3 for 74 and a TD. Role shrinking since Pittman\'s return.',
    },
  ],
};
