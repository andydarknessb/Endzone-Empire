const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mapSleeperStats,
  normalizeSleeperEntry,
  buildSeasonStatUpdates,
} = require('../services/sleeper.service');

test('mapSleeperStats translates Sleeper fields to our flat keys, dropping zeros', () => {
  const out = mapSleeperStats({
    rec: 66, rec_yd: 654, rec_td: 7, rush_yd: 20, rush_td: 0,
    pass_yd: 0, fum_lost: 1, gp: 17, rec_air_yd: 900 /* ignored */,
  });
  assert.deepEqual(out, {
    receptions: 66, receivingYards: 654, receivingTDs: 7, rushingYards: 20, fumbles: 1,
  });
});

test('normalizeSleeperEntry joins meta + stats into a match shape', () => {
  const out = normalizeSleeperEntry(
    { full_name: 'Justin Jefferson', position: 'WR' },
    { gp: 17, rec: 100, rec_yd: 1533, rec_td: 10 }
  );
  assert.equal(out.nameKey, 'justin jefferson');
  assert.equal(out.position, 'WR');
  assert.equal(out.games, 17);
  assert.equal(out.stats.receivingYards, 1533);
});

test('normalizeSleeperEntry rejects no-name, zero-game, and statless (defense) rows', () => {
  assert.equal(normalizeSleeperEntry({ position: 'WR' }, { gp: 17, rec: 5 }), null);
  assert.equal(normalizeSleeperEntry({ full_name: 'X' }, { gp: 0, rec: 5 }), null);
  assert.equal(normalizeSleeperEntry({ full_name: 'A Defense' }, { gp: 17 }), null); // no mappable stats
});

const entries = [
  { nameKey: 'justin jefferson', position: 'WR', games: 17, stats: { receivingYards: 1533 } },
  { nameKey: 'josh allen', position: 'QB', games: 17, stats: { passingYards: 4300 } },
  { nameKey: 'josh allen', position: 'LB', games: 16, stats: { fumbles: 1 } },
];

test('buildSeasonStatUpdates matches by name and stamps the season', () => {
  const updates = buildSeasonStatUpdates([{ id: 5, name: 'Justin Jefferson', position: 'WR' }], entries, 2024);
  assert.deepEqual(updates, [{ playerId: 5, season: 2024, games: 17, stats: { receivingYards: 1533 } }]);
});

test('buildSeasonStatUpdates disambiguates same-named players by position', () => {
  const updates = buildSeasonStatUpdates([{ id: 1, name: 'Josh Allen', position: 'QB' }], entries, 2024);
  assert.equal(updates[0].stats.passingYards, 4300); // the QB, not the LB
});

test('buildSeasonStatUpdates skips unmatched players', () => {
  const updates = buildSeasonStatUpdates([{ id: 9, name: 'Nobody', position: 'RB' }], entries, 2024);
  assert.deepEqual(updates, []);
});
