/**
 * Week 11 2026 editorial waiver board, seeded from the Week 11 Darkness Report's
 * "The Full Board" table (src/content/articles/week11-waiver-wire-darkness-report.jsx),
 * in the column's order. Bids are percent of a $100 FAAB budget. All 18 are kept
 * so the endpoint's cap still fills after the Ownership cutoff drops some.
 * `playerId` values are the production `players.id` rows from the editorial
 * rulings for issue #2917.
 *
 * @type {import('./index').WaiverBoard}
 */
module.exports = {
  season: 2026,
  week: 11,
  entries: [
    {
      playerId: 650,
      name: 'Jordyn Tyson',
      bidMin: 7,
      bidMax: 11,
      reason: '11 for 80 on 13 targets, a 39% share after 16%.',
    },
    {
      playerId: 1515,
      name: 'Cam Ward',
      bidMin: 5,
      bidMax: 8,
      reason: '26.3 and 19.1 in his last two games. A 54.5 total in Dallas.',
    },
    {
      playerId: 296,
      name: 'Xavier Hutchinson',
      bidMin: 4,
      bidMax: 7,
      reason: '4 for 58 and a TD on 9 targets. Harrison missed the game.',
    },
    {
      playerId: 1160,
      name: "Tre' Harris",
      bidMin: 3,
      bidMax: 6,
      reason: '5 for 86 on a 31% share, after 23%.',
    },
    {
      playerId: 278,
      name: 'Bo Nix',
      bidMin: 3,
      bidMax: 6,
      reason: '19.3 and 15.7 before the bye. Denver is a 10-point favorite.',
    },
    {
      playerId: 664,
      name: 'Courtland Sutton',
      bidMin: 3,
      bidMax: 5,
      reason: 'A 26% share and 13.0 before the bye. Waddle is listed questionable.',
    },
    {
      playerId: 1034,
      name: 'Mark Andrews',
      bidMin: 2,
      bidMax: 4,
      reason: "8 for 82 on 8 targets in Brissett's Baltimore debut.",
    },
    {
      playerId: 1004,
      name: 'Elic Ayomanor',
      bidMin: 2,
      bidMax: 4,
      reason: '5 for 79 on 10 targets, a 27% share, with Tate out.',
    },
    {
      playerId: 1519,
      name: 'Ryan Flournoy',
      bidMin: 2,
      bidMax: 4,
      reason: '6 for 71 and a TD on 7 targets. Dallas is implied for 31.5.',
    },
    {
      playerId: 1261,
      name: 'J.J. McCarthy',
      bidMin: 2,
      bidMax: 4,
      reason: '293 yards, a TD and 34 rushing yards, worth 17.1.',
    },
    {
      playerId: 486,
      name: 'Jacoby Brissett',
      bidMin: 2,
      bidMax: 4,
      reason: '33 of 49 for 340 yards in his Baltimore debut, worth 11.8.',
    },
    {
      playerId: 1432,
      name: 'Makai Lemon',
      bidMin: 2,
      bidMax: 3,
      reason: '28% and 27% shares before the bye.',
    },
    {
      playerId: 1086,
      name: 'Seth McGowan',
      bidMin: 1,
      bidMax: 3,
      reason: "77 yards and a TD on 12 carries, behind Taylor's 16.",
    },
    {
      playerId: 283,
      name: 'Kaelon Black',
      bidMin: 1,
      bidMax: 3,
      reason: '53 yards and a TD on 11 carries, behind McCaffrey.',
    },
    {
      playerId: 1269,
      name: 'Chig Okonkwo',
      bidMin: 1,
      bidMax: 3,
      reason: '8 targets and a 24% share. A 52.5 total on Monday night.',
    },
    {
      playerId: 965,
      name: 'Michael Mayer',
      bidMin: 1,
      bidMax: 2,
      reason: 'Bowers hurt his right ankle and is day-to-day.',
    },
    {
      playerId: 1190,
      name: 'Caleb Douglas',
      bidMin: 1,
      bidMax: 2,
      reason: "3 for 71 on 8 targets, a 25% share, in McCord's first start.",
    },
    {
      playerId: 1472,
      name: 'Emari Demercado',
      bidMin: 1,
      bidMax: 2,
      reason: '7 carries on Sunday. Marks is listed doubtful with a concussion.',
    },
  ],
};
