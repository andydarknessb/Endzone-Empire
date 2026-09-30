/**
 * The Week 4 2026 waiver board, seeded from the Week 4 Darkness Report
 * (src/content/articles/week4-waiver-wire-darkness-report.jsx): the column's
 * priced board, in the column's order. Bid ranges are a percent of a $100 FAAB
 * budget. `name` is for review only; the endpoint reads the player by `playerId`.
 *
 * OPEN: the `playerId` values below are PLACEHOLDERS (9000001 and up). They
 * must be replaced with the real `players.id` values before this ships; until
 * then no live player matches, so the endpoint returns an empty list rather
 * than a wrong one.
 *
 * @type {import('./index').WaiverBoard}
 */
module.exports = {
  season: 2026,
  week: 4,
  entries: [
    {
      playerId: 9000001, name: 'Braelon Allen', bidMin: 12, bidMax: 18,
      reason: 'Hall is week-to-week with a thigh injury, and Allen is the lead back in a hot Jets offense.',
    },
    {
      playerId: 9000002, name: 'Ollie Gordon II', bidMin: 12, bidMax: 15,
      reason: 'Achane is on IR, so this is the only season-long lead-back job on the wire, in a tough Week 4 spot.',
    },
    {
      playerId: 9000003, name: 'Kenyon Sadiq', bidMin: 8, bidMax: 12,
      reason: 'Seven catches, 105 yards and a touchdown in Week 3 with Mason Taylor out.',
    },
    {
      playerId: 9000004, name: 'Alvin Kamara', bidMin: 5, bidMax: 8,
      reason: 'Etienne will miss time with a hamstring injury, and Kamara shares the work with Kendre Miller.',
    },
    {
      playerId: 9000005, name: 'Keenan Allen', bidMin: 3, bidMax: 6,
      reason: 'Pierce is on IR, and Allen had nine targets in Week 3 against a Washington defense that gets gashed by receivers.',
    },
    {
      playerId: 9000006, name: 'Jaylen Wright', bidMin: 3, bidMax: 7,
      reason: 'The other half of the Achane vacancy, and his coach calls him day-to-day.',
    },
    {
      playerId: 9000007, name: 'Darren Waller', bidMin: 2, bidMax: 4,
      reason: 'A season-high 39 snaps with Coker and Legette banged up. A tight end stream.',
    },
    {
      playerId: 9000008, name: 'Jakobi Meyers', bidMin: 2, bidMax: 4,
      reason: 'Seven catches on eight targets and 80% of the snaps, in the highest-total game of the week.',
    },
    {
      playerId: 9000009, name: 'Sam Darnold', bidMin: 1, bidMax: 3,
      reason: 'Back from the glute injury with 379 yards and four touchdowns, at home against a winless Chargers team.',
    },
    {
      playerId: 9000010, name: 'Jacoby Brissett', bidMin: 1, bidMax: 3,
      reason: 'Arizona\'s starter since Week 1, facing a Giants team on its backup quarterback.',
    },
    {
      playerId: 9000011, name: 'Wan\'Dale Robinson', bidMin: 1, bidMax: 3,
      reason: 'A team-high 11 targets in Week 3. A PPR floor.',
    },
    {
      playerId: 9000012, name: 'Geno Smith', bidMin: 1, bidMax: 2,
      reason: '31 of 37 for 321 yards and three touchdowns with no picks against Detroit. A quarterback stream.',
    },
    {
      playerId: 9000013, name: 'Mack Hollins', bidMin: 1, bidMax: 2,
      reason: 'A.J. Brown is on IR, and Hollins has a team-leading 12 catches, six for 87 last week.',
    },
    {
      playerId: 9000014, name: 'Tre\' Harris', bidMin: 1, bidMax: 2,
      reason: 'A team-high seven targets on 63% of the routes, pushing Quentin Johnston. A stash.',
    },
  ],
};
