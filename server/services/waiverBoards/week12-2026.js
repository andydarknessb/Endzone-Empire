/**
 * Week 12 2026 editorial waiver board, seeded from the Week 12 Darkness Report's
 * "The Full Board" table (src/content/articles/week12-waiver-wire-darkness-report.jsx),
 * in the column's order. Bids are percent of a $100 FAAB budget. All 18 are kept
 * so the endpoint's cap still fills after the Ownership cutoff drops some.
 * `playerId` values are the production `players.id` rows from the editorial
 * rulings for issue #3048.
 *
 * @type {import('./index').WaiverBoard}
 */
module.exports = {
  season: 2026,
  week: 12,
  entries: [
    {
      playerId: 511,
      name: 'Jacory Croskey-Merritt',
      bidMin: 12,
      bidMax: 18,
      reason: '13 carries for 54 and a TD in his first game off IR.',
    },
    {
      playerId: 1177,
      name: 'Antonio Williams',
      bidMin: 8,
      bidMax: 12,
      reason: '9 for 122 on 11 targets, a 34% share. McLaurin is on IR.',
    },
    {
      playerId: 1339,
      name: 'Jack Bech',
      bidMin: 4,
      bidMax: 7,
      reason: '8 for 88 and a TD on 9 targets. A 24% share after 26%.',
    },
    {
      playerId: 981,
      name: 'Fernando Mendoza',
      bidMin: 3,
      bidMax: 6,
      reason: '267 yards and 3 TDs at Denver, worth 22.9.',
    },
    {
      playerId: 1035,
      name: 'Deshaun Watson',
      bidMin: 3,
      bidMax: 5,
      reason: '312 yards, 49 rushing and a rushing TD before the bye, worth 21.4.',
    },
    {
      playerId: 1524,
      name: 'Justice Hill',
      bidMin: 3,
      bidMax: 5,
      reason: '69 yards and a TD on 6 carries, plus 4 catches. 16.7 and 15.6 in two of his last three.',
    },
    {
      playerId: 1411,
      name: 'Kaleb Johnson',
      bidMin: 2,
      bidMax: 4,
      reason: "14 and 10 carries in Green Bay's last two games. Jacobs is listed questionable.",
    },
    {
      playerId: 1515,
      name: 'Cam Ward',
      bidMin: 2,
      bidMax: 4,
      reason: '19.1 and 22.2 in his last two games.',
    },
    {
      playerId: 324,
      name: 'Geno Smith',
      bidMin: 2,
      bidMax: 4,
      reason: '17 of 21 with 3 TDs, worth 19.4. The Jets are favored in Miami.',
    },
    {
      playerId: 297,
      name: 'Baker Mayfield',
      bidMin: 2,
      bidMax: 4,
      reason: '2 TDs and 36 rushing yards at Detroit, worth 19.1.',
    },
    {
      playerId: 48,
      name: 'Tai Felton',
      bidMin: 2,
      bidMax: 4,
      reason: '6 for 42 on 12 targets, a 28% share, with Addison missing the game.',
    },
    {
      playerId: 156,
      name: 'Evan Engram',
      bidMin: 2,
      bidMax: 4,
      reason: '6 for 74 on 8 targets, a 25% share.',
    },
    {
      playerId: 1301,
      name: 'Samaje Perine',
      bidMin: 2,
      bidMax: 4,
      reason: '11.9 and 11.7 in his last two. Cincinnati is implied for 30.25.',
    },
    {
      playerId: 319,
      name: 'Chris Rodriguez Jr.',
      bidMin: 2,
      bidMax: 4,
      reason: 'Tuten aggravated an ankle injury. Jacksonville is implied for 31.0.',
    },
    {
      playerId: 391,
      name: 'Ted Hurst III',
      bidMin: 1,
      bidMax: 3,
      reason: '5 for 56 and 2 TDs on 7 targets, a 23% share.',
    },
    {
      playerId: 1371,
      name: 'Chimere Dike',
      bidMin: 1,
      bidMax: 3,
      reason: '6 for 69 on 7 targets, a 25% share. Robinson is out for the season.',
    },
    {
      playerId: 1360,
      name: 'Mike Gesicki',
      bidMin: 1,
      bidMax: 3,
      reason: '5 for 77 on 6 targets. Cincinnati is implied for 30.25.',
    },
    {
      playerId: 1502,
      name: 'Anthony Richardson Sr.',
      bidMin: 1,
      bidMax: 3,
      reason: "First on the Colts' chart after they released Daniel Jones.",
    },
  ],
};
