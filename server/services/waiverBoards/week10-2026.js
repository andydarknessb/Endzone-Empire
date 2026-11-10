/**
 * Week 10 2026 editorial waiver board, seeded from the Week 10 Darkness Report's
 * "The Full Board" table (src/content/articles/week10-waiver-wire-darkness-report.jsx),
 * in the column's order. Bids are percent of a $100 FAAB budget. All 18 are kept
 * so the endpoint's cap still fills after the Ownership cutoff drops some.
 * `playerId` values are the production `players.id` rows from the editorial
 * rulings for issue #2830.
 *
 * @type {import('./index').WaiverBoard}
 */
module.exports = {
  season: 2026,
  week: 10,
  entries: [
    {
      playerId: 1411,
      name: 'Kaleb Johnson',
      bidMin: 14,
      bidMax: 20,
      reason: '68 yards and a TD on 14 carries. Jacobs needs finger surgery.',
    },
    {
      playerId: 1041,
      name: 'Corey Kiner',
      bidMin: 8,
      bidMax: 12,
      reason: "55 yards and a TD on 8 carries. Stevenson's knee will cost him time.",
    },
    {
      playerId: 1221,
      name: 'Tank Dell',
      bidMin: 5,
      bidMax: 9,
      reason: '4 for 105 and a TD on a 24% share, his second game back.',
    },
    {
      playerId: 999,
      name: 'Drew Lock',
      bidMin: 4,
      bidMax: 7,
      reason: "175 yards and a TD, and named Sunday's starter.",
    },
    {
      playerId: 1357,
      name: 'Audric Estime',
      bidMin: 4,
      bidMax: 7,
      reason: '72 yards and the go-ahead TD on 15 carries. Kamara had 6.',
    },
    {
      playerId: 1190,
      name: 'Caleb Douglas',
      bidMin: 3,
      bidMax: 6,
      reason: '6 for 70 on a 38% share, after 20%.',
    },
    {
      playerId: 486,
      name: 'Jacoby Brissett',
      bidMin: 3,
      bidMax: 5,
      reason: "First on Baltimore's chart after the trade. 16.5 in Week 7.",
    },
    {
      playerId: 1524,
      name: 'Justice Hill',
      bidMin: 3,
      bidMax: 5,
      reason: '85 yards and a TD on 9 carries, 65 of them on one run.',
    },
    {
      playerId: 1310,
      name: 'Darren Waller',
      bidMin: 2,
      bidMax: 4,
      reason: '8 for 90 and a TD on a 27% share, after 6%.',
    },
    {
      playerId: 679,
      name: 'Michael Penix Jr.',
      bidMin: 2,
      bidMax: 4,
      reason: '162 yards, a TD and 50 rushing yards, worth 13.5.',
    },
    {
      playerId: 413,
      name: 'Jordan Watkins',
      bidMin: 2,
      bidMax: 4,
      reason: '4 for 86 and a TD on a 17% share. Evans is unlikely to practice Wednesday.',
    },
    {
      playerId: 553,
      name: 'Brevyn Spann-Ford',
      bidMin: 2,
      bidMax: 4,
      reason: 'Ferguson is out for multiple weeks. 18% and 9% shares the last two weeks.',
    },
    {
      playerId: 1415,
      name: 'AJ Barner',
      bidMin: 1,
      bidMax: 3,
      reason: 'A receiving TD and a rushing TD, worth 14.0, on a 14% share.',
    },
    {
      playerId: 1353,
      name: 'Van Jefferson',
      bidMin: 1,
      bidMax: 3,
      reason: '5 for 58 and a TD on a 21% share, after 4%.',
    },
    {
      playerId: 1269,
      name: 'Chig Okonkwo',
      bidMin: 1,
      bidMax: 3,
      reason: '6 for 57 on a 21% share. Limited Monday with a hip injury.',
    },
    {
      playerId: 1515,
      name: 'Cam Ward',
      bidMin: 1,
      bidMax: 3,
      reason: '26.3 in Week 8, then the bye. Jacksonville at home.',
    },
    {
      playerId: 546,
      name: 'Jameis Winston',
      bidMin: 1,
      bidMax: 2,
      reason: 'Threw the go-ahead TD in relief. McCarthy is limited with a hip injury.',
    },
    {
      playerId: 460,
      name: 'Pierre Strong Jr.',
      bidMin: 1,
      bidMax: 2,
      reason: '22 yards on 8 carries behind Johnson.',
    },
  ],
};
